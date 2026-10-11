# discord.js — cạm bẫy đã gặp

- `ephemeral: true` và `fetchReply` deprecated → `flags: MessageFlags.Ephemeral`, `withResponse: true`
  (tin vừa gửi ở `response.resource.message`).
- Tin > 2000 ký tự bị từ chối → chia khối; khối đầu `reply`, các khối sau `followUp`.
- `client.guilds.fetch(id)` với guild bot đã bị kick → `DiscordAPIError[10004] Unknown Guild`;
  phải `.catch` từng guild, nếu không cả vòng cron sinh nhật dừng.
- Subcommand `execute` không `await` → lỗi thoát khỏi try/catch của `interactionCreate` → unhandled rejection.
- **How to apply**: tra `context7` cho API discord.js trước khi dùng; luôn await/return promise.

## Bổ sung từ bài học các repo khác (11/10/2026)
- discord.js 14 phụ thuộc `undici`: undici userland 8.11.0/8.11.1 làm `fetch` toàn cục Node 24 trả gzip thô; ghim ≥ 8.11.2 (override pnpm), đo `fetch` + REST thật sau mỗi lần nâng. Không gọi Discord API trong `prisma.$transaction`.
