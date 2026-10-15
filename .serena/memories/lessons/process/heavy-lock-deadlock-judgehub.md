# Heavy lock: deadlock with JudgeHub's sab_priority (measured 2026-10-15)

- JudgeHub's `locked.sh` yields to any live `cc-heavy.sab-delegate*-wants` flag until 2026-10-15 23:59 (`sab_priority`), while SAB's `.husky/lib/heavy-lock.sh` yields to any OLDER live wants flag (JudgeHub's). Both wait forever with `holder: none` (seen 12 min on commit, again on pre-push).
- **How to unblock (owner intent = SAB first):** stop only your own waiting git process group (`kill -TERM -<pgid>`; the hook removes its flag), `mkdir /tmp/cc-heavy.lock` + owner line, then run `git commit`/`git push` with `export CC_HEAVY_OWNER='<owner line>'` (hook honours it), release owner-checked at the end (trap).
- Check first: `/tmp/cc-heavy.lock` absent + both flags fresh + `holder: none` in the hook log = this deadlock, not a busy machine.
- Also measured: the hook runs the WORKING TREE suite; a pre-existing flaky web test (`note-page` validation count under load) failed once → fixed with `waitFor`.
