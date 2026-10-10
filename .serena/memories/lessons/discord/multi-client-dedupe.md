# Nhiều bot trong một tiến trình → mọi event chạy N lần

- `index.ts` gắn cùng handler cho MỌI client; nếu 2 bot cùng ở một guild thì `messageCreate`,
  `messageUpdate`, cron sinh nhật chạy 2 lần cho cùng dữ liệu (đã thấy: trò nối từ báo "Bạn đã nối từ
  trước đó" cho từ đúng vì client thứ 2 thấy `lastUser` vừa ghi; lời chúc sinh nhật gửi trùng).
- **How to apply**: việc chỉ được làm một lần (ghi DB, gửi tin) phải `claimOnce(key)` (ultils/botLog.ts)
  với key theo message id / guild+ngày trước khi làm. Slash command thì không cần (interaction chỉ tới 1 bot).
- Cờ hoàn thành sinh nhật là `<guild>.completedDates.<YYYY-M-D>` (một key chuỗi: path số làm lodash tạo mảng thưa; field cũ `isCompleted` là mảng, bỏ). Bản cũ không có năm
  khiến ngày đó bị bỏ qua vĩnh viễn từ năm thứ hai.
- Tiến trình có `process.on("unhandledRejection")` ghi log thay vì chết; handler event được `.catch` → `reportError`.
