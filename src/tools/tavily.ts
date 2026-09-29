import { tool } from 'ai';
import { z } from 'zod';

const MAX_RESULTS = 5;

// SEO-spam finance listicles that surface for any company-name query and
// contribute zero support-fit signal.
const BLOCKLIST = [
  'tipranks.com',
  'seekingalpha.com',
  'fool.com',
  'benzinga.com',
  'investorplace.com',
];

type SearchResult = { title: string; url: string; snippet: string; publishedDate: string };

type TavilyRawResult = {
  title: string;
  url: string;
  content: string;
  published_date?: string;
};

function isBlocklisted(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
  return BLOCKLIST.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export const searchWeb = tool({
  description:
    'Search the web for recent news about a company — funding, hiring, partnerships, product launches. Use this to gather buying-signal evidence for prospect research.',
  inputSchema: z.object({
    query: z.string(),
    recencyDays: z.number().int().positive().optional(),
  }),
  execute: async ({ query, recencyDays = 90 }): Promise<SearchResult[]> => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error('TAVILY_API_KEY is not set. Add it to .env or your Codespaces secrets.');
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        topic: 'news',
        days: recencyDays,
        max_results: MAX_RESULTS,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily search failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as { results?: TavilyRawResult[] };
    const rawResults = data.results ?? [];

    const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;

    return rawResults
      .filter((result) => !isBlocklisted(result.url))
      .filter((result) => {
        if (!result.published_date) return false;
        const publishedTime = Date.parse(result.published_date);
        return !Number.isNaN(publishedTime) && publishedTime >= cutoff;
      })
      .map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.content,
        publishedDate: result.published_date as string,
      }));
  },
});
