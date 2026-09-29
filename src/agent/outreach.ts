import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import { getAirtableMcp, getProspectByDomain, createOutreach } from '../tools/airtable.ts';

const OUTREACH_SYSTEM_PROMPT = fs.readFileSync('src/agent/prompts/outreach.md', 'utf8');
const PREFERENCES_PATH = 'src/memory/preferences.md';

// §11.1 — the structured shape every outreach draft must match.
export const OutreachSchema = z.object({
  subjectLine: z.string().max(80),
  emailBody: z.string(),
  angleReasoning: z.string(),
});

export type Outreach = z.infer<typeof OutreachSchema>;

function readPreferences(): string {
  try {
    return fs.readFileSync(PREFERENCES_PATH, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Drafts a first-touch outreach email for a previously researched company, identified by
 * its canonical domain. One-shot generateObject call — no agent loop, no exploratory tools
 * (§12.4). Reads the prospect record and saved preferences in code, then persists the draft
 * as a linked Outreach row (§11.3).
 */
export async function draftOutreach(domain: string): Promise<Outreach> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to .env or your Codespaces secrets.');
  }

  const client = await getAirtableMcp();
  try {
    const prospect = await getProspectByDomain(client, domain);
    if (!prospect) {
      throw new Error(`Research ${domain} first.`);
    }

    const preferences = readPreferences();

    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5'),
      system: OUTREACH_SYSTEM_PROMPT,
      schema: OutreachSchema,
      prompt: `Prospect record:
Company: ${prospect.companyName}
Overview: ${prospect.overview}
Signals:
${prospect.signals}
Lead score: ${prospect.leadScore}
Score reasoning: ${prospect.scoreReasoning}
Suggested angle: ${prospect.suggestedAngle}

User preferences:
${preferences || '(none saved)'}

Draft the outreach email now.`,
    });

    await createOutreach(client, prospect.id, object);

    console.log(`\nSubject: ${object.subjectLine}\n\n${object.emailBody}\n\nAngle reasoning: ${object.angleReasoning}\n`);

    return object;
  } finally {
    await client.close();
  }
}
