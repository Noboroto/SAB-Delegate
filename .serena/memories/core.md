# SAB-Delegate — Core (điểm vào cấp cao nhất)

Bot Discord (discord.js 14, TypeScript, chạy bằng tsx, không bước build; pnpm; Node 24).
Một tiến trình đăng nhập NHIỀU bot: mỗi token trong env `TOKENS` (phẩy phân cách) = một `Client`
dùng chung events/commands (prod: bot "Sabi" và "Alohomora"). Ngôn ngữ trao đổi: tiếng Việt.

**Nguồn sự thật ngoài memory**: `AGENTS.md` (luật cứng). Memory chỉ tóm tắt + sự thật đã đo.

## Bài học đã đo (đọc TRƯỚC khi làm)
`mem:lessons/index` — deploy Coolify, pnpm/runtime, cạm bẫy discord.js + nhiều bot một tiến trình, quy trình agent/việc nặng.

## Source map
```
root/                      package `sab-delegate` (cwd khi chạy bot)
  src/index.ts             tạo Client cho mỗi token, gắn events, login
  src/events-bot/          ready (cron sinh nhật 00:00 + đăng ký command khi CREATE_CMD≠0),
                           interactionCreate (dispatch command, báo lỗi về kênh bot-log),
                           messageCreate (trò nối từ…), messageUpdate
  src/commands/*.ts        mỗi file = 1 slash command, nạp tự động bằng readdirSync
  src/commands/<cmd>/      subcommand: export { name, addCommand, execute }
  src/ultils/              (sic) db.ts (5 QuickDB), configManager, scheduler (in-memory),
                           happyBirthday, wordGame, noteUltils, messageReaction
  constants/               birthday.json (lời chúc), word-dict.json (seed từ điển), reactionsDict.json
  files/                   sqlite runtime (gitignored) — prod mount ./root/files → /usr/files
dockerfile                 2 stage, cài từ lockfile frozen
coolify.compose.yml        PROD (Coolify, build từ source)
prod.compose.yml, compose.yml   thiết lập cũ Portainer/NPM, giữ làm phương án lùi
```

## Bất biến hay bị làm sai
- Guild quản trị `713025650176294945`, kênh `bot-log` nhận lỗi command (hardcode ở index.ts, interactionCreate.ts).
- DB: `noteDb`, `wordDb`, `dictDb`, `birthdayDb`, `configDb` — path từ env `*_DB_PATH`.
- Lịch hẹn gửi tin (`ultils/scheduler.ts`) chỉ sống trong RAM → mất khi restart/deploy.
- Prod không đặt `CREATE_CMD`; đặt `CREATE_CMD=1` thì bot xoá + đăng ký lại command rồi tự `destroy()`.

## Tham chiếu
- Cách bảo trì memory: `mem:memory_maintenance`
