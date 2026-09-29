import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { searchWeb } from '../../src/tools/tavily.ts';

const TEST_TOOL_CALL_OPTIONS: ToolCallOptions = { toolCallId: 'test', messages: [] };

type SearchResult = { title: string; url: string; snippet: string; publishedDate: string };

async function runSearchWeb(input: { query: string; recencyDays?: number }): Promise<SearchResult[]> {
  return (await searchWeb.execute!(input, TEST_TOOL_CALL_OPTIONS)) as SearchResult[];
}

// Blocklist domains pinned by PRD §16.1 — SEO-spam finance listicles that surface for
// any company-name query and contribute zero support-fit signal.
const KNOWN_BLOCKLIST_DOMAINS = ['tipranks.com', 'seekingalpha.com', 'fool.com', 'benzinga.com'];

describe('Tavily — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when TAVILY_API_KEY is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(runSearchWeb({ query: 'Stripe funding news' })).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

if (!process.env.TAVILY_API_KEY) {
  console.warn('[skip] TAVILY_API_KEY unset — Tavily real-API suite skipped');
}

describe.skipIf(!process.env.TAVILY_API_KEY)('Tavily — real API (searchWeb build)', () => {
  it('returns a non-empty result list for a normal query', async () => {
    const results = await runSearchWeb({ query: 'Stripe funding news 2026' });
    expect(results.length).toBeGreaterThan(0);
  });

  it('shapes each result to exactly { title, url, snippet, publishedDate }', async () => {
    const results = await runSearchWeb({ query: 'Stripe funding news 2026' });
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(['publishedDate', 'snippet', 'title', 'url']);
    }
  });

  it('defaults recencyDays to 90 when the caller does not specify it', async () => {
    const results = await runSearchWeb({ query: 'Stripe funding news 2026' });
    expect(results.length).toBeGreaterThan(0);
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    for (const result of results) {
      const publishedTime = Date.parse(result.publishedDate);
      expect(Number.isNaN(publishedTime)).toBe(false);
      expect(publishedTime).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('excludes results whose publishedDate is unparseable or outside the requested recencyDays window', async () => {
    const recencyDays = 30;
    const results = await runSearchWeb({ query: 'Stripe funding news 2026', recencyDays });
    const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;
    for (const result of results) {
      const publishedTime = Date.parse(result.publishedDate);
      expect(Number.isNaN(publishedTime)).toBe(false);
      expect(publishedTime).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('excludes results from blocklisted domains', async () => {
    // Prone to surfacing finance-listicle spam from the blocklisted domains.
    const results = await runSearchWeb({ query: 'AAPL stock forecast analysis' });
    for (const result of results) {
      const hostname = new URL(result.url).hostname.replace(/^www\./, '');
      expect(KNOWN_BLOCKLIST_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))).toBe(
        false,
      );
    }
  });
});
