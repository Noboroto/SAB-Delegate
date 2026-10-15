# Word game under concurrent load (measured 2026-10-15)

Code: `apps/server/src/modules/word-game/word-game.{service,listener}.ts`, `dictionary.service.ts`.

- Correctness is DB-side: CAS `updateMany` on the state row (count, lastWord, lastUserId, started) + `@@unique([stateId, word])`. Do not add a lock/queue for correctness.
- Listener has a per-channel `p-limit(1)` queue around `submitWord` only, so moves are judged in arrival order; replies and meaning lookups stay outside the queue. 10 s timeout per queued move (the pg pool has no query timeout). p-limit 7 counters are already updated when the caller's `finally` runs (measured), so `activeCount===0 && pendingCount===0` safely drops an empty channel queue.
- Own last word again (same author, same word) → `NOTHING` (silent). Covers a second container on the same token during a deploy overlap, which usually reads the round AFTER the first one committed (so it never sees LOST_RACE and would otherwise answer SAME_AUTHOR ❌).
- Do NOT wrap listener handlers in try/catch "to log": `DiscordExceptionFilter` (via `@DiscordCommands()`) already catches every Necord listener error, logs it and reports to #bot-log; a local catch hides it from #bot-log (a spec asserts errors reach the filter).
- Dictionary (370,100 words, 6.8 MB JSON): JSON.parse ~120 ms + Object.keys ~50 ms + Set ~30 ms ≈ 200 ms blocking (Node, Mac). Loaded in `onApplicationBootstrap`. A word-per-line .txt would be ~55 ms; not worth it at boot.
- Owner 2026-10-15: keep the bundled list for judging (option A). Judging via en.wiktionary API was measured and rejected: 34/40 random list words found, p50 0.8 s / p90 1.6 s / max 4.9 s from VN, accepts typos/slang (`teh`, `lol`, lowercase `paris`).
- Meaning lookups: cap 4 distinct words in flight (`Set`, since lru-cache `has` is false for a pending fetch); past the cap the meaning reply is skipped, not queued.
- No BullMQ/Redis: pg-boss covers durable jobs; per-key ordering across processes is BullMQ Pro (paid); one process serves the token.
- Deploy check (2026-10-15, ea4befe): ~2 min after push `main` the containers still ran the old image and it looked like "webhook did not fire"; a minute later the build finished and all 4 checks passed. Check the Coolify deployment queue status (in progress/queued) before concluding the webhook failed or triggering by hand (a second trigger = needless restart).
- Birthday greeting: nonce = sha256(runId:discordId) base64url[0..25] + `enforceNonce`; `run.id` is the day row (stable across takeover) but takeover waits out the 5-min lease, so it mainly covers fast retries.
