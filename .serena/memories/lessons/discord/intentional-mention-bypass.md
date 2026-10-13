# Legacy openness = owner permission (owner, 2026-10-14)

Owner rule: wherever the legacy bot did NOT restrict something, that is a deliberate permission the owner
grants — not "bypassing" or "overstepping" permissions. New code must not add restrictions the legacy bot did
not have on the slash path (no caller permission checks, no stripping pings, no extra confirmations beyond what
the plan explicitly approved, no blocking cross-guild links).

Concrete examples:
- `/thread everyone`, `/mention everyone`: the bot pings thread members / @everyone / @here for members who lack
  "Mention Everyone" themselves. Keep exactly the legacy pings; a spec asserts the slash path's allowedMentions.
- `/mention` content with `@everyone`, thread posts mentioning roles, attendance pinging absentees, cross-guild
  message links — all allowed as in legacy.
- The client-wide default `allowedMentions: { parse: [] }` only stops accidental pings from echoed text in
  places legacy never pinged; commands that pinged in legacy override it per message.

Reviewers must NOT report these as missing permission checks or unsafe pings. Approved deviations are only
those written in the plan (e.g. purge confirmation, schedule time/date hard cut).
Non-Discord callers (REST/MCP, Release 2) are a new surface: they get the conservative default (no pings,
same-guild) unless the owner decides otherwise.
