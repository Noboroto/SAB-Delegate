# Memory Maintenance

- `mem:core` là gốc; mỗi chủ đề có `index`; tham chiếu dạng `mem:<path>` trong backtick.
- Câu dẫn tới memory phải nói rõ đọc khi nào/chứa gì; bản thân memory không tự nói khi nào đọc.
- Văn phong: ghi chú dày cho agent — invariant, gạch đầu dòng ngắn; bỏ ngữ cảnh hiển nhiên.
- Chỉ thêm sự thật ỔN ĐỊNH, KHÔNG HIỂN NHIÊN, đã đo/kiểm chứng. Không thêm: kiến thức chung của
  framework, ghi chú một lần, chi tiết theo dòng code dễ đổi.
- Lessons: `lessons/<topic>/<slug>`, mỗi memory một sự thật, có **Why** + **How to apply**.
  Thêm bài học = ghi đúng topic VÀ thêm dòng vào `mem:lessons/index`.
- Không tham chiếu path git không track hay path máy cá nhân.
- Đổi tên bằng tool rename của serena để tham chiếu tự cập nhật. Sai thì sửa/xoá, không tạo bản trùng.
- Chỉ orchestrator ghi memory; subagent chỉ đọc.

## Bổ sung từ bài học các repo khác (11/10/2026)
- Gợi ý: gộp bài học theo chủ đề (một file nhiều bullet Why/How) khi chúng liên quan chặt; vẫn mỗi bullet một sự thật. Số đo thay đổi theo thời gian ghi kèm ngày; bài học bị bỏ thành lỗi thời (xem multi-client-dedupe) thì xoá.
