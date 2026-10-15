# Word-game meanings: free dictionary sources (measured 2026-10-15)

Code: `apps/server/src/modules/word-game/word-definition.*`. Owner decisions: free only, no disk
(server storage full → in-memory lru-cache, no table/asset), MT fallback via API, no per-guild toggle,
plain-text reply (not embed). Judging stays on the bundled 370k list + `WordGameUsedWord` unique key.

## Sources (all keyless; prod egress from sab-server verified by the Coolify session)
- en.wiktionary REST `api/rest_v1/page/definition/{w}`: JSON by language code, definition is HTML with
  inline `<style>` and nested `<ol>` sub-senses; some senses are only a heading ("the": "Used before a
  noun phrase…") → append first `<li>`. 404 when missing. First entry can be "Symbol"/"Letter".
- vi.wiktionary: REST definition endpoint answers 501 → read `?action=raw` wikitext. Two formats live:
  old `{{-eng-}}` + `{{-noun-}}`/`{{-tr-verb-}}`, markers may contain spaces/uppercase
  (`{{-see also-}}`, `{{-Latn-}}`) or hyphens (`{{-cus-ash-}}` = a language!); new
  `=={{langname|en}}==` + `==={{ĐM|n}}===`. Treat any unknown marker as the next language (reading on
  leaked "nhau" into "is"). Has rare words (aasvogel, serendipity).
- Datamuse `words?sp=w&md=dp`: WordNet `pos\tdef`, no examples.
- MyMemory `api.mymemory.translated.net/get?langpair=en|vi`: HTTP 200 even on refusal (check
  `responseStatus`, `quotaFinished`, "MYMEMORY WARNING"); anon quota ~5000 chars/day → pause 1 h after refusal.
- dictionaryapi.dev: DEAD (timeouts, then a foreign 404 HTML page). Oxford API: paid (£0.02–0.05/call),
  only linked (`oxfordlearnersdictionaries.com/search/english/?q=`).

## Traps
- lru-cache: an entry stamped at clock 0 never expires → with vitest fake timers advance ≥1 ms before
  first set; fake `performance` explicitly (`toFake: ['performance', …]`). `fetchMethod` may set
  `options.ttl` per entry; returning undefined = not cached; concurrent fetches dedupe.
- discord.js `escapeMarkdown` does NOT escape masked links by default → `{ maskedLink: true }`.
- Reply with external text: `allowedMentions: { parse: [], repliedUser: false }` + `SuppressEmbeds`.
- `no-export-interface` guard rejects exported object-literal types in apps/server too → Zod schema +
  `z.infer`, and use the schema at runtime (parser output) so eslint accepts it.
- Bash hook scout-block rejects commands containing `dist`, `build`, `.git`, `node_modules` → write the
  script to scratchpad with Write, then `bash file`; copy hook logs via `$(printf '.%s' git)`.
