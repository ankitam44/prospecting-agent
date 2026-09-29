import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import type { experimental_MCPClient as MCPClient } from '@ai-sdk/mcp';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';

const AIRTABLE_MCP_URL = 'https://mcp.airtable.com/mcp/';
const PROSPECTS_TABLE_NAME = 'Prospects';
const OUTREACH_TABLE_NAME = 'Outreach';

// Exact-name canary per §12.3 — fuzzy lookup (e.g. /create.records?/i) matches
// create_record_comment before create_records_for_table and routes writes to the wrong tool.
const REQUIRED_TOOL_NAMES = [
  'list_tables_for_base',
  'list_records_for_table',
  'create_records_for_table',
  'update_records_for_table',
  'delete_records_for_table',
] as const;

const INTERNAL_TOOL_CALL_OPTIONS: ToolCallOptions = { toolCallId: 'airtable-internal', messages: [] };

type AirtableToolSet = Awaited<ReturnType<MCPClient['tools']>>;

type McpCallToolResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

type TableSchema = { tableId: string; fieldIds: Record<string, string> };

// Minimal shape this module needs from a researched Prospect (§7.1). Not the full
// ProspectSchema — that lives in src/agent/research.ts once the structurer stage lands.
export type ProspectRecord = {
  domain: string;
  companyName: string;
  overview: string;
  signals: Array<{ name: string; description: string; strength: 'strong' | 'moderate' | 'weak' }>;
  leadScore: number;
  scoreReasoning: string;
  suggestedAngle: string;
  lastResearched: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to .env or your Codespaces secrets.`);
  }
  return value;
}

/** Opens a connection to Airtable's hosted MCP server. Caller is responsible for calling close(). */
export async function getAirtableMcp(): Promise<MCPClient> {
  const apiKey = requireEnv('AIRTABLE_API_KEY');
  requireEnv('AIRTABLE_BASE_ID');

  return createMCPClient({
    transport: {
      type: 'http',
      url: AIRTABLE_MCP_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  });
}

async function resolveTools(client: MCPClient): Promise<AirtableToolSet> {
  const tools = await client.tools();
  for (const name of REQUIRED_TOOL_NAMES) {
    if (!(name in tools)) {
      throw new Error(`Airtable MCP is missing the required tool "${name}" — cannot perform Airtable writes.`);
    }
  }
  return tools;
}

function unwrap(result: McpCallToolResult): unknown {
  if (result.isError) {
    throw new Error(result.content[0]?.text ?? 'Airtable MCP call failed.');
  }
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result.content[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

async function callTool(tools: AirtableToolSet, name: string, args: Record<string, unknown>): Promise<unknown> {
  const tool = tools[name];
  const result = (await tool.execute!(args, INTERNAL_TOOL_CALL_OPTIONS)) as McpCallToolResult;
  return unwrap(result);
}

// Table ID + field-name→field-ID map, resolved once per client connection and reused
// for the lifetime of that connection (§12.3).
const schemaCache = new WeakMap<MCPClient, Map<string, TableSchema>>();

async function resolveTableSchema(client: MCPClient, tools: AirtableToolSet, tableName: string): Promise<TableSchema> {
  let cache = schemaCache.get(client);
  if (!cache) {
    cache = new Map();
    schemaCache.set(client, cache);
  }
  const cached = cache.get(tableName);
  if (cached) return cached;

  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const result = (await callTool(tools, 'list_tables_for_base', { baseId })) as {
    tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }>;
  };
  const table = result.tables.find((t) => t.name === tableName);
  if (!table) {
    throw new Error(`Airtable base is missing the "${tableName}" table.`);
  }

  const fieldIds: Record<string, string> = {};
  for (const field of table.fields) {
    fieldIds[field.name] = field.id;
  }
  const schema: TableSchema = { tableId: table.id, fieldIds };
  cache.set(tableName, schema);
  return schema;
}

function signalsToMarkdown(signals: ProspectRecord['signals']): string {
  return signals.map((signal) => `- ${signal.description}`).join('\n');
}

/**
 * Lists Prospects filtered by domain and returns the matching record ID, or null on no-match.
 * Throws if more than one row matches — that indicates the structured filter was dropped
 * (returning the whole table) or a duplicate-domain row exists, both of which §13.2 forbids.
 */
export async function getProspectIdByDomain(client: MCPClient, domain: string): Promise<string | null> {
  const tools = await resolveTools(client);
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const schema = await resolveTableSchema(client, tools, PROSPECTS_TABLE_NAME);

  const result = (await callTool(tools, 'list_records_for_table', {
    baseId,
    tableId: schema.tableId,
    filters: { operands: [{ operator: '=', operands: [schema.fieldIds.domain, domain] }] },
  })) as { records: Array<{ id: string }> };

  if (result.records.length > 1) {
    throw new Error(
      `Expected at most one Prospects row for domain "${domain}" but found ${result.records.length} — the structured filter may have been dropped, or a duplicate-domain row exists.`,
    );
  }

  return result.records[0]?.id ?? null;
}

/**
 * Lists Prospects filtered by domain and returns the record ID plus every Prospects field
 * (decoded from cellValuesByFieldId back to field names), or null on no-match. Idempotent
 * on no-match. Read primitive — used by draftOutreach (§12.4), which needs both the record
 * id (for the linked write to Outreach) and the field values (for LLM context). Distinct
 * from getProspectIdByDomain, which exists so id-only callers don't pull the full record.
 */
export async function getProspectByDomain(
  client: MCPClient,
  domain: string,
): Promise<({ id: string } & Record<string, unknown>) | null> {
  const tools = await resolveTools(client);
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const schema = await resolveTableSchema(client, tools, PROSPECTS_TABLE_NAME);

  const result = (await callTool(tools, 'list_records_for_table', {
    baseId,
    tableId: schema.tableId,
    filters: { operands: [{ operator: '=', operands: [schema.fieldIds.domain, domain] }] },
  })) as { records: Array<{ id: string; cellValuesByFieldId: Record<string, unknown> }> };

  if (result.records.length > 1) {
    throw new Error(
      `Expected at most one Prospects row for domain "${domain}" but found ${result.records.length} — the structured filter may have been dropped, or a duplicate-domain row exists.`,
    );
  }

  const record = result.records[0];
  if (!record) return null;

  const idToName = new Map(Object.entries(schema.fieldIds).map(([name, id]) => [id, name]));
  const fields: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(record.cellValuesByFieldId)) {
    const name = idToName.get(fieldId);
    if (name) fields[name] = value;
  }
  return { id: record.id, ...fields };
}

/**
 * Upserts a Prospect into the Prospects table, keyed on domain. Creates a new row
 * (status defaults to "researched" per §13.2) if no matching domain is found, or
 * updates the existing row's fields (leaving status untouched) otherwise.
 */
export async function upsertProspect(client: MCPClient, prospect: ProspectRecord): Promise<{ id: string }> {
  const tools = await resolveTools(client);
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const schema = await resolveTableSchema(client, tools, PROSPECTS_TABLE_NAME);
  const f = schema.fieldIds;

  const fields: Record<string, unknown> = {
    [f.domain]: prospect.domain,
    [f.companyName]: prospect.companyName,
    [f.overview]: prospect.overview,
    [f.signals]: signalsToMarkdown(prospect.signals),
    [f.leadScore]: prospect.leadScore,
    [f.scoreReasoning]: prospect.scoreReasoning,
    [f.suggestedAngle]: prospect.suggestedAngle,
    [f.lastResearched]: prospect.lastResearched,
  };

  const existingId = await getProspectIdByDomain(client, prospect.domain);

  if (existingId) {
    await callTool(tools, 'update_records_for_table', {
      baseId,
      tableId: schema.tableId,
      records: [{ id: existingId, fields }],
    });
    return { id: existingId };
  }

  const created = (await callTool(tools, 'create_records_for_table', {
    baseId,
    tableId: schema.tableId,
    records: [{ fields: { ...fields, [f.status]: 'researched' } }],
  })) as { records: Array<{ id: string }> };

  return { id: created.records[0].id };
}

/**
 * Deletes the Prospects row matching domain, if any. Returns the count of deleted rows (0 or 1).
 * Used by test cleanup, not production paths — callers must delete linked Outreach rows first
 * via deleteOutreachByProspect (§13.4e); this table does not cascade-delete.
 */
export async function deleteProspectByDomain(client: MCPClient, domain: string): Promise<number> {
  const tools = await resolveTools(client);
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const schema = await resolveTableSchema(client, tools, PROSPECTS_TABLE_NAME);

  const recordId = await getProspectIdByDomain(client, domain);
  if (!recordId) return 0;

  await callTool(tools, 'delete_records_for_table', {
    baseId,
    tableId: schema.tableId,
    recordIds: [recordId],
  });
  return 1;
}

// Minimal shape this module needs from a drafted Outreach (§11.1).
export type OutreachRecord = { subjectLine: string; emailBody: string; angleReasoning: string };

/**
 * Creates an Outreach row linked to prospectId. `typecast: true` is load-bearing for the
 * linked-record write (§13.4) — without it, Airtable silently null-coerces the linked cell
 * instead of erroring, and the row is created with an empty `prospect` field. Used by
 * draftOutreach (§11.3) and never by production research paths.
 */
export async function createOutreach(
  client: MCPClient,
  prospectId: string,
  outreach: OutreachRecord,
): Promise<{ id: string }> {
  const tools = await resolveTools(client);
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const schema = await resolveTableSchema(client, tools, OUTREACH_TABLE_NAME);
  const f = schema.fieldIds;

  const created = (await callTool(tools, 'create_records_for_table', {
    baseId,
    tableId: schema.tableId,
    typecast: true,
    records: [
      {
        fields: {
          [f.subjectLine]: outreach.subjectLine,
          [f.emailBody]: outreach.emailBody,
          [f.angleReasoning]: outreach.angleReasoning,
          [f.prospect]: [prospectId],
          [f.status]: 'draft',
          [f.createdAt]: new Date().toISOString(),
        },
      },
    ],
  })) as { records: Array<{ id: string }> };

  return { id: created.records[0].id };
}

/**
 * Lists Outreach rows whose `prospect` linked field references prospectId. Returns the
 * matching record IDs, or an empty array on no-match. Read primitive — used by
 * deleteOutreachByProspect and by §16.1 verification tests, never by production research
 * or draftOutreach paths.
 *
 * Linked-record cells come back as `[{ id, name }, ...]` objects on this MCP surface, not
 * bare `rec…` strings — the filter checks both shapes so a future MCP-side shape change
 * does not silently drop matches.
 */
export async function listOutreachByProspectId(client: MCPClient, prospectId: string): Promise<string[]> {
  const tools = await resolveTools(client);
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const schema = await resolveTableSchema(client, tools, OUTREACH_TABLE_NAME);

  const result = (await callTool(tools, 'list_records_for_table', {
    baseId,
    tableId: schema.tableId,
  })) as { records: Array<{ id: string; cellValuesByFieldId: Record<string, unknown> }> };

  return result.records
    .filter((record) => {
      const linked = record.cellValuesByFieldId[schema.fieldIds.prospect];
      if (!Array.isArray(linked)) return false;
      return linked.some((entry) =>
        typeof entry === 'string' ? entry === prospectId : (entry as { id?: string })?.id === prospectId,
      );
    })
    .map((record) => record.id);
}

/**
 * Deletes all Outreach rows linked to the Prospects row matching domain. Returns the count
 * of deleted rows (0 if no prospect found, or prospect found with no linked Outreach rows).
 * Used by §16 test cleanup, not production paths. Airtable does not cascade-delete linked
 * records — callers must run this before deleteProspectByDomain, or the linked-field lookup
 * orphans the Outreach rows it can no longer find.
 */
export async function deleteOutreachByProspect(client: MCPClient, domain: string): Promise<number> {
  const tools = await resolveTools(client);
  const baseId = requireEnv('AIRTABLE_BASE_ID');

  const prospectId = await getProspectIdByDomain(client, domain);
  if (!prospectId) return 0;

  const outreachIds = await listOutreachByProspectId(client, prospectId);
  if (outreachIds.length === 0) return 0;

  const schema = await resolveTableSchema(client, tools, OUTREACH_TABLE_NAME);
  await callTool(tools, 'delete_records_for_table', {
    baseId,
    tableId: schema.tableId,
    recordIds: outreachIds,
  });
  return outreachIds.length;
}
