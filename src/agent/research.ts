import { anthropic } from '@ai-sdk/anthropic';
import { generateText, generateObject, stepCountIs } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import { searchWeb } from '../tools/tavily.ts';
import { listPreferences, addPreference, removePreference } from '../memory/preferences.ts';
import { getAirtableMcp, upsertProspect } from '../tools/airtable.ts';

const BRAIN_SYSTEM_PROMPT = fs.readFileSync('src/agent/prompts/brain.md', 'utf8');

// §7.1 — the structured shape every research output must match. `domain` and `lastResearched`
// are load-bearing / canonical metadata set by the caller, never the model — see §7.4.
export const ProspectSchema = z.object({
  companyName: z.string(),
  domain: z.string(),
  overview: z.string(),
  signals: z
    .array(
      z.object({
        name: z.string(),
        description: z.string(),
        strength: z.enum(['strong', 'moderate', 'weak']),
      }),
    )
    .min(1),
  leadScore: z.number().int().min(1).max(100),
  scoreReasoning: z.string(),
  suggestedAngle: z.string(),
  lastResearched: z.string().datetime(),
});

export type Prospect = z.infer<typeof ProspectSchema>;

// §6 — canonical key: lowercase, no protocol/www, TLD stripped, alphanumerics only.
function normalizeToDomain(companyName: string): string {
  let key = companyName.trim().toLowerCase();
  key = key.replace(/^https?:\/\//, '');
  key = key.replace(/^www\./, '');
  const dotIndex = key.lastIndexOf('.');
  if (dotIndex !== -1) {
    key = key.slice(0, dotIndex);
  }
  return key.replace(/[^a-z0-9]/g, '');
}

/**
 * Turns free-text research analysis into a typed, partial Prospect (missing `domain` and
 * `lastResearched` per §7.4's .omit() contract — the caller attaches both deterministically).
 */
export async function structureProspect(analysisText: string, companyName: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env or your Codespaces secrets.');
  }

  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5'),
    schema: ProspectSchema.omit({ domain: true, lastResearched: true }),
    prompt: `Extract a structured prospect for ${companyName} from the analysis below. Every field must come from the analysis text — do not invent values. Each signal's \`strength\` must be one of: strong, moderate, weak.

Analysis:
${analysisText}`,
  });

  return object;
}

export async function researchCompany(companyName: string) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env or your Codespaces secrets.');
  }

  const result = await generateText({
    model: anthropic('claude-haiku-4-5'),
    system: BRAIN_SYSTEM_PROMPT,
    prompt: `Research the company "${companyName}" as a sales prospect and summarize what you know.`,
    tools: { searchWeb, listPreferences, addPreference, removePreference },
    stopWhen: stepCountIs(8),
  });

  const partial = await structureProspect(result.text, companyName);

  const prospect = ProspectSchema.parse({
    ...partial,
    domain: normalizeToDomain(companyName),
    lastResearched: new Date().toISOString(),
  });

  const client = await getAirtableMcp();
  try {
    await upsertProspect(client, prospect);
  } finally {
    await client.close();
  }

  return { prospect, steps: result.steps };
}
