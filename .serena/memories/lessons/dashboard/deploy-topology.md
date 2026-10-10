# Dashboard chạy CHUNG stack Coolify với bot (quyết định 2026-10-10)

Thêm service `web` vào `coolify.compose.yml` (cùng app Coolify `srmimyhh373o9gzpddgs2it7`).
Chủ repo chấp nhận bot restart vài giây mỗi lần deploy web (21:50 10/10) → bỏ phương án tách app.

## Sự thật đã đo (Coolify 4.3.23, david-host)
- Mỗi lần deploy compose app, Coolify tạo lại **MỌI** container: tên container có hậu tố theo lần deploy (`<service>-<uuid>-<deploy-ts>`). Đo: SAB-Store 5 container đều tạo 14:29:32 ngày 10/10, kể cả mongodb không đổi image. Downtime ≈ service khởi động chậm nhất + healthcheck (SAB-Store ~60s).
- Suy luận sai từng có: đọc mã nguồn thấy `up -d` không `--force-recreate` → "chỉ recreate service đổi". SAI vì hậu tố tên. Đo thực tế thắng đọc mã.
- Watch Paths áp cho mọi loại app; không đặt thì deploy ở MỌI push. `[skip ci]`/`[skip cd]` trong commit bỏ qua deploy. Builds chạy lần lượt toàn server.
- Nếu sau này cần tách app: mạng ngoài tạo tay, `external: true` ở cả hai compose, gọi bằng TÊN SERVICE (mẫu `observability`); không gọi tên container; kiểm lại route Traefik sau khi thêm network.

## How to apply
- Web gọi `http://bot:<port>` (alias `bot` có sẵn trong network của stack). API bot: chỉ `expose`, không `ports`, không domain; header khoá bí mật. Chỉ `web` nhận domain `bot.sabies.vn`.
- Mỗi push (bot hoặc web) restart cả hai → bắt buộc: lịch hẹn lưu DB (không RAM), tác vụ sinh nhật lúc ready an toàn khi chạy lại (đã có cờ ngày + claim), web hiển thị "bot đang khởi động" khi API chưa sẵn.
- Commit chỉ đổi tài liệu (.md, memory) có thể thêm `[skip cd]` để khỏi restart bot vô ích.
- Giới hạn CPU/RAM riêng cho `web` trong `deploy.resources`.
