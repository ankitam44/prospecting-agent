import { tool } from 'ai';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';

const PREFERENCES_PATH = path.join(process.cwd(), 'src/memory/preferences.md');
const HEADER = '# Preferences';

function readFile(): string {
  return fs.existsSync(PREFERENCES_PATH) ? fs.readFileSync(PREFERENCES_PATH, 'utf8') : '';
}

export const listPreferences = tool({
  description:
    "Read the user's saved preferences from memory. Call this at the start of every research run so saved preferences can shape the analysis.",
  inputSchema: z.object({}),
  execute: async (): Promise<string> => {
    return readFile();
  },
});

export const addPreference = tool({
  description:
    'Save a new user preference to memory as a bullet point. Call this only when the user explicitly states a preference to remember — never invent one.',
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }): Promise<void> => {
    const contents = readFile();
    const bullet = `- ${text}`;
    if (contents.includes(bullet)) return;
    if (!contents) {
      fs.writeFileSync(PREFERENCES_PATH, `${HEADER}\n\n${bullet}\n`, 'utf8');
      return;
    }
    const updated = contents.endsWith('\n') ? `${contents}${bullet}\n` : `${contents}\n${bullet}\n`;
    fs.writeFileSync(PREFERENCES_PATH, updated, 'utf8');
  },
});

export const removePreference = tool({
  description:
    "Remove a matching preference from memory. Call this when the user asks to forget or remove a previously saved preference.",
  inputSchema: z.object({ text: z.string() }),
  execute: async ({ text }): Promise<void> => {
    const contents = readFile();
    if (!contents) return;
    const needle = text.toLowerCase();
    const lines = contents.split('\n');
    const index = lines.findIndex((line) => line.startsWith('- ') && line.toLowerCase().includes(needle));
    if (index === -1) return;
    lines.splice(index, 1);
    fs.writeFileSync(PREFERENCES_PATH, lines.join('\n'), 'utf8');
  },
});
