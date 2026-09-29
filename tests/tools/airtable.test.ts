import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAirtableMcp } from '../../src/tools/airtable.ts';

// Exact-name canary per PRD §12.3 / §16.1 — Airtable's hosted MCP server must expose these
// five CRUD primitives by these exact keys. Fuzzy matching (e.g. /create.records?/i) matches
// create_record_comment before create_records_for_table and routes writes to the wrong tool.
const REQUIRED_TOOL_NAMES = [
  'list_tables_for_base',
  'list_records_for_table',
  'create_records_for_table',
  'update_records_for_table',
  'delete_records_for_table',
];

describe('Airtable MCP — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error naming AIRTABLE_API_KEY when it is missing', async () => {
    vi.stubEnv('AIRTABLE_API_KEY', '');
    await expect(getAirtableMcp()).rejects.toThrow(/AIRTABLE_API_KEY/);
  });

  it('throws a clear, actionable error naming AIRTABLE_BASE_ID when it is missing', async () => {
    vi.stubEnv('AIRTABLE_BASE_ID', '');
    await expect(getAirtableMcp()).rejects.toThrow(/AIRTABLE_BASE_ID/);
  });
});

const HAS_AIRTABLE_ENV = !!process.env.AIRTABLE_API_KEY && !!process.env.AIRTABLE_BASE_ID;

if (!HAS_AIRTABLE_ENV) {
  console.warn('[skip] AIRTABLE_API_KEY / AIRTABLE_BASE_ID unset — Airtable MCP real-API suite skipped');
}

describe.skipIf(!HAS_AIRTABLE_ENV)('Airtable MCP — real API (Airtable connector)', () => {
  it(
    'connects using AIRTABLE_API_KEY and discovers the exact pinned MCP tool names',
    async () => {
      const client = await getAirtableMcp();
      try {
        const tools = await client.tools();
        const discoveredNames = Object.keys(tools);
        for (const name of REQUIRED_TOOL_NAMES) {
          expect(discoveredNames).toContain(name);
        }
      } finally {
        await client.close();
      }
    },
    30_000,
  );

  it(
    'closes the connection cleanly via close()',
    async () => {
      const client = await getAirtableMcp();
      await client.tools();
      await expect(client.close()).resolves.toBeUndefined();
    },
    30_000,
  );
});
