# Dev bot sharing a production token (measured 2026-10-13)

Setup: new server ran locally with the Alohomora token (also used by the live legacy prod bot), registering
`/ping` and `/set` guild-scoped in dev guild 713025650176294945.

Observed:
- Discord shows BOTH the app's global commands (17 legacy commands incl. ping, set) and the guild-scoped ones
  in that guild -> duplicate `/ping` and `/set` in the picker. Guild commands do not hide same-named globals.
- Both processes hold a gateway session for the same application, and both receive every
  INTERACTION_CREATE. Whichever answers first wins; the other gets `DiscordAPIError[10062]` (2 seen in the dev
  log). So the legacy prod bot also handles the dev guild's commands (writing the prod quick.db) and the dev
  bot handles global legacy commands it knows by name.
- Wiping/re-registering does not fix it; the race is per token.

Rule: live-test the new bot only with a token of a separate application (SAB Dev) that nothing else runs.
A shared prod token is acceptable only for boot/login/registration checks with no human interaction, and
must be stopped right after. The registrar itself behaved correctly (guild scope only; second boot
"unchanged" after fetching with `with_localizations=true`).
