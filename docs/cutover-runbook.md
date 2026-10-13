# Runbook thay bot cũ bằng bot mới (cutover)

Phạm vi: các bước, lệnh, tiêu chí đi tiếp và đường lui khi thay bot quick.db (hai token Sabi/Alohomora) bằng MỘT bot Sabi chạy Postgres. Đây là tài liệu tạm thời: xoá sau khi cửa sổ rollback đóng và repo đã dọn. Cấu hình thường nhật ở `docs/deployment.md`; kiến trúc ở `docs/architecture.md`. Chỗ ghi "(xác nhận sau khi compose xong)" phải đối chiếu lại với file thật trước khi chạy.

Quy ước: lệnh chỉ ghi TÊN biến, không bao giờ in giá trị bí mật. `<c>` là container `sab-server`, tìm bằng:

```sh
docker ps --filter label=com.docker.compose.service=sab-server --format '{{.Names}}'
```

(trên host đông project, thêm lọc theo nhãn `com.docker.compose.project` của app này).

## Vai trò

| Vai | Làm gì |
| --- | --- |
| Owner | Quyết đồng ý từng hành động không đảo ngược (push `main`, xoá dữ liệu, đổi env prod); nhập token qua giao diện Coolify; chọn cửa sổ; xác nhận bằng lời đã hiểu "dữ liệu ghi sau cutover mất khi rollback"; chạy script dọn lệnh Alohomora; tải tay dump `baseline` |
| Orchestrator | Chạy lệnh trên host và git, đọc lại trạng thái đích sau MỖI bước, ghi kết quả; giữ đồng hồ 20 phút; chỉ orchestrator dừng/khởi động container |
| Subagent | Không chạm prod. Chỉ viết file trong repo |

## Điều kiện vào (thiếu một là KHÔNG sang T0)

1. Reset token bị lộ đã xong (cứng, không ngoại lệ): mọi token từng lộ đã reset, token prod đã ánh xạ token → app → guild, đã xoá `root/src/configValues.ts`, và `pnpm secrets:history` sạch (không còn entry allowlist "chưa ánh xạ"). Thứ tự an toàn với đường lui: chỉ reset token của app KHÔNG chạy prod, hoặc app prod thì cập nhật `TOKENS` và redeploy ngay ngoài giờ, để token cũ dùng cho đường lui còn hợp lệ.
2. Registry lệnh có đủ 16 lệnh gốc (trừ `/shutdown` đã bỏ có chủ đích) và catalog khớp danh sách lệnh bot cũ. Lý do: registrar ghi đè cả bộ lệnh toàn cục, deploy khi chưa đủ sẽ XOÁ lệnh chưa port.
3. Dry-run công cụ migration trên BẢN COPY thật cho `BIRTHDAY_DUPLICATE_STUDENT` = 0. Khác 0 thì owner xem lại trước `--apply` (bản đầu giữ, bản sau không được chúc).
4. Smoke test cục bộ image prod (linux/amd64) đạt; rollback rehearsal cục bộ đạt (build lại bot cũ từ tag `legacy-final`, `export-claims`, chạy bản cũ với token SAB Dev và `CREATE_CMD=1`); restore drill đạt; release fail-closed đã chứng minh; S5 phía ghi (mạng `sab-db`, alias, `service_completed_successfully`, 3 role, inject env) đã đo và ghi ở `docs/deployment.md`.
5. Cả hai token cũ đăng nhập được (`GET /users/@me` OK, chỉ in boolean); Sabi đã ở các guild từng chỉ có Alohomora; intents privileged của app Sabi prod đã bật (GuildMembers, MessageContent; không Presences).
6. Phần ngoài repo đã xong: mạng `sab-db`, resource Postgres + ba role, thư mục bind mount, `/srv/appdata/_archive/sab-delegate`; biến Release 1 trên Coolify (`is_buildtime=false`): `DISCORD_TOKEN` = token Sabi (owner nhập), `DISCORD_CLIENT_ID`, `DISCORD_ALLOWED_APP_IDS`, `ADMIN_GUILD_ID`, `APP_ENV=production`, `MIGRATION_PENDING=true`, `POSTGRES_*`. GIỮ `TOKENS` (ngoài allowlist mọi service mới).
7. Baseline ghi trên host (ngoài repo): đếm row từng file sqlite, đầu ra `birthday get-list` của guild sinh nhật, lịch hẹn đang chạy qua `/scheduler get` từng guild (job RAM cũ sẽ mất, owner tạo lại sau).
8. Định danh để lùi: SHA `main` hiện tại, id deployment Coolify hiện tại, ảnh chụp cấu hình app (repo, nhánh, build pack, đường dẫn compose, TÊN biến); tag cục bộ `legacy-final` trên `main`.
9. Ứng viên merge: nhánh `cutover-candidate` = merge `dev` → `main` (message KHÔNG chứa `[skip cd]`), đã qua gate đầy đủ cho đúng SHA, ba image build từ đúng SHA không cache cục bộ; review hạ tầng và an toàn dữ liệu đã xanh. Nếu build lạnh trên host dự kiến quá 8 phút, dùng thứ tự phụ: push TRƯỚC T0 (server `MIGRATION_PENDING` không đăng nhập nên không trùng token), rồi dừng và sao dữ liệu; hạn 20 phút vẫn tính từ lúc bot cũ ngừng phục vụ.
10. Cửa sổ: sau 00:00 (cron sinh nhật bản cũ đã chạy, ngày hôm nay đã chúc), trước giờ cao điểm, không có lịch hẹn quan trọng, đã báo trong kênh quản trị, owner xác nhận bằng lời.
11. `df -h /` trên host đủ chỗ (dưới ngưỡng thì dọn hoặc dừng); đã đọc thông báo admin (cuối tài liệu) và sẵn sàng đăng.

## Hạn 20 phút

Từ T0 (dừng bot cũ) tới `Ready` (đã đăng nhập và đăng ký lệnh) tối đa 20 phút. Orchestrator ghi giờ từng bước để biết còn bao nhiêu phút khi tới T2b. Quá hạn thì chạy đường lui theo giai đoạn, không "cố thêm một chút".

## T0 — dừng bot cũ, chốt dữ liệu (đồng hồ bắt đầu)

1. Owner/orchestrator: Coolify STOP app cũ (không xoá).
2. Đọc lại: `docker ps -a` thấy container cũ `Exited`; không còn bản nào giữ token Sabi hay Alohomora.
3. Chép dữ liệu (ghi được), rồi chốt:

```sh
S=/srv/appdata/sab-delegate
TS=$(date +%y%m%d-%H%M)
cp -a "$S/files" "$S/files-final-$TS"
( cd "$S/files-final-$TS" && sha256sum *.sqlite > ../files-final-$TS.sha256 )
( cd "$S/files" && sha256sum -c ../files-final-$TS.sha256 )   # nguồn vẫn khớp bản chép
```

   Đo 2026-10-12: cả 5 file `journal_mode=delete`, không `-wal`/`-shm`; vẫn kiểm lại lúc này. Nếu thấy `-wal`, chạy `PRAGMA wal_checkpoint(TRUNCATE)` trên BẢN CHÉP (không phải nguồn) rồi tính lại checksum. Công cụ từ chối khi còn `-wal`.
4. Bản mount cho server là thư mục `files-final` (chỉ-đọc): `cp -a "$S/files-final-$TS" "$S/files-final"` rồi so checksum. (xác nhận sau khi compose xong: tên thư mục mount `/legacy`)
5. Dump trước cutover của Postgres (nếu đã có bảng; DB mới tinh thì bỏ): `backup.sh --tag pre-cutover`, copy sang `/srv/appdata/_archive/sab-delegate/`.

Tiêu chí tiếp: checksum khớp, không còn container giữ token. LÙI nếu chép lệch: Coolify START lại app cũ (điểm lùi 1, không có gì khác phải hoàn tác).

## T1 — push main

1. Owner đồng ý tường minh .
2. `git switch main && git merge --ff-only cutover-candidate && git push origin main` (SHA khớp gate-stamp nên pre-push không chạy lại đầy đủ). Không `--no-verify`.
3. Trong 10 giây phải có deployment mới (xem lệnh ở `docs/deployment.md`, mục kiểm sau deploy). Không có thì kích tay.
4. Theo dõi: `sab-release` (DB trống: bỏ dump; `prisma migrate deploy`; cài schema `pgboss`; cấp quyền) → `Exited 0`; `sab-server` lên ở `MIGRATION_PENDING`: `/health` trả `migration-pending`, log KHÔNG có `Ready! Logged in`.

Tiêu chí tiếp: release `Exited 0`, server khoẻ ở pending. LÙI (điểm lùi 2): `sab-release` lỗi thì server không lên; sửa nhanh được thì sửa, không thì rollback giai đoạn 2 bên dưới.

## T2 — nạp dữ liệu

Công cụ chạy TRONG container server (không `docker compose run`). Mặc định không `--apply` là dry-run.

```sh
c=$(docker ps --filter label=com.docker.compose.service=sab-server --format '{{.Names}}')
docker exec "$c" node dist/tools/migrate-quickdb/main.js --source /legacy              # dry-run
```

Đọc báo cáo: số đếm theo bảng khớp baseline (birthday 1 guild, config 4, note 1, word 10, dict 1), `BIRTHDAY_DUPLICATE_STUDENT` = 0, note cũ không gán được guild bị bỏ (kỳ vọng 1). Báo cáo chỉ có mã và số đếm; không dán dữ liệu thành viên vào chat hay báo cáo.

```sh
docker exec "$c" node dist/tools/migrate-quickdb/main.js --source /legacy --apply
docker exec "$c" node dist/tools/migrate-quickdb/main.js --source /legacy              # phải báo 0 thay đổi
docker exec "$c" node dist/tools/migrate-quickdb/main.js --source /legacy --apply      # phải BỊ TỪ CHỐI (exit 2: bảng đích không rỗng)
```

Không bao giờ dùng `--allow-non-empty` ở prod. Danh mục cho `/create-activity`: không cần cờ nhập; khi guild chưa cấu hình, bot tự dùng lại category của bản cũ nếu category đó thuộc guild.

Tiêu chí tiếp: đếm khớp, lần hai bị từ chối đúng cách. LÙI: lệch đếm không giải thích được thì rollback giai đoạn 2 (chưa ai dùng bot mới).

## T2b — mở bot

1. Coolify: đặt `MIGRATION_PENDING=false` (hoặc xoá biến), redeploy (cả stack được dựng lại).
2. Đọc lại: server qua `BootGuard`, đăng nhập, log `Ready! Logged in as Sabi`, log `Registered … slash commands (global)`; catch-up sinh nhật của hôm nay là no-op vì claim đã `DONE`.
3. HẠN CHÓT T0+20 phút. Chưa `Ready` thì chọn đi tiếp hay lùi theo ETA (rollback giai đoạn 2).

## T3 — xác minh (đọc lại trạng thái đích)

- Đếm row Postgres = baseline; so khoá `/birthday get-list` với baseline (không in dữ liệu cá nhân ra báo cáo); claim hôm nay `DONE`.
- `_prisma_migrations` khớp thư mục migration; schema `pgboss` có queue `birthday-daily`, `scheduled-message-send`.
- Lệnh toàn cục của Sabi đúng bộ mới, không còn `shutdown`; `/ping` trả lời; `docker ps -a` không container bot cũ chạy.
- `backup.sh --tag baseline`, copy sang `_archive`; owner TẢI TAY dump `baseline` về máy riêng.
- `docker exec <c> env | cut -d= -f1` cho từng container: không `TOKENS`, không biến ngoài allowlist; `docker history --no-trunc <image> | grep -c '<TÊN_SECRET>='` = 0 cho ba image.
- Ghi SIGTERM → `Ready` của lần redeploy T2b vào `docs/deployment.md` (mục số đo). Xác nhận app Coolify vẫn theo dõi nhánh `main`.

## T4 — Alohomora

Owner chạy cục bộ, token qua env (`LEGACY_BOT_TOKEN`, `LEGACY_CLIENT_ID`), mặc định dry-run:

```sh
node scripts/clear-legacy-commands.mjs            # in số lệnh, không ghi
node scripts/clear-legacy-commands.mjs --apply    # PUT [] lệnh toàn cục của Alohomora
```

Kết quả: Alohomora 0 lệnh toàn cục. KHÔNG kick, không rời guild, không rotate token cũ: chỉ để offline. Đặt nickname riêng cho Sabi ở 3 guild từng dùng Alohomora bằng giao diện Discord (quyền Manage Nicknames). (xác nhận sau khi compose xong: script nằm ở `scripts/`)

Sau đó owner đăng thông báo admin (cuối tài liệu) và tạo lại lịch hẹn đã ghi ở baseline bằng slash.

## T5 — quan sát

24 giờ: 0 restart, `#bot-log` yên, 00:00 hôm sau sinh nhật chạy đúng MỘT lần (đối chiếu log gửi), 03:00 `sab-backup` chạy và dump hợp lệ (`pg_restore --list`, quyền 0600), số kết nối bình thường. Sau đó mới bắt đầu Release 2. Giữ `TOKENS` cũ, bản sqlite gốc, Alohomora trong guild tối thiểu 14 ngày.

## Rollback

Điểm lùi theo giai đoạn. Dữ liệu ghi vào Postgres SAU cutover (note, birthday, tiến độ nối từ, lịch hẹn) sẽ MẤT khỏi bản cũ; dump `pre-rollback` chỉ để đối chiếu tay. Owner đã xác nhận điều này trước T0.

1. Sau T0, trước push: Coolify START app cũ. Không cần làm gì khác.
2. Sau push, trước khi tắt `MIGRATION_PENDING` (chưa ai dùng bot mới): `git revert -m 1 <merge> && git push origin main` (owner đồng ý) làm CHÍNH app Coolify đó build lại `dockerfile`/compose cũ; dữ liệu sqlite cũ nguyên vẹn. Sau khi bản cũ lên, cho từng bot đăng ký lại lệnh toàn cục (Alohomora còn trong guild nên làm được):

```sh
docker exec -e CREATE_CMD=1 <container-bot-cũ> node --import tsx ./src/index.ts
```

   Mỗi bot log các dòng `Successfully registered application command` rồi tiến trình tự thoát 0; bot chính không restart. Sau đó XOÁ dòng băm lệnh của bản mới để lần quay lại bản mới chắc chắn đăng ký lại (registrar còn đối chiếu `GET` làm lớp thứ hai): trong Postgres, bảng `AppState`, khoá `commands:<applicationId>:global` (xác nhận sau khi compose xong: tên bảng/khoá khớp `prisma/schema/app-state.prisma` và `command-registrar.ts`).
3. Sau khi bot mới đã chạy (TIỀN ROLLBACK bắt buộc trước khi bản cũ khởi động):
   a. `backup.sh --tag pre-rollback`, copy sang `_archive`.
   b. Sao thư mục dữ liệu cũ thành `files-pre-rollback`.
   c. `docker exec <c> node dist/tools/migrate-quickdb/main.js export-claims --target <thư mục dữ liệu cũ, ghi được> --days 2`: ghi `completedDates` của hôm nay và hôm qua vào sqlite cũ để bản cũ không chúc đôi lúc `ready`.
   d. Kiểm cả hai token cũ còn đăng nhập (chỉ in boolean).
   e. Rồi làm như (2), kể cả khi muốn bật lại bản mới sau này (xoá dòng `AppState`). Nick/profile Sabi tự do.
4. Sau cửa sổ rollback (14 ngày, token cũ đã bỏ, dữ liệu cũ đã archive): không còn đường lui về bản cũ; sửa tiến.

Mục tiêu đo ở rehearsal: toàn bộ đường lui không quá 15 phút, cộng thời gian build lạnh của Coolify.

## Sau cửa sổ rollback (owner đồng ý)

Xoá `TOKENS` khỏi Coolify; archive hoặc xoá `files-final*` và thư mục dữ liệu cũ; rời Alohomora khỏi guild và/hoặc thu hồi app. Chỉ lúc này mới dọn repo (commit riêng: `root/`, `dockerfile`, mount `/legacy`, script dọn lệnh, công cụ migration), rồi xoá runbook này.

## Thông báo admin (tiếng Việt, đăng trong kênh quản trị sau T3)

> Bot đã chuyển sang phiên bản mới: một bot Sabi duy nhất phục vụ tất cả máy chủ (Alohomora không còn lệnh). Dữ liệu cũ (sinh nhật, ghi chú, nối từ, cấu hình kênh) đã được chuyển sang. Lịch hẹn giờ gửi tin đang chờ ở bản cũ KHÔNG được chuyển, anh/chị tạo lại giúp. Các thay đổi cần biết:
>
> - `/bot-message schedule-send` và `schedule-copy`: không còn 6 ô số (giờ, phút, giây, ngày, tháng, năm). Thay bằng `time` và `date` nhập dạng chuỗi (có gợi ý, giờ Việt Nam; `date` bỏ trống hoặc không ghi năm thì lấy lần gần nhất sắp tới). Lịch hẹn nay lưu bền, không mất khi bot khởi động lại.
> - `/purge any` luôn hiện số tin sẽ xoá và hỏi xác nhận bằng nút trước khi xoá; có thêm `count`.
> - `/private-thread list` nhận thêm `role`; `ids` không còn bắt buộc (cần `ids` hoặc `role`).
> - `/create-activity` có thêm `category` tuỳ chọn.
> - Có 4 menu chuột phải trên tin nhắn: Edit bot message, Reply as bot, Mention non-reactors, Purge up to here.
> - `/shutdown` đã bỏ; tắt bot là việc của hạ tầng.
> - Một số lệnh nay mở hộp thoại khi bỏ trống nội dung dài (`/bot-message send`, `edit-send`, `/note add`).
>
> Nếu thấy lệnh nào thiếu hoặc lỗi, báo ngay trong kênh này. Danh sách đầy đủ: `docs/commands.md`.
