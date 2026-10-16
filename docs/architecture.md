# Kiến trúc chạy thật (Release 1)

Phạm vi: bố cục tiến trình, ranh giới và LÝ DO. Hành vi chi tiết nằm ở code; cách vận hành ở `docs/deployment.md`; cutover ở `docs/cutover-runbook.md`; lý do chọn gói và số đo ở `docs/stack-decisions.md`; lệnh ở `docs/commands.md`. Release 2 (web, REST, auth, MCP) chưa nằm trong tài liệu này vì chưa chạy trên prod.

## Bố cục

```
 Coolify host (Traefik)                              mạng ngoài `sab-db` (tạo tay)
 ┌─ Resource A: Postgres (riêng) ───────┐   ┌─ Resource B: app compose (repo, nhánh main) ───────────────┐
 │ alias `sab-postgres`, không `ports:`  │<─>│ sab-release  (one-shot) ──service_completed_successfully──┐ │
 │ role: migrate · runtime · backup      │   │ sab-server   (Necord bot + Prisma + pg-boss + /health) <───┘ │
 │ dữ liệu: /srv/appdata/sab-delegate/   │   │ sab-backup   (vòng sleep tới 03:00, role backup)             │
 └───────────────────────────────────────┘   └──────────────────────────────────────────────────────────────┘
```

Nơi sở hữu: `coolify.compose.yml` (stack prod), `deploy/postgres.compose.yml` (nội dung resource Postgres), `apps/server/Dockerfile` (target `runner`, `release`), `apps/server/scripts/` (release, backup, restore drill).

## Quyết định và lý do

| Quyết định                                                                                              | Lý do (không suy lại khi chưa có bằng chứng mới)                                                                                                                            |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MỘT tiến trình NestJS (Fastify) chứa bot Necord, Prisma và pg-boss                                      | Một bot Sabi thay cho hai token cũ; không Redis/BullMQ; lịch hẹn và cron nằm trong Postgres nên sống qua restart                                                            |
| Postgres là resource Coolify RIÊNG, không nằm trong compose app                                         | Coolify xoá và dựng lại CẢ stack compose mỗi deploy; DB không được restart theo mỗi lần đẩy code                                                                            |
| Image DB `postgres:18` Debian, ghim theo digest; session `-c timezone=UTC`                              | `uuidv7()` cần PG18; glibc cho `lower()` tiếng Việt; hai bài học ở `mem:lessons/deploy/coolify-host-images-and-build-cache` và `mem:lessons/postgres-prisma/ids-time-image` |
| `sab-release` one-shot chạy TRƯỚC server, server `depends_on` dạng map `service_completed_successfully` | Migrate lỗi thì server không khởi động; dạng list không chờ                                                                                                                 |
| Backup là service riêng, KHÔNG có BackupModule trong server                                             | Server không giữ quyền ghi/xoá dump; một `backup.sh` dùng chung cho release và job hằng ngày                                                                                |
| Ba role Postgres: `migrate` (DDL, chỉ release), `runtime` (DML, server), `backup` (đọc)                 | Server bị chiếm cũng không đổi được schema; runtime không có `CREATE`                                                                                                       |
| Chỉ ba service tham gia `sab-db`; mỗi service có khối `environment:` tường minh                         | Coolify bơm env rộng; token và mật khẩu chỉ tới service cần nó. `TOKENS` cũ không nằm trong bất kỳ allowlist nào                                                            |
| Slash command KHÔNG kiểm quyền người gọi                                                                | Luật chủ bot; xem `docs/commands.md`                                                                                                                                        |

## Trong `sab-server`

Điểm vào `apps/server/src/main.ts`; cổng cố định 3100. Module gốc `apps/server/src/app.module.ts`.

| Thành phần               | Vai trò                                                                                                                                                                        | Ghi chú đáng nhớ                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `config/env.ts`          | Zod validate env lúc boot (fail-fast, chỉ in TÊN biến)                                                                                                                         | Thay cho `${VAR:?}`                                                       |
| `prisma/`                | Prisma 7 + `adapter-pg`, pool luôn UTC                                                                                                                                         | Không gọi Discord API trong `$transaction`                                |
| `jobs/`                  | Facade pg-boss, một cửa duy nhất                                                                                                                                               | Runtime không `CREATE`: không tự cài schema `pgboss`, release làm việc đó |
| `app-state/`             | Cặp khoá-giá trị (băm bộ lệnh đã đăng ký)                                                                                                                                      | Xem phần đăng ký lệnh                                                     |
| `discord/`               | `BootGuard`, `CommandRegistrar`, `DiscordReadyService`                                                                                                                         | Xem bên dưới                                                              |
| `modules/*`              | Một module cho mỗi nhóm lệnh: guild-config, system, birthday, note, reactions, word-game, schedule, messaging, mention, role-assign, thread, purge, activity, attendance, info | Danh sách thật ở `modules/feature-modules.ts`                             |
| `health/`                | `/health` readiness, `/health/live` liveness                                                                                                                                   | Xem bên dưới                                                              |
| `tools/migrate-quickdb/` | Công cụ nạp quick.db và `export-claims`                                                                                                                                        | TẠM THỜI, xoá cùng bot cũ                                                 |

### Khởi động

1. `loadEnv()` kiểm toàn bộ env trước khi mở socket.
2. `BootGuard` gọi `GET /users/@me` và từ chối nếu token thuộc application không khớp `DISCORD_CLIENT_ID` hoặc không nằm trong `DISCORD_ALLOWED_APP_IDS`. Lý do: token prod dán nhầm vào bản dev sẽ đăng nhập rồi GHI ĐÈ lệnh của application đó.
3. Necord đăng nhập. Khi `clientReady`, registrar đăng ký lệnh, rồi `DiscordReadyService` mở cổng: worker pg-boss và cron chỉ đăng ký SAU bước này (worker nhận job khi bot chưa gửi được tin thì job hỏng vô ích).
4. `MIGRATION_PENDING=true`: không nạp Necord và các module cần Discord; bot không đăng nhập, không đăng ký lệnh, không cron. Dùng đúng một lần, ở cutover, để nạp dữ liệu cũ trước khi bot phục vụ.

### Đăng ký lệnh

Prod đăng ký toàn cục, dev chỉ trong `DISCORD_DEV_GUILD_ID` (bắt buộc ở dev, cấm ở prod: tránh kéo lệnh khỏi guild thật). Băm payload lưu trong `AppState` theo application và phạm vi; băm khớp vẫn phải đối chiếu `GET` với Discord vì lệnh có thể bị xoá tay hoặc bị `CREATE_CMD` của bản cũ thay. Bulk `PUT` thay CẢ bộ lệnh, nên bộ lệnh khai báo phải đủ trước khi deploy prod. `COMMANDS_FORCE_RESET` là cờ một lần: xoá rồi đăng ký lại; chỉ trong phạm vi của chính môi trường đó. Cách dùng: `docs/deployment.md`.

### Health

- `GET /health`: readiness. 200 khi Postgres trả lời VÀ Discord đã `ready`; 503 nếu không; `migration-pending` là trạng thái khoẻ hợp lệ riêng. HEALTHCHECK của image và compose bám cái này, để Coolify không coi bản mới là lên trước khi gateway lên.
- `GET /health/live`: chỉ báo tiến trình sống, không phụ thuộc gì. Phải xanh khi Postgres đang restart hoặc gateway đang nối lại, nếu không bộ giám sát sẽ giết đúng tiến trình đang tự hồi phục.

### Tắt máy (SIGTERM)

Thứ tự quan trọng vì job đang chạy vẫn dùng client và pool:

1. `onModuleDestroy`: pg-boss `stop({ graceful: true })` chờ job đang chạy (tối đa 30 s); cờ "đang dừng" bật để vòng lặp qua nhiều guild dừng giữa chừng.
2. `beforeApplicationShutdown`: `client.destroy()` (cổng gateway).
3. `onApplicationShutdown`: Prisma `$disconnect` và đóng pool.

`stop_grace_period` của compose phải lớn hơn 30 s (45 s). Nếu Prisma đóng sớm hơn pg-boss, job dang dở sẽ thấy pool đã chết; bài học ở `docs/stack-decisions.md` mục 2.2.

## Dòng dữ liệu

**Sinh nhật.** pg-boss lịch `0 0 * * *` múi giờ `Asia/Ho_Chi_Minh` (queue `birthday-daily`), cộng bù khi lỡ. Handler còn chạy ngay khi bot `ready`, vì lịch có thể trễ và tiến trình có thể vừa khởi động lại. Mọi lần chạy đều an toàn khi lặp: lease theo ngày trong `BirthdayService` quyết định ai chúc, tính "hôm nay" theo giờ Việt Nam từ đồng hồ. Hệ quả: deploy hay restart quanh 00:00 không chúc đôi và không bỏ sót.

**Hẹn giờ gửi tin.** Lệnh ghi một dòng trong DB rồi, SAU commit, đẩy job (queue `scheduled-message-send`, id job = id dòng, nên retry không tạo job trùng). Worker nhận job, giữ lease trên dòng bằng cập nhật có điều kiện rồi mới gửi; ghi kết quả cũng có điều kiện theo lease. Tiến trình chết giữa lúc gửi thì lease hết hạn và lần chạy sau gửi nốt (at-least-once, cửa sổ trùng hẹp). Lịch KHÔNG còn mất khi deploy, khác bản cũ giữ trong RAM. Nội dung/tệp đọc lúc đến giờ (`schedule-copy`).

## Chatbot

Một câu trả lời đi từ lời nhắc bot tới dòng cuối. Mã nằm ở `apps/server/src/modules/chatbot/` (nghe tin: `chatbot.listener.ts`; một lượt trả lời: `chatbot.service.ts`), gọi mô hình ở `apps/server/src/modules/llm/llm-chat.service.ts`. Mặc định TẮT cho mọi guild; guild phải bật và chỉ định kênh (lệnh: `docs/commands.md` mục 17; công cụ MCP: `docs/mcp.md`). Hằng số (trần, cửa sổ, hạn mức mặc định, thời hạn) ở `packages/shared/src/constants/chatbot.ts`; chỗ nào dưới đây nói "hằng số" là chỗ đó.

```
messageCreate (tin trong guild, không phải bot)
  -> khớp kênh đã chỉ định + guild bật?        (route có cache ngắn, thread tính theo kênh cha)
  -> nhắc bot HOẶC trả lời một tin của bot?     (@everyone/@role không tính)
  -> claimPending: ghi dòng ChatbotTurn PENDING (triggerMessageId UNIQUE)   <- thua = bỏ
  -> người này đang có câu trả lời chạy?  có: thả ⏳, đóng dòng, dừng
  -> hàng đợi theo kênh -> giới hạn đồng thời chung (3 câu cùng lúc, mọi guild)
       chọn mô hình: của guild, hay dùng chung, hay không có (trả lời "chưa cài")
       hết token tháng -> trả lời "hết token"; mô hình đang tạm dừng -> trả lời "tạm dừng"
       đọc ngữ cảnh: tin kênh gần nhất + tóm tắt kênh + tóm tắt người hỏi + vài lượt gần nhất của họ + ảnh / .txt
       quota.reserveForTurn: giữ chỗ token, GHI giữ chỗ lên dòng PENDING cùng transaction
       LlmChatService.chat: SDK `ai` qua transport chống SSRF
       settleTurn (dùng số token nhà cung cấp báo) | refundTurn (lỗi)
       gửi trả lời (chia khối), cuối là `-# còn lại x / tổng`
       finalize dòng ChatbotTurn (OK / QUOTA_EXHAUSTED / NOT_CONFIGURED / FAILED)
       nền: đếm lượt; đủ chu kỳ thì viết lại tóm tắt (tính vào token của người hỏi)
```

Quyết định và lý do:

| Quyết định | Lý do |
| --- | --- |
| Dòng `ChatbotTurn` là hàng đợi bền; KHÔNG dùng pg-boss cho câu trả lời | pg-boss thêm độ trễ nhận job và có thể xử lý đôi (lần gửi lại + tiến trình khác). Ở đây `triggerMessageId` UNIQUE quyết định ai trả lời: bản giao lại hoặc tiến trình khác thua ngay ở bước ghi. Trả lời chậm là lỗi nhìn thấy được, nên không có hop trung gian |
| Ghi PENDING TRƯỚC khi làm gì khác | Khởi động lại giữa chừng không làm mất lời nhắc. Không ghi được vào DB thì VẪN trả lời (không ghi lịch sử) vì mất câu trả lời tệ hơn mất một dòng lịch sử |
| Mỗi thành viên một câu trả lời tại một thời điểm; mỗi kênh một hàng đợi | Chặn một người đốt token song song và giữ đúng thứ tự trả lời trong kênh. Tin thứ hai của người đó bị thả ⏳ và bỏ qua, không xếp hàng |
| Giữ chỗ token trước khi gọi mô hình, quyết toán theo số nhà cung cấp báo | Hai câu trả lời đồng thời của một người không tiêu cùng token: các bộ đếm đổi bằng một câu SQL. Nhà cung cấp không báo token thì dùng ước lượng theo số ký tự và đánh dấu `estimated`. Hạn mức có thể bị vượt tối đa một lần gọi, lần sau bị chặn |
| Giữ chỗ nằm trên dòng lượt, người đầu tiên lấy được thì nhả về 0 | Quyết toán và hoàn trả đi qua một dòng đã khoá: đúng một bên lấy được. Khởi động lại đã hoàn trả thì lần quyết toán muộn trả `null` và KHÔNG tính tiền lần hai |
| Tháng hạn mức theo múi giờ nghiệp vụ (`Asia/Ho_Chi_Minh`), chốt theo tháng LÚC GIỮ CHỖ | Cuộc gọi chạy qua nửa đêm vẫn vào tháng nó bắt đầu |
| Tóm tắt viết lại SAU khi gửi trả lời, trong tiến trình, không qua pg-boss | Mất một lần tóm tắt chỉ làm chậm trí nhớ (không mất dữ liệu); số token của nó nằm ở dòng cuối của lần sau. Tắt máy chờ tối đa 20 s cho các việc nền này |
| Ngữ cảnh kênh là cửa sổ đọc trực tiếp, KHÔNG lưu | Chỉ ảnh chụp những gì mô hình nhận được cho từng lượt (không có byte ảnh hay tệp) được lưu trên dòng lượt, để quản trị xem lại; tin kênh gốc vẫn là của Discord |
| Ảnh và `.txt` lấy từ tin nhắn và tin được trả lời | Giới hạn kích thước và số lượng ở hằng số; phần quá dài bị cắt kèm thông báo |
| Bộ nhớ theo guild, không bao giờ qua guild khác | Mọi dòng bộ nhớ, hạn mức, lượt đều khoá bằng id guild; chỉ tóm tắt của chính người hỏi được đưa vào prompt |
| Câu trả lời không ping ai | `allowedMentions` rỗng; chỉ người hỏi bị ping bằng cơ chế trả lời. Tin của người hỏi đã bị xoá thì gửi tin thường có nhắc tên họ |

### Hạn mức

Mỗi thành viên mỗi guild mỗi tháng: hạn mức (riêng, hoặc mặc định của guild, hoặc mặc định cài sẵn) cộng thưởng của tháng, trừ đã dùng. Dòng cuối của câu trả lời là số CÒN LẠI sau chính câu đó, nên bằng với `/chat usage`. Hết token: trả lời ngắn, không gọi mô hình, không đọc kênh. Cuộc gọi lỗi thì hoàn trả đủ phần giữ chỗ; lỗi quyết toán thì phần giữ chỗ vẫn bị tính (câu trả lời quan trọng hơn sổ sách tuyệt đối).

### Khởi động lại

Sau `clientReady`, `ChatbotRecoveryService` quét các dòng PENDING được ghi TRƯỚC khi tiến trình này khởi động: hoàn trả phần giữ chỗ (đúng một lần), rồi hoặc trả lời lại (qua chính hàng đợi của listener) nếu lời nhắc không quá 10 phút tuổi, kênh còn được chỉ định và bot chưa trả lời, hoặc đóng là EXPIRED không trả lời. Dòng vừa được chạm trong hai phút có thể vẫn đang được tiến trình cũ xử lý nên lượt quét đầu bỏ qua; một lượt quét nữa sau khoảng chờ đó nhặt phần còn lại. Câu trả lời đến quá muộn chỉ làm kênh rối, nên chủ bot chọn hết hạn sau 10 phút.

### Nhà cung cấp hết credit

Khi nhà cung cấp từ chối vì hết credit (402, hoặc 429/400 có từ khoá hết số dư; hạn mức theo phút/ngày thì KHÔNG tính), mô hình đó bị tạm dừng 15 phút: tin của thành viên được trả lời ngay "tạm dừng" thay vì trả tiền cho cuộc gọi chắc chắn lỗi, lượt ghi `provider_quota`. Lần từ chối đầu tiên của một đợt gửi một embed vào `#bot-log` của guild quản trị (tên model và host, không bao giờ có khoá hay lời nhà cung cấp). Hết cửa sổ thì cho đúng một cuộc gọi thử; thành công thì xoá tạm dừng, vẫn từ chối thì gia hạn. Trạng thái nằm trong RAM: khởi động lại thì thử lại ngay. Lưu, xoá hoặc thử thành công mô hình của guild (hay lưu lại mô hình dùng chung) thì xoá tạm dừng tương ứng. `/chatbot status` cho thấy đang tạm dừng đến khi nào. Mã: `apps/server/src/modules/llm/chatbot-pause.service.ts`.

### Dữ liệu và lưu giữ

Schema: `apps/server/prisma/schema/chatbot.prisma` (ba migration cùng tiền tố `chatbot`, thuần additive, đi theo luồng `migrate deploy` thường lệ; ràng buộc CHECK viết tay ở cuối từng `migration.sql`). Mọi bảng chatbot xoá theo `Guild` (cascade). Lịch sử lượt hỏi đáp bị xoá sau 90 ngày bởi job pg-boss `15 3 * * *` giờ nghiệp vụ (`chatbot-history.cron.ts`), xoá theo lô, chạy lại an toàn. Quản trị cũng xoá được theo lượt / thành viên / toàn guild (dashboard, MCP), thành viên xoá lịch sử và bộ nhớ của mình bằng `/chat`. Khoá API của guild lưu mã hoá bằng `LLM_KEY_SECRET`, chỉ hiện 4 ký tự cuối; guild có mô hình riêng mà khoá không giải mã được thì bị coi là "chưa cài", KHÔNG lặng lẽ dùng khoá dùng chung.

## Sổ tay đọc tiếp

- Số đo thật và gói đã loại: `docs/stack-decisions.md`.
- Vận hành, backup, đăng ký lại lệnh: `docs/deployment.md`.
- Thay bot cũ: `docs/cutover-runbook.md`.
- Giao diện MCP cho AI agent (khoá, tool, xác nhận): `docs/mcp.md`.
- Quy tắc giao diện dashboard (căn lề, chiều cao control, nút, form, bảng): `docs/ui-rules.md`.
- Luật cứng và bài học đã đo: `AGENTS.md` và serena `mem:lessons/index`.
