# Committing through the SAB hooks while agents work (measured 2026-10-13)

- Pre-commit gates run on the WORKING TREE, not the index. Never commit while an edit agent is changing files: tests of half-done work fail the commit, and the prettier restage step can pull the agent's edits of staged files into the commit. Wait for edit agents, then commit slices in order.
- The hook waits for `/tmp/cc-heavy.lock`; other repos (JudgeHub browser review, Leaderboard, mailmerge) can hold it 15–55 min. Run long commits with `run_in_background`. A foreground commit can die with exit 144 and leave an orphaned hook (PPID 1) still queued on the lock — find it by `lsof -a -p <pid> -d cwd` = this repo, kill only that PID, re-run.
- Agents waiting on the lock must keep their wants-flag epoch stable; resetting it each poll loses queue position.
- New guard tests written by an agent are often first executed by the hook: expect 1–3 failures (seen: `$'` replace pattern, inline `#` comment matched by prune regex, baseline ref stale). Run new guard specs directly before committing.
- knip: a CLI entry (`src/tools/*/main.ts`) must be declared as a knip entry or every export it uses is "unused".
- The shared `no-export-interface` guard covers apps/server too: internal tool types must be `z.infer` of Zod schemas (and eslint rejects schemas used only for types, so use them at runtime boundaries) or not exported.
