# AI Sales Prospecting Agent

A console-based AI agent that researches a company, scores it as a sales prospect, persists the result to Airtable, and drafts a personalized outreach email — built with [Claude Code](https://claude.com/claude-code) and the [Vercel AI SDK](https://sdk.vercel.ai/).

Built while completing the LinkedIn Learning course *[Building an AI Agent with Claude Code](https://www.linkedin.com/learning/vibe-coding-your-first-ai-agent-with-claude-code)* (instructor: Basia Kubicka), then carried over here as a standalone project.

## What it does

The agent is built on four components — **Brain, Tools, Memory, Loop**:

- **Brain** — Claude (via the Vercel AI SDK's `generateText` / `generateObject`) reasons about each company, decides what to search, scores the lead, and drafts outreach.
- **Tools** — `searchWeb` (a hand-wrapped Tavily search tool) plus three preference-memory tools the Brain calls inside its loop: `listPreferences`, `addPreference`, `removePreference`.
- **Memory** — user preferences persisted to a local Markdown file (`src/memory/preferences.md`), read at the start of every run and applied to how the agent analyzes and pitches.
- **Loop** — the think → act → observe cycle, run by the Vercel AI SDK and bounded with `stopWhen: stepCountIs(...)`.

Structured research output is validated with Zod and upserted into an Airtable base (`Prospects` table); outreach drafts are saved to a linked `Outreach` table. See [`PRD.md`](./PRD.md) for the full spec.

## Usage

There's no CLI entry point — the agent is invoked from inside Claude Code in plain English:

| Action | What you type |
|---|---|
| Research a company | "Research Stripe" |
| Draft outreach | "Draft outreach for Stripe" (errors if there's no prior research) |
| Both | "Research Stripe and then draft outreach" |
| Run tests | `/tdd` or `npm test` |

## Setup

```bash
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY, TAVILY_API_KEY, AIRTABLE_API_KEY, AIRTABLE_BASE_ID
npm test
```

Requires Node 22+. No build step — the project runs end-to-end via `tsx`.

## Stack

TypeScript · Vercel AI SDK v5 (`generateText`, `generateObject`) · Claude (Anthropic) · Tavily REST API · Airtable hosted MCP · Zod · Vitest
