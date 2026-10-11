# Việc nặng, khoá máy dùng chung, worktree

Máy Mac 16 GB dùng chung với JudgeHub, Leaderboard, QR-Production-Manager… Đã bị watchdog reset
2026-09-30 và 2026-10-04 do nhiều agent + trình duyệt + full suite chồng nhau ngoài khoá.

## Luật
1. Trước MỖI bước nặng: `memory_pressure -Q`; free < 35% → chờ.
2. Nặng = install (pnpm/yarn), typecheck diện rộng, docker build, dựng stack, agent lái trình duyệt.
3. Toàn máy chỉ MỘT agent vừa sửa vừa install/build/test. Không tạo git worktree trừ khi user đồng ý.
   Reviewer đọc-thuần không trình duyệt chạy song song được (số ít).
4. Dừng stack/dev server khi tạm nghỉ.

## Giao thức khoá `/tmp/cc-heavy.lock` (chung mọi repo)
- Cờ chờ `/tmp/cc-heavy.sab-delegate-wants`, nội dung `<Repo> <job> <epoch>`; `touch` mỗi vòng poll; cờ > 5 phút = chết, không xoá cờ người khác.
- Chỉ acquire khi cờ mình có epoch nhỏ nhất trong các cờ sống (cờ rỗng còn sống = người trước mình).
- Acquire: `mkdir /tmp/cc-heavy.lock` rồi `echo "$OWNER" > /tmp/cc-heavy.lock/owner`; xoá cờ chờ của mình.
- Trước mỗi bước nặng: `grep -qxF "$OWNER" /tmp/cc-heavy.lock/owner`.
- Release: `grep -qxF "$OWNER" /tmp/cc-heavy.lock/owner && rm -rf /tmp/cc-heavy.lock` — không bao giờ xoá vô điều kiện.
- Bash tool không giữ biến → gán lại literal `OWNER='SAB-Delegate <job> <epoch>'` ở đầu mỗi lệnh.
- Khoá stale chỉ sau 45 phút và sau khi đã nhắn chủ sở hữu.

## Bổ sung từ bài học các repo khác (11/10/2026)
- Bổ sung: poll foreground khi giữ khoá, nhả trước khi chờ; orchestrator kiểm owner line + `uptime` load ≤ ~8; dev server/compose stack được phép dưới khoá nhưng chỉ orchestrator bật/tắt và PHẢI dừng khi nghỉ, dọn tiến trình mồ côi PPID=1; eslint trong hook một luồng; cổng bận → dừng chủ cũ, ghi `/tmp/cc-ports.registry`. Chi tiết: `mem:lessons/process/heavy-work-additions`.
