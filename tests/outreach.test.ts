import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import type { experimental_MCPClient as MCPClient } from '@ai-sdk/mcp';
import { draftOutreach, OutreachSchema } from '../src/agent/outreach.ts';
import {
  getAirtableMcp,
  upsertProspect,
  getProspectIdByDomain,
  listOutreachByProspectId,
  deleteOutreachByProspect,
  deleteProspectByDomain,
} from '../src/tools/airtable.ts';

const SEED_DOMAIN = 'outreachtestco';
const UNKNOWN_DOMAIN = 'outreachunknownco';

// Paraphrase-resistant tokens (specific numerals / proper nouns) per §16.1 — placed only
// inside signals[].description, never in suggestedAngle / scoreReasoning / overview /
// companyName, so the emailBody assertion proves the model read the signals array rather
// than anchoring on suggestedAngle.
const SIGNAL_1_TOKENS = ['47', 'Singapore'];
const SIGNAL_2_TOKEN = 'Japanese';

const SEED_PROSPECT = {
  domain: SEED_DOMAIN,
  companyName: 'Outreach Test Co',
  overview: 'A growing logistics and e-commerce company expanding across the APAC region.',
  signals: [
    {
      name: 'Hiring activity',
      description: `Posted 47 open support roles in Singapore over the past quarter.`,
      strength: 'strong' as const,
    },
    {
      name: 'Market expansion',
      description: `Opened a new Japanese-language customer support center.`,
      strength: 'strong' as const,
    },
  ],
  leadScore: 78,
  scoreReasoning: 'Strong signals: new APAC launch and rapid regional hiring support a high score.',
  suggestedAngle: 'Lead with support for the new APAC launch and rapid regional hiring.',
  lastResearched: new Date().toISOString(),
};

describe('Outreach — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error mentioning ANTHROPIC_API_KEY when it is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(draftOutreach(SEED_DOMAIN)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

const HAS_OUTREACH_ENV =
  !!process.env.ANTHROPIC_API_KEY && !!process.env.AIRTABLE_API_KEY && !!process.env.AIRTABLE_BASE_ID;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[skip] ANTHROPIC_API_KEY unset — draftOutreach real-API suite skipped');
} else if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
  console.warn('[skip] AIRTABLE_API_KEY / AIRTABLE_BASE_ID unset — draftOutreach real-API suite skipped');
}

describe.skipIf(!HAS_OUTREACH_ENV)('draftOutreach — real API (outreach drafting)', () => {
  let client: MCPClient;
  let result: Awaited<ReturnType<typeof draftOutreach>>;

  beforeAll(async () => {
    client = await getAirtableMcp();

    // Idempotent pre-cleanup in case a prior run was interrupted before its own teardown ran.
    try {
      await deleteOutreachByProspect(client, SEED_DOMAIN);
      await deleteProspectByDomain(client, SEED_DOMAIN);
    } catch (error) {
      console.warn('[setup] pre-cleanup of stale outreachtestco rows failed:', error);
    }

    await upsertProspect(client, SEED_PROSPECT);
    result = await draftOutreach(SEED_DOMAIN);
  }, 60_000);

  afterAll(async () => {
    try {
      await deleteOutreachByProspect(client, SEED_DOMAIN);
    } catch (error) {
      console.warn('[cleanup] failed to delete test Outreach rows:', error);
    }
    try {
      await deleteProspectByDomain(client, SEED_DOMAIN);
    } catch (error) {
      console.warn('[cleanup] failed to delete test Prospects row:', error);
    }
    try {
      await client.close();
    } catch (error) {
      console.warn('[cleanup] failed to close Airtable MCP client:', error);
    }
  }, 60_000);

  it('returns an object matching OutreachSchema', () => {
    expect(() => OutreachSchema.parse(result)).not.toThrow();
  });

  it('subjectLine is at most 80 characters', () => {
    expect(result.subjectLine.length).toBeLessThanOrEqual(80);
  });

  it('emailBody references at least two specific signals from the prospect record', () => {
    const referencesSignal1 = SIGNAL_1_TOKENS.some((token) => result.emailBody.includes(token));
    const referencesSignal2 = result.emailBody.includes(SIGNAL_2_TOKEN);
    expect(referencesSignal1).toBe(true);
    expect(referencesSignal2).toBe(true);
  });

  it(
    'writes an Outreach row linked to the seeded prospect record id',
    async () => {
      const prospectId = await getProspectIdByDomain(client, SEED_DOMAIN);
      expect(prospectId).not.toBeNull();

      const outreachIds = await listOutreachByProspectId(client, prospectId as string);
      expect(outreachIds.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it('errors with "Research <Company> first." for a domain with no prior prospect record', async () => {
    await expect(draftOutreach(UNKNOWN_DOMAIN)).rejects.toThrow(/Research .*first\./);
  });
});
