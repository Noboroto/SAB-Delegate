# Bot cố ý vượt giới hạn bảo mật của Discord

Chủ bot quyết (2026-10-10): "tôi tạo ra bot là để bypass các bảo mật này". Đã gỡ lại 4 thứ từng bị thêm vào:
- giới hạn command chỉ trong guild (`setContexts(Guild)`) → command dùng được trong DM như cũ
  (chỉ `add-poll`, `attendance-by-role`, `create-activity` giữ guild-only vì bản gốc vốn `setDMPermission(false)`);
- chặn link tin nhắn của guild khác trong `getMessageFromOption`;
- kiểm thứ bậc role người gọi khi bulk-assign;
- kiểm ViewChannel/CreateInstantInvite của người gọi khi tạo invite.

**Why**: bot là công cụ của admin để làm thay những việc mà quyền Discord của người gọi không cho.
**How to apply**: reviewer/implementer không đề xuất hay thêm lại các kiểm tra kiểu này. Validate input chỉ để
không crash (độ bền) vẫn được. Thay đổi về ai được dùng command (`setDefaultMemberPermissions`) phải hỏi chủ bot.
