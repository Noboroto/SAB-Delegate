# Runbook thay bot cũ bằng bot mới (cutover)

Phạm vi: các bước, lệnh, tiêu chí đi tiếp và đường lui khi thay bot quick.db (hai token Sabi/Alohomora) bằng MỘT bot Sabi chạy Postgres. Đây là tài liệu tạm thời: xoá sau khi cửa sổ rollback đóng và repo đã dọn. Cấu hình thường nhật ở `docs/deployment.md`; kiến trúc ở `docs/architecture.md`.

Quy ước: lệnh chỉ ghi TÊN biến, không bao giờ in giá trị bí mật. `<c>` là container `sab-server`, tìm bằng:

```sh
docker ps --filter label=com.docker.compose.service=sab-server --format '{{.Names}}'
```

(trên host đông project, thêm lọc theo nhãn `com.docker.compose.project` của app này).

Mọi lệnh backup chạy TRONG container `sab-backup` (image `release` có `pg_dump`, `psql` và role backup chỉ-đọc; image `runner` của server không có client Postgres). `<b>` là container đó:

```sh
b=$(docker ps --filter label=com.docker.compose.service=sab-backup --format '{{.Names}}')
docker exec "$b" /bin/sh /app/apps/server/scripts/backup.sh <tag>      # ví dụ: baseline, pre-rollback
```

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
6. Phần ngoài repo đã xong theo đúng thứ tự ở `docs/deployment.md`, mục "Trước lần deploy đầu": mạng `sab-db`, thư mục bind mount (`files-final`, `postgres`, `backups`) với chủ/quyền đúng, `/srv/appdata/_archive/sab-delegate`, resource Postgres đã chạy và `deploy/initdb/01-roles.sh` đã chạy xong (TRƯỚC push đầu tiên, nếu không `sab-release` không đăng nhập được bằng role migrate); biến Release 1 trên Coolify (`is_buildtime=false`): `DISCORD_TOKEN` = token Sabi (owner nhập), `DISCORD_CLIENT_ID`, `DISCORD_ALLOWED_APP_IDS`, `ADMIN_GUILD_ID`, `APP_ENV=production`, `POSTGRES_*`. `MIGRATION_PENDING` mặc định `true` trong `coolify.compose.yml` (biến trống hay thiếu đều giữ bot offline); chỉ T2b đặt `false` RÕ RÀNG. GIỮ `TOKENS` (ngoài allowlist mọi service mới).
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
4. Bản mount cho server là thư mục `files-final` (chỉ-đọc, mount `/legacy`). Cùng phiên shell với bước 3 (`$S`, `$TS` còn nguyên). Xoá `files-final` cũ TRƯỚC khi chép: nếu thư mục đã tồn tại, `cp -a` chép bản mới VÀO TRONG nó (`files-final/files-final-$TS/`) và server sẽ thấy thư mục rỗng.

```sh
rm -rf "$S/files-final"
cp -a "$S/files-final-$TS" "$S/files-final"
( cd "$S/files-final" && sha256sum -c "../files-final-$TS.sha256" )   # mọi dòng `OK`, thoát 0
find "$S/files-final" -type f ! -name '*.sqlite'                      # không in gì (không -wal, -journal, -shm)
chmod 755 "$S/files-final" && chmod 644 "$S/files-final"/*.sqlite     # server chạy uid node, chỉ cần đọc
```

   Lệnh `sha256sum -c` chỉ kiểm file có trong danh sách; dòng `find` bắt file lạ. Một trong hai khác kỳ vọng là DỪNG, không sang bước 5.
5. Dump Postgres trước cutover: DB mới tinh (kỳ vọng) thì không có gì để dump. Nếu đã có bảng, `sab-release` tự dump `pre-migrate` ở T1 (luôn bật với DB không rỗng, kể cả khi `BACKUP_ENABLED=false`), copy file đó sang `/srv/appdata/_archive/sab-delegate/`. Chưa có container `sab-backup` trước push nên không có lệnh `backup.sh` thủ công ở T0.

Tiêu chí tiếp: checksum khớp, không còn container giữ token. LÙI nếu chép lệch: Coolify START lại app cũ (điểm lùi 1, không có gì khác phải hoàn tác).

## T1 — push main

1. Owner đồng ý tường minh .
2. `git switch main && git merge --ff-only cutover-candidate && git push origin main` (SHA khớp gate-stamp nên pre-push không chạy lại đầy đủ). Không `--no-verify`.
3. Trong 10 giây phải có deployment mới (xem lệnh ở `docs/deployment.md`, mục kiểm sau deploy). Không có thì kích tay.
4. Theo dõi: `sab-release` (DB trống: bỏ dump; `prisma migrate deploy`; cài schema `pgboss`; cấp quyền) → `Exited 0`; `sab-server` lên ở `MIGRATION_PENDING`: `/health` trả `migration-pending`, log KHÔNG có `Ready! Logged in`.

5. Image vừa build lần đầu: kiểm bí mật không lọt vào lịch sử layer, cho CẢ ba image (chỉ in số đếm; tên biến là tên, không phải giá trị):

```sh
for svc in sab-release sab-server sab-backup; do
  cid=$(docker ps -a --filter label=com.docker.compose.service=$svc --format '{{.ID}}' | head -n1)
  img=$(docker inspect --format '{{.Image}}' "$cid")
  for name in DISCORD_TOKEN POSTGRES_PASSWORD POSTGRES_MIGRATE_PASSWORD POSTGRES_BACKUP_PASSWORD TOKENS; do
    printf '%s %s %s\n' "$svc" "$name" "$(docker history --no-trunc "$img" | grep -c "$name=")"
  done
done
```

   Mọi số phải là 0. Khác 0 thì DỪNG, rotate biến đó, sửa `is_buildtime=false`.
6. Đo thời gian khởi động của `sab-server` so với `start_period: 60s`: giờ `StartedAt` và giờ lần kiểm sức khoẻ ĐẦU TIÊN thành công phải cách nhau dưới ~45 s (chừa dư). Vượt thì tăng `start_period` trong `coolify.compose.yml` và `Dockerfile` trước T2b.

```sh
c=$(docker ps --filter label=com.docker.compose.service=sab-server --format '{{.Names}}')
docker inspect "$c" --format '{{.State.StartedAt}}{{range .State.Health.Log}}{{println}}{{.Start}} exit={{.ExitCode}}{{end}}'
```

Tiêu chí tiếp: release `Exited 0`, server khoẻ ở pending, kiểm bí mật toàn 0, thời gian khởi động có dư. LÙI (điểm lùi 2): `sab-release` lỗi thì server không lên; sửa nhanh được thì sửa, không thì rollback giai đoạn 2 bên dưới.

## T2 — nạp dữ liệu

Công cụ chạy TRONG container server (không `docker compose run`). Mặc định không `--apply` là dry-run. Báo cáo chỉ có mã và số đếm; lưu ra file ngoài repo để làm cổng.

```sh
c=$(docker ps --filter label=com.docker.compose.service=sab-server --format '{{.Names}}')
S=/srv/appdata/sab-delegate
docker exec "$c" node dist/tools/migrate-quickdb/main.js --source /legacy | tee "$S/import-dry-run.txt"
```

**Cổng trước `--apply`** (thiếu một điều kiện là KHÔNG apply):

```sh
grep -E '^(Missing source files|Unparsable source rows)' "$S/import-dry-run.txt"   # không in gì
grep -E 'BIRTHDAY_DUPLICATE_STUDENT' "$S/import-dry-run.txt"                       # không có, hoặc =0
```

- Không có dòng `Missing source files` và `Unparsable source rows`. Công cụ cũng tự từ chối: `--apply` thoát 3 với thông điệp nêu tên file thiếu, vì nhập một phần thì lần sau bảng đích không còn rỗng và không lặp lại được.
- Số đếm theo bảng khớp baseline (birthday 1 guild, config 4, note 1, word 10, dict 1), `BIRTHDAY_DUPLICATE_STUDENT` = 0, note cũ không gán được guild bị bỏ (kỳ vọng 1). Không dán dữ liệu thành viên vào chat hay báo cáo.

Nạp, rồi chốt số đếm làm mốc (đếm bằng role backup chỉ-đọc trong `sab-backup`):

```sh
docker exec "$c" node dist/tools/migrate-quickdb/main.js --source /legacy --apply
b=$(docker ps --filter label=com.docker.compose.service=sab-backup --format '{{.Names}}')
count_rows() {
  docker exec -i "$b" sh -c 'PGPASSWORD="$POSTGRES_BACKUP_PASSWORD" psql --no-psqlrc -At -h "$POSTGRES_HOST" -U "$POSTGRES_BACKUP_USER" -d "$POSTGRES_DB"' <<'SQL'
select format('%I', tablename) || '|' ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text
from pg_tables where schemaname = 'public' order by 1
SQL
}
count_rows > "$S/import-baseline.txt"
```

`import-baseline.txt` là mốc "sau nhập" (tên bảng và số dòng, không có dữ liệu). Bằng chứng không nhập đôi KHÔNG phải lần dry-run thứ hai (dry-run chỉ đọc nguồn nên luôn báo cùng số `planned`, không nói gì về bảng đích). Bằng chứng là: apply lần hai bị từ chối, và số đếm Postgres không đổi so với mốc.

```sh
docker exec "$c" node dist/tools/migrate-quickdb/main.js --source /legacy --apply ; echo "exit=$?"   # phải BỊ TỪ CHỐI: exit=2 (bảng đích không rỗng)
count_rows > "$S/import-after.txt"
diff "$S/import-baseline.txt" "$S/import-after.txt" && echo "unchanged"                              # không khác
```

Cả hai điều kiện cùng thoả mới tiếp. Không bao giờ dùng `--allow-non-empty` ở prod. Danh mục cho `/create-activity`: không cần cờ nhập; khi guild chưa cấu hình, bot tự dùng lại category của bản cũ nếu category đó thuộc guild.

Ngay sau đó, TRƯỚC khi mở bot (T2b), lấy dump mốc để có điểm khôi phục sạch của dữ liệu vừa nhập:

```sh
docker exec "$b" /bin/sh /app/apps/server/scripts/backup.sh baseline
```

Tiêu chí tiếp: đếm khớp baseline cũ, lần apply hai bị từ chối, số đếm không đổi, dump `baseline` ghi xong (script đã kiểm bằng `pg_restore --list`). LÙI: lệch đếm không giải thích được thì rollback giai đoạn 2 (chưa ai dùng bot mới).

## T2b — mở bot

1. Coolify: đặt `MIGRATION_PENDING=false` RÕ RÀNG, redeploy (cả stack được dựng lại). Xoá biến hoặc để trống là quay về mặc định `true` và bot KHÔNG đăng nhập.
2. Đọc lại: server qua `BootGuard`, đăng nhập, log `Ready! Logged in as Sabi`, log `Registered … slash commands (global)`; catch-up sinh nhật của hôm nay là no-op vì claim đã `DONE`.
3. HẠN CHÓT T0+20 phút. Chưa `Ready` thì chọn đi tiếp hay lùi theo ETA (rollback giai đoạn 2).

## T3 — xác minh (đọc lại trạng thái đích)

- Đếm row Postgres vẫn khớp `import-baseline.txt` ngoại trừ bảng bot đã ghi từ lúc mở (claim sinh nhật, `AppState`, hàng đợi); so khoá `/birthday get-list` với baseline (không in dữ liệu cá nhân ra báo cáo); claim hôm nay `DONE`.
- `_prisma_migrations` khớp thư mục migration; schema `pgboss` có queue `birthday-daily`, `scheduled-message-send`.
- Lệnh toàn cục của Sabi đúng bộ mới, không còn `shutdown`; `/ping` trả lời; `docker ps -a` không container bot cũ chạy.
- Dump `baseline` đã lấy ở T2 (trước khi mở bot): copy sang `_archive`; owner TẢI TAY về máy riêng.
- `docker exec <c> env | cut -d= -f1` cho từng container: không `TOKENS`, không biến ngoài allowlist; `docker history --no-trunc <image> | grep -c '<TÊN_SECRET>='` = 0 cho ba image.
- Ghi SIGTERM → `Ready` của lần redeploy T2b vào `docs/deployment.md` (mục số đo). Xác nhận app Coolify vẫn theo dõi nhánh `main`.

## T4 — Alohomora

Owner chạy cục bộ, token qua env (`LEGACY_BOT_TOKEN`, `LEGACY_CLIENT_ID`), mặc định dry-run. Đặt thêm `DISCORD_CLIENT_ID` (id app Sabi mới) trong cùng shell: script từ chối khi `LEGACY_CLIENT_ID` trùng nó, và LUÔN từ chối khi `LEGACY_CLIENT_ID` không phải id app mã hoá ở đoạn đầu của `LEGACY_BOT_TOKEN` (giải mã base64url, không in giá trị nào). Nhầm id là xoá sạch lệnh toàn cục của Sabi.

```sh
node scripts/clear-legacy-commands.mjs            # in số lệnh, không ghi
node scripts/clear-legacy-commands.mjs --apply    # PUT [] lệnh toàn cục của Alohomora
```

Kết quả: Alohomora 0 lệnh toàn cục. KHÔNG kick, không rời guild, không rotate token cũ: chỉ để offline. Đặt nickname riêng cho Sabi ở 3 guild từng dùng Alohomora bằng giao diện Discord (quyền Manage Nicknames).

Sau đó owner đăng thông báo admin (cuối tài liệu) và tạo lại lịch hẹn đã ghi ở baseline bằng slash.

## T5 — quan sát

24 giờ: 0 restart, `#bot-log` yên, 00:00 hôm sau sinh nhật chạy đúng MỘT lần (đối chiếu log gửi), 03:00 `sab-backup` chạy và dump hợp lệ (`pg_restore --list`, quyền 0600), số kết nối bình thường. Sau đó mới bắt đầu Release 2. Giữ `TOKENS` cũ, bản sqlite gốc, Alohomora trong guild tối thiểu 14 ngày.

## Rollback

Điểm lùi theo giai đoạn. Dữ liệu ghi vào Postgres SAU cutover (note, birthday, tiến độ nối từ, lịch hẹn) sẽ MẤT khỏi bản cũ; dump `pre-rollback` chỉ để đối chiếu tay. Owner đã xác nhận điều này trước T0.

1. Sau T0, trước push: Coolify START app cũ. Không cần làm gì khác.
2. Sau push, trước khi đặt `MIGRATION_PENDING=false` (chưa ai dùng bot mới, `sab-server` chưa từng đăng nhập): `git revert -m 1 <merge> && git push origin main` (owner đồng ý) làm CHÍNH app Coolify đó build lại `dockerfile`/compose cũ; dữ liệu sqlite cũ nguyên vẹn. Làm bước kiểm container mồ côi ở (d) ngay sau deploy, rồi (e) để trả lệnh toàn cục.
3. Sau khi bot mới đã chạy: bản cũ KHÔNG được khởi động trước khi xong (a) tới (c). Thứ tự bắt buộc:

**(a) Không container mới nào được giữ token.** Ghi trước nhãn project và image (dùng ở (c), (d)), rồi chọn một cách:

```sh
c=$(docker ps --filter label=com.docker.compose.service=sab-server --format '{{.Names}}')
p=$(docker inspect "$c" --format '{{index .Config.Labels "com.docker.compose.project"}}')
img=$(docker inspect "$c" --format '{{.Config.Image}}')
```

   - Nhanh: `docker update --restart=no "$c" && docker stop "$c"`. Đổi `--restart=no` trước: một lần deploy hay dockerd restart có thể dựng lại container, và `sab-server` còn sống sẽ tranh token với bản cũ.
   - Hoặc đặt `MIGRATION_PENDING=true` trên Coolify rồi redeploy: server lên nhưng không đăng nhập.

**(b) Kiểm.** `docker ps --filter label=com.docker.compose.project="$p"`: `sab-server` hoặc đã dừng, hoặc `/health` trả `migration-pending` (`docker exec "$c" wget -qO- http://127.0.0.1:3100/health`), và `docker logs --since 5m "$c" 2>&1 | grep -c 'Ready! Logged in'` ra 0. Chưa chắc chắn thì KHÔNG sang (c).

**(c) Chốt dữ liệu cho bản cũ** (Postgres vẫn chạy, nó là resource riêng):

```sh
S=/srv/appdata/sab-delegate
b=$(docker ps --filter label=com.docker.compose.service=sab-backup --format '{{.Names}}')
docker exec "$b" /bin/sh /app/apps/server/scripts/backup.sh pre-rollback        # rồi copy sang _archive
test ! -e "$S/files-pre-rollback" && cp -a "$S/files" "$S/files-pre-rollback"   # đã có thì dừng và xem lại
```

   `export-claims` PHẢI ghi vào thư mục dữ liệu THẬT của bản cũ (`$S/files`), không phải `/legacy`: đó là mount chỉ-đọc của `files-final`, một bản chép từ T0, nên `docker exec` vào server vừa không ghi được vừa ghi nhầm chỗ (bản cũ không thấy gì). Chạy thành container dùng một lần từ image của server, gắn `$S/files` ghi được, với đúng uid chủ file (SQLite cần tạo cả file `-journal` cạnh nó). Thông số Postgres lấy từ chính container server qua file env mode 600, xoá ngay (không in, không qua argv):

```sh
E=$(umask 077; mktemp)
docker inspect "$c" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -E '^POSTGRES_(HOST|PORT|DB|USER|PASSWORD)=' > "$E"
docker run --rm --network sab-db --env-file "$E" --user "$(stat -c %u:%g "$S/files")" \
  -v "$S/files:/legacy-live:rw" "$img" \
  node dist/tools/migrate-quickdb/main.js export-claims --target /legacy-live --days 2
rm -f "$E"
```

   Container server đã bị xoá thì lấy image bằng `docker images` (tên Coolify build) và chép các biến POSTGRES từ cấu hình Coolify vào `$E` (không in). Kiểm sau khi ghi:

```sh
( cd "$S/files-pre-rollback" && sha256sum config.sqlite note.sqlite word.sqlite dict.sqlite ) | ( cd "$S/files" && sha256sum -c - )   # bốn file khác KHÔNG đổi
```

   `birthday.sqlite` là file duy nhất được ghi (một giao dịch, lỗi thì tự rollback) nên sẽ khác bản `files-pre-rollback`. Kiểm cả hai token cũ còn đăng nhập (chỉ in boolean).

**(d) Khởi động bản cũ.** Coolify START app cũ (nếu đã `git revert -m 1` thì đó là bản build lại từ compose cũ). Coolify không chắc dọn container của compose mới (`sab-release`, `sab-server`, `sab-backup`) khi đổi file compose; `sab-server` mồ côi mà còn đăng nhập sẽ tranh gateway với bản cũ. Kiểm ngay:

```sh
docker ps -a --filter label=com.docker.compose.project="$p" --format '{{.Names}}\t{{.Status}}\t{{index .Labels "com.docker.compose.service"}}'
```

   Dòng nào có service `sab-release`, `sab-server` hoặc `sab-backup` còn tồn tại: `docker update --restart=no <tên> && docker rm -f <tên>` (không `-v`; dữ liệu là bind mount nên không mất). Rồi `docker logs` của bản cũ: mỗi bot một dòng `Ready! Logged in as …`.

**(e) Trả lệnh toàn cục cho bản cũ.** Cho từng bot đăng ký lại (Alohomora còn trong guild nên làm được; Sabi phải được trả về bộ lệnh cũ):

```sh
docker exec -e CREATE_CMD=1 <container-bot-cũ> node --import tsx ./src/index.ts
```

   Mỗi bot log các dòng `Successfully registered application command` rồi tiến trình tự thoát 0; bot chính không restart. Sau đó XOÁ dòng băm lệnh của bản mới để lần quay lại bản mới chắc chắn đăng ký lại (registrar còn đối chiếu `GET` làm lớp thứ hai): trong Postgres: `DELETE FROM "AppState" WHERE key = 'commands:<applicationId>:global';` (bảng `AppState`, khoá theo `command-registrar.ts`). Nick/profile Sabi tự do.

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
