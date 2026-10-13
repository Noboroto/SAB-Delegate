# Danh sách lệnh của bot

Một chỗ duy nhất để nhớ mỗi lệnh làm gì và được phép làm gì. Đây là bản tra cứu cho chủ bot, không phải tài liệu thiết kế; hành vi thật nằm ở code.

## Luật của chủ bot

> Chỗ nào bot cũ không chặn là chủ bot cho phép (không phải vượt quyền). Đường slash không thêm hạn chế mới; REST/MCP (Release 2) mặc định bảo thủ: không ping, chỉ trong guild của mình.

Hệ quả cụ thể cho đường slash:

- Bot không kiểm quyền của người gọi. "Ai dùng" chỉ là quyền mặc định Discord dùng để hiện lệnh; admin máy chủ chỉnh lại được trong Cài đặt máy chủ.
- Bot ping đúng như bản cũ: `@user`, `@role`, `@everyone`/`@here` trong nội dung hoặc danh sách đều ping, kể cả khi người gọi không có quyền "Mention Everyone". Mặc định toàn bot không ping gì, chỉ lệnh nào bản cũ có ping mới bật lại.
- Link tin nhắn của guild khác vẫn được theo (bot làm việc xuyên mọi máy chủ nó có mặt).
- Lệnh không có `setContexts` guild-only thì vẫn hiện trong DM; dùng trong DM sẽ báo lỗi không có máy chủ. Chỉ `/add-poll`, `/attendance-by-role`, `/create-activity` là guild-only.
- Khoảng "Trả lời": "công khai" = cả kênh thấy; "riêng" = chỉ người gọi thấy (ephemeral). Lỗi/từ chối luôn trả riêng; lỗi bất ngờ còn được báo vào `bot-log` (xem mục tự động).

## Cách đọc

| Cột | Ý nghĩa |
| --- | --- |
| Ai dùng | Quyền mặc định của Discord cho cả nhóm lệnh ("mọi người" = không đặt quyền) |
| Trả lời | Công khai hay riêng |
| Ping | Ai bị thông báo |
| Được phép | Điểm bản cũ không chặn, bot giữ nguyên |
| Khác bản cũ | Chỉ ghi chỗ khác; trống = giữ nguyên bản cũ |

Chung cho mọi lệnh:

- Bot trả lời theo ngôn ngữ của guild: tiếng Việt mặc định; guild chọn English thì giữ câu chữ của bản cũ.
- Ô nhập `emoji` và `time`/`date` có gợi ý khi gõ.
- Dấu "⚠ cần kiểm" đánh dấu chỗ code mới khác bản cũ mà chưa nằm trong danh sách khác biệt đã duyệt.

Nguồn đối chiếu: quyền và guild-only ở `apps/server/src/discord/command-groups.ts`; mô tả ở `packages/shared/src/messages/{vi,en}/*.json`; option ở `apps/server/src/modules/*/*.commands.ts`; bản cũ ở `root/src/commands/`.

---

## 1. `/bot-message` — nói và sửa bằng tiếng của bot

Ai dùng: Quản trị viên. Mọi subcommand trả riêng.

| Subcommand | Làm gì | Ping / Được phép | Khác bản cũ |
| --- | --- | --- | --- |
| `send` `[content]` `[destination]` `[reply-message]` | Bot gửi tin vào kênh/thread (mặc định kênh hiện tại), hoặc trả lời một tin | Ping theo nội dung (user, role, everyone). Gửi được vào kênh của guild khác, trả lời tin guild khác | Khác đã duyệt: `content` đổi thành tuỳ chọn, thiếu thì mở hộp thoại nhập (bản cũ bắt buộc) |
| `copy-paste` `message-link` `[destination]` | Sao chép tin (chữ, file) sang kênh khác | Ping theo nội dung tin gốc. Nguồn từ guild khác được | — |
| `edit-copy` `new-message-link` `old-bot-message-link` | Sửa tin cũ của bot bằng nội dung của một tin khác | Ping theo nội dung mới | — |
| `edit-send` `old-bot-message-link` `[new-content]` | Sửa tin cũ của bot bằng chữ gõ tay | Ping theo nội dung mới | Khác đã duyệt (hộp thoại cho nội dung dài): `new-content` đổi thành tuỳ chọn, thiếu thì mở hộp thoại (bản cũ bắt buộc) |
| `react` `message-link` `emoji` `[poll-choice-count 0-10]` | Bot thả emoji vào một tin, tuỳ chọn thêm các số làm lựa chọn bình chọn | Không ping | — |
| `schedule-send` `time` `[message]` `[date]` `[destination]` | Hẹn giờ gửi một tin | Ping theo nội dung khi đến giờ | Khác đã duyệt: `time` + `date` là chuỗi có gợi ý (giờ Việt Nam; `date` dạng ngày/tháng, không năm = lần gần nhất sắp tới) thay 6 option số. Khác đã duyệt: `message` tuỳ chọn (mở hộp thoại); lịch lưu trong DB nên không mất khi khởi động lại (bản cũ chỉ trong RAM); giới hạn 366 ngày / 500 lịch chờ chỉ áp cho REST/MCP |
| `schedule-copy` `message-link` `time` `[date]` `[destination]` | Hẹn giờ sao chép một tin; chữ và file được đọc lúc đến giờ, nên sửa tin trước đó thì bản gửi là bản sửa | Ping theo nội dung khi đến giờ | Như `schedule-send` (`time`/`date`, bền, giới hạn mới) |

## 2. `/scheduler` — xem và huỷ tin hẹn giờ

Ai dùng: Quản lý tin nhắn.

| Subcommand | Làm gì | Trả lời | Khác bản cũ |
| --- | --- | --- | --- |
| `get` | Liệt kê tin hẹn giờ của guild | Công khai | Khác đã duyệt: chỉ liệt kê lịch đang chờ (bản cũ chỉ biết lịch còn sống nên tương đương); id là id mới, lấy từ danh sách |
| `cancel` `id` | Huỷ một lịch | Riêng | `id` có gợi ý từ danh sách lịch chờ |

## 3. `/birthday` — danh sách sinh nhật

Ai dùng: Quản trị viên.

| Subcommand | Làm gì | Trả lời |
| --- | --- | --- |
| `append-list` `file` | Nhập file CSV (tối đa 1 MB), báo từng dòng bị bỏ qua | Riêng |
| `get-list` `[month 1-12]` | Xem danh sách theo tháng (mặc định cả năm) | Công khai |
| `remove` `[student-id]` `[user]` | Xoá một người khỏi danh sách theo mã sinh viên hoặc user (cần một trong hai) | Riêng |
| `birthday-channel` `channel` | Chọn kênh chúc mừng; cùng cài đặt với `/set birthday-channel` | Công khai |

Không ping. Lời chúc tự động nằm ở mục "Hành vi tự động".

## 4. `/set` — cài đặt máy chủ

Ai dùng: Quản trị viên. Bot từ chối (riêng) nếu nó không đủ quyền trong kênh được chọn; đó là kiểm quyền của bot, không phải của người gọi. Trả lời công khai, không ping.

| Subcommand | Làm gì |
| --- | --- |
| `intro-channel` `channel` | Kênh giới thiệu, nguồn cho `/get intro` |
| `log-channel` `channel` | Kênh log của guild |
| `birthday-channel` `channel` | Kênh chúc sinh nhật |

## 5. `/word` — trò chơi nối từ

Ai dùng: Quản lý tin nhắn. Trả lời công khai; cả hai lệnh đăng "Trò chơi bắt đầu" vào kênh chơi. Không ping.

| Subcommand | Làm gì |
| --- | --- |
| `set` `channel` `[max-words]` | Chọn kênh chơi và đặt lại trò chơi; `max-words` tối thiểu 200, mặc định 1500 |
| `reset` | Chơi lại ở kênh đã chọn; chưa chọn kênh thì báo riêng |

## 6. `/note` — ghi chú theo vai trò

Ai dùng: mọi người. Trả lời công khai: ghi chú là của cả phòng. Không ping (tên vai trò hiện dạng chữ).

| Subcommand | Làm gì | Khác bản cũ |
| --- | --- | --- |
| `add` `role` `topic` `[content]` | Lưu (hoặc ghi đè) ghi chú theo chủ đề | Khác đã duyệt: thiếu `content` thì mở hộp thoại; option `note` đổi tên `content`. `topic` có gợi ý |
| `get` `role` | Xem mọi ghi chú của vai trò | — |
| `remove` `role` `topic` | Xoá ghi chú; báo xong dù chủ đề có tồn tại hay không | `topic` có gợi ý |

Ai cũng thêm/xoá được ghi chú của mọi vai trò: bản cũ không chặn.

## 7. `/get` — tra thông tin

Ai dùng: mọi người.

| Subcommand | Làm gì | Trả lời | Ping | Khác bản cũ |
| --- | --- | --- | --- | --- |
| `intro` `user` | Tìm bài giới thiệu mới nhất của user trong kênh giới thiệu (quét tối đa 10000 tin gần nhất) | Công khai; chưa đặt kênh thì báo riêng | Không | — |
| `id-by-reaction` `message-link` `emoji` `[mention]` `[reply-message]` `[content]` | Liệt kê id người đã thả emoji | Công khai; riêng nếu có `reply-message` (danh sách gửi vào tin kia) | Chỉ khi `mention` bật: ping những người đó | — |
| `id-by-role` `role` `[in-this-channel]` | Liệt kê id thành viên của vai trò | Công khai | Không | ⚠ cần kiểm: bản cũ tự chặn người không có quyền Quản lý vai trò; code mới không kiểm gì (ai thấy lệnh là dùng được) |
| `invite-link` `[channel]` | Tạo lời mời không hết hạn, gửi DM cho người gọi (DM đóng thì hiện link trong câu trả lời riêng) | Riêng | Không | — |

Link tin nhắn của guild khác được theo ở `id-by-reaction`.

## 8. `/mention` — nhắc nhiều người

Ai dùng: người có quyền Dùng lệnh ứng dụng (gần như mọi người). Ping được chủ động: `@user` trong danh sách và `@role`/`@everyone` trong `content` đều ping.

| Subcommand | Làm gì | Trả lời |
| --- | --- | --- |
| `by-a-reaction` `message-link` `emoji` `[reply-message]` `[content]` | Ping những người đã thả emoji | Công khai; riêng ("Sent!") nếu có `reply-message` |
| `not-react` `message-link` `[content]` `[role]` `[is-reply]` `[include-bots]` `[only-in-channel]` | Ping những người nhìn thấy kênh nhưng chưa thả cảm xúc nào; lọc theo vai trò, có thể gồm bot; `only-in-channel` tắt thì xét mọi thành viên của vai trò | Công khai; riêng nếu `is-reply` (danh sách trả lời vào chính tin đó) |
| `everyone` `[content]` `[reply-message]` | Chỉ trong thread: bot ping cả thread với lời "đã nhắc @everyone", dù người gọi không có quyền Mention Everyone | Riêng ("Sent!"); tin ở thread |

`/thread everyone` là cùng lệnh này đặt trong `/thread`. Danh sách dài được chia khối ≤ 2000 ký tự. Kênh thoại không được hỗ trợ.

## 9. `/bulk-assign` — gán hoặc gỡ vai trò hàng loạt

Ai dùng: Quản lý vai trò. Trả lời riêng, không ping. `is-remove` bật thì gỡ thay vì gán. Báo số người xong và từng người lỗi.

| Subcommand | Làm gì | Khác bản cũ |
| --- | --- | --- |
| `list` `role` `[ids]` `[members-of-role]` `[is-remove]` | Gán/gỡ cho danh sách id (mention, dấu phẩy đều nhận) | Khác đã duyệt (nhập id dễ hơn): `ids` đổi thành tuỳ chọn và thêm `members-of-role` (lấy thành viên của một vai trò khác); bản cũ `ids` bắt buộc |
| `by-reaction` `message-link` `emoji` `role` `[is-remove]` | Gán/gỡ cho người đã thả emoji vào tin (kể cả tin guild khác; vai trò là của guild đang chạy lệnh) | — |

## 10. `/thread` — luồng theo tiền tố

Ai dùng: Quản lý vai trò.

| Subcommand | Làm gì | Trả lời | Ping | Khác bản cũ |
| --- | --- | --- | --- | --- |
| `create` `name` `message` `[is-private]` `[destination]` | Tạo thread (kênh chữ hoặc forum; thread riêng chỉ ở kênh chữ) và đăng tin đầu, ghi "người gọi đã tạo" | Công khai | Theo nội dung tin đầu (user, role) | — |
| `edit-prefix` `old-prefix` `new-prefix` `[destination]` | Đổi tiền tố tên mọi thread đang mở khớp tiền tố cũ | Riêng | Không | — |
| `remove-by-prefix` `prefix` `[destination]` | Xoá mọi thread khớp tiền tố | Riêng | Không | Khác đã duyệt: xem danh sách và hỏi xác nhận (nút) trước khi xoá |
| `everyone` | Xem `/mention everyone` | | | |

## 11. `/private-thread` — một thread riêng cho mỗi người

Ai dùng: Quản lý vai trò. Chỉ trong kênh chữ. Trả lời riêng. Bot thêm từng người (và người gọi) vào thread riêng của họ rồi đăng `message`; ping theo nội dung `message` (user, role).

| Subcommand | Làm gì | Khác bản cũ |
| --- | --- | --- |
| `list` `prefix` `[ids]` `[role]` `[message]` `[destination]` | Tạo thread `<prefix>-<tên>` cho từng người trong danh sách id | Khác đã duyệt: thêm `role`; `ids` đổi thành tuỳ chọn (cần `ids` hoặc `role`) |
| `by-reaction` `prefix` `message-link` `emoji` `[message]` `[destination]` | Tạo cho người đã thả emoji vào tin (kể cả tin guild khác) | — |

## 12. `/purge` — xoá hàng loạt tin trong kênh

Ai dùng: Quản trị viên. Mọi câu trả lời là riêng. Chỉ chạm kênh đang chạy lệnh (link phải cùng kênh). Tin hệ thống bị bỏ qua.

| Subcommand | Làm gì | Khác bản cũ |
| --- | --- | --- |
| `any` `[until-link]` `[from-link]` `[count 1-1000]` | Xoá các tin mới hơn `until-link` (tin này được giữ) đến `from-link` (tin này bị xoá; mặc định tin mới nhất); hoặc xoá `count` tin mới nhất. Dùng `until-link` hoặc `count`, không cả hai; `from-link` đi với `until-link` | Khác đã duyệt: hiện số tin sẽ xoá và hỏi xác nhận bằng nút trước khi xoá; thêm `count`. Tin đăng thêm khi đang chờ xác nhận không bị xoá lẫn |

## 13. `/ping`

Ai dùng: mọi người, cả trong DM. Trả lời công khai: thời gian bot chạy, nhịp websocket, độ trễ khứ hồi. Không ping.

## 14. `/add-poll` (chỉ trong máy chủ)

Ai dùng: mọi người. Trả lời riêng. `poll-choice-count` (1-10) `[message-link]`: thả các emoji số 1-10 vào tin có sẵn, hoặc vào một tin "New Poll!" bot đăng mới. Link guild khác được. Không ping.

## 15. `/attendance-by-role` (chỉ trong máy chủ)

Ai dùng: mọi người. Trả lời công khai: `role` `[voice-channel]` so thành viên của vai trò với người đang ở kênh thoại/stage; liệt kê người có mặt (chữ, không ping) và người vắng (mention).

- Ping: chỉ những người vắng, đúng như bản cũ.
- Khác đã duyệt: `voice-channel` tuỳ chọn, mặc định kênh thoại của người gọi (không ở kênh nào thì báo riêng).

## 16. `/create-activity` (chỉ trong máy chủ)

Ai dùng: Quản lý kênh. Trả lời công khai, không ping. `1-emoji` `2-name` `3-short-name (đúng 3 ký tự)` `[category]`: tạo 3 vai trò (`-Event`, `-Multi`, `-MC`) và 3 kênh (general, thread-only, thoại) với quyền theo vai trò Technician/Muted có sẵn (kiểm tên vai trò ở `activity.overwrites.ts`).

- Khác đã duyệt: `category` tuỳ chọn; bỏ trống thì dùng category trong cấu hình guild, không có thì dùng category cố định của bản cũ.

---

## Menu chuột phải trên tin nhắn (4)

Bản cũ không có. Không đặt guild-only. Mọi menu mở hộp thoại hoặc trả riêng.

| Menu | Ai dùng | Làm gì |
| --- | --- | --- |
| Edit bot message (Sửa tin nhắn của bot) | Quản trị viên | Mở hộp thoại sửa tin; chỉ tin do chính bot đăng, tin khác bị từ chối (riêng). Tương đương `/bot-message edit-send` |
| Reply as bot (Trả lời bằng bot) | Quản trị viên | Mở hộp thoại, bot trả lời tin đã chọn; ping theo nội dung. Tương đương `/bot-message send` với `reply-message` |
| Mention non-reactors (Nhắc người chưa thả cảm xúc) | Dùng lệnh ứng dụng | `/mention not-react` với mặc định: không trả lời vào tin, không lọc vai trò, thành viên nhìn thấy kênh, bỏ bot; ping người chưa thả |
| Purge up to here (Xoá đến đây) | Quản trị viên | Xoá mọi tin mới hơn tin đã chọn (tin này được giữ), sau xem trước và xác nhận như `/purge any` |

---

## Hành vi tự động (không phải lệnh)

| Việc | Hành vi |
| --- | --- |
| Chúc sinh nhật | 00:00 giờ Việt Nam mỗi ngày, vào kênh sinh nhật của guild; một tin cho mỗi người, ping người đó. Bot tắt lúc 00:00 thì chúc bù khi khởi động. Sinh nhật 29/2 được chúc vào 28/2 ở năm không nhuận |
| Nối từ | Trong kênh đặt bởi `/word set`: bot thả phản ứng và trả lời theo luật nối từ; tin chat thường trong kênh được bỏ qua, trò đã đạt `max-words` thì im lặng đến khi `/word reset` |
| Auto-react | Tin chứa cụm trong từ điển phản ứng, hoặc có `react <emoji>`, được bot thả emoji tương ứng; áp dụng cả khi sửa tin. Emoji lỗi (thiếu quyền, server không có) bị bỏ qua, không báo người dùng |
| Báo lỗi | Lỗi bất ngờ khi chạy lệnh được gửi vào kênh `bot-log` của guild quản trị (không ping); người gọi chỉ thấy câu thông báo chung, không thấy chi tiết |

## Lệnh đã bỏ

- `/shutdown`: không còn. Tắt bot là việc của hạ tầng (Coolify), không qua Discord.

## Điểm cần kiểm (tổng hợp)

Khác biệt đã duyệt trong kế hoạch (nội dung tuỳ chọn mở hộp thoại, `members-of-role`, `ids` tuỳ chọn khi có `role`, lịch hẹn lưu DB và `/scheduler get` chỉ liệt kê lịch chờ) đã ghi ở từng lệnh. Còn lại cần chủ bot xác nhận:

1. `/get id-by-role`: bản cũ TỰ CHẶN người không có quyền Quản lý vai trò; kế hoạch (2026-10-11) quyết định bỏ chặn này, nên bản mới ai thấy lệnh cũng dùng được. Đây là chỗ bản mới MỞ RỘNG so với bản cũ — giữ hay khôi phục chặn?
2. Giới hạn 500 lịch chờ mỗi guild và tối đa 366 ngày chỉ áp cho REST/MCP (Release 2); lệnh slash không bị giới hạn, như bản cũ.
