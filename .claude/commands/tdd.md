# /tdd

Run `npm test` — the only supported entry point (PRD §16.2: `tsc --noEmit && vitest`, env loaded from `.env`). Report the result in plain English. Nothing else runs — don't call vitest or tsc directly.

**On pass:** say exactly "All green — N tests passed." and stop. No other commentary.

**On failure:** in one sentence, classify it as exactly one of:

- **Expected TDD red** — the failing test asserts on a symbol, field, or behavior that the current build stage hasn't implemented yet (undefined export, missing field, not-yet-built function). This means the work is on track — say so and name the missing piece.
- **Regression** — a test that used to pass is now failing because of a recent code change to something it depends on. Name the failing test and the likely-culprit change (check the diff / recent edits to figure out which).
- **Test bug** — the test was just written or edited and asserts something wrong (bad expected value, bad setup, contradicts the PRD).

State the one-sentence verdict and **stop — do not propose or apply a fix.**
