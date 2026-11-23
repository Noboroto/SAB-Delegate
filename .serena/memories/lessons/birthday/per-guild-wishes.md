# Lời chúc sinh nhật theo từng server (đo/kiểm chứng 23/11/2026)

- Lời chúc sống ở bảng `BirthdayWish` (mỗi server), sửa trên web tab `?tab=wishes`. Seed lười lần đầu list/pick từ `BIRTHDAY_WISHES` (trim + bỏ trùng nguyên văn), cờ `GuildConfig.birthdayWishesSeeded` → danh sách bị xoá hết vẫn rỗng; rỗng thì bot bốc ngẫu nhiên 1 câu built-in.
- `BirthdayWishUsage` chỉ còn là nguồn seed (giữ vòng đang chạy theo index); `LEGACY_BIRTHDAY_WISH_COUNT = 20` là số câu của quick.db — import tool lọc index theo nó, KHÔNG theo `BIRTHDAY_WISHES.length` (mảng đã thêm 30 câu). Contract bảng ở deploy sau khi mọi server đã seed.
- Thứ tự khoá: mọi thao tác lời chúc khoá dòng `GuildConfig` (`FOR NO KEY UPDATE`) TRƯỚC; `GuildConfigService.patch` khoá GuildConfig rồi Guild. Khoá Guild trước rồi ghi GuildConfig = deadlock 40P01 (reviewer bắt, đã sửa). Edit/remove cũng lấy khoá này nên pick không cần SKIP LOCKED.
- Lỗi REST: `ServiceError.params` giờ đi ra `details` (trừ mã bị che GUILD_*), web `ApiRequestError.params` → `tErrors(code, params)`. Trước đó mọi thông báo có `{max}`… trên web lỗi FORMATTING_ERROR (ví dụ EMAIL_EXPORT_TOO_LARGE).
- Test AntD happy-dom: Modal không bao giờ chạy xong animation đóng/mở → không assert `toBeVisible()` trên dialog/alert/explain, dùng `toBeInTheDocument()`/`aria-invalid`/text toast.
- Test web đọc message từ dist của shared → sửa JSON message phải `node scripts/generate-deps.mjs --shared-only` trước khi chạy vitest web (không thì MISSING_MESSAGE).
