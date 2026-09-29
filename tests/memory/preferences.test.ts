import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import fs from 'node:fs';
import path from 'node:path';
import { listPreferences, addPreference, removePreference } from '../../src/memory/preferences.ts';

const TEST_TOOL_CALL_OPTIONS: ToolCallOptions = { toolCallId: 'test', messages: [] };

const PREFERENCES_PATH = path.join(process.cwd(), 'src/memory/preferences.md');

async function runListPreferences(): Promise<string> {
  return (await listPreferences.execute!({}, TEST_TOOL_CALL_OPTIONS)) as string;
}

async function runAddPreference(text: string): Promise<unknown> {
  return await addPreference.execute!({ text }, TEST_TOOL_CALL_OPTIONS);
}

async function runRemovePreference(text: string): Promise<unknown> {
  return await removePreference.execute!({ text }, TEST_TOOL_CALL_OPTIONS);
}

// Snapshot whatever is on disk before each test (usually nothing — preferences.md is
// created on first write) and restore it afterward so runs stay clean and repeatable.
let originalContent: string | null = null;

beforeEach(() => {
  originalContent = fs.existsSync(PREFERENCES_PATH) ? fs.readFileSync(PREFERENCES_PATH, 'utf8') : null;
});

afterEach(() => {
  if (originalContent === null) {
    if (fs.existsSync(PREFERENCES_PATH)) fs.unlinkSync(PREFERENCES_PATH);
  } else {
    fs.writeFileSync(PREFERENCES_PATH, originalContent, 'utf8');
  }
});

describe('preferences memory — listPreferences / addPreference / removePreference (preferences memory)', () => {
  it('listPreferences returns "" when the file does not yet exist', async () => {
    if (fs.existsSync(PREFERENCES_PATH)) fs.unlinkSync(PREFERENCES_PATH);
    const result = await runListPreferences();
    expect(result).toBe('');
  });

  it('addPreference creates the file with a # Preferences header on first write, and the addition round-trips through listPreferences', async () => {
    if (fs.existsSync(PREFERENCES_PATH)) fs.unlinkSync(PREFERENCES_PATH);
    await runAddPreference('Prefer subject lines under 50 characters.');
    const contents = await runListPreferences();
    expect(contents).toMatch(/^# Preferences/);
    expect(contents).toContain('Prefer subject lines under 50 characters.');
  });

  it('addPreference is idempotent on exact-match — adding the same text twice does not duplicate', async () => {
    if (fs.existsSync(PREFERENCES_PATH)) fs.unlinkSync(PREFERENCES_PATH);
    await runAddPreference('Always include the prospect\'s recent hiring trajectory in the overview section.');
    await runAddPreference('Always include the prospect\'s recent hiring trajectory in the overview section.');
    const contents = await runListPreferences();
    const occurrences = contents.split('Always include the prospect\'s recent hiring trajectory in the overview section.').length - 1;
    expect(occurrences).toBe(1);
  });

  it('removePreference removes a matching bullet via case-insensitive substring match', async () => {
    if (fs.existsSync(PREFERENCES_PATH)) fs.unlinkSync(PREFERENCES_PATH);
    await runAddPreference('For shipping and logistics companies, lead with 24/7 multilingual deflection.');
    await runRemovePreference('SHIPPING AND LOGISTICS');
    const contents = await runListPreferences();
    expect(contents).not.toContain('For shipping and logistics companies, lead with 24/7 multilingual deflection.');
  });

  it('removePreference removes only the first match when multiple bullets match the substring', async () => {
    if (fs.existsSync(PREFERENCES_PATH)) fs.unlinkSync(PREFERENCES_PATH);
    await runAddPreference('For logistics companies, lead with multilingual deflection.');
    await runAddPreference('For logistics companies, always mention 24/7 coverage.');
    await runRemovePreference('logistics companies');
    const contents = await runListPreferences();
    expect(contents).not.toContain('For logistics companies, lead with multilingual deflection.');
    expect(contents).toContain('For logistics companies, always mention 24/7 coverage.');
  });
});
