# P08 — Chống XSS cho Master Admin

P08 DONE — hoàn thành 07/09/2026.

Phạm vi runtime: chỉ `public/master.js`. Thêm `test/master-xss-test.js`, checkpoint này và cập nhật bảng P08. Không sửa Dashboard, Gym Admin, CSS/HTML, authentication hoặc backend. Working tree ban đầu toàn bộ source chưa được Git track; không commit.

## Kiểm kê HTML sink

Trước sửa: **18 innerHTML + 4 insertAdjacentHTML**. Tất cả nguồn API/DB/user đều không được coi là HTML an toàn, kể cả ID/trường số.

| Vị trí trước sửa | Số sink | Nguồn / xử lý |
|---|---:|---|
| loadDashboard: loading / nội dung / lỗi | 3 innerHTML | Loading là hằng; summary chuyển DOM/textContent cho tên season active và số lượng; lỗi API chuyển p/textContent |
| loadSeasonList: loading / danh sách / lỗi | 3 innerHTML | `/season-templates`: id, name, gym_count được escape trong text/quoted attribute; badge/class nội bộ; lỗi chuyển DOM |
| FileReader.onload / nút Bỏ ảnh | 2 innerHTML | File cục bộ do user chọn; preview/clear chuyển DOM, không nội suy reader.result vào HTML |
| st-add-map / st-add-round | 2 insertAdjacentHTML | Template nội bộ, round number tính từ số dòng; helper mapRowHtml/roundRowHtml được escape đầy đủ |
| resetSeasonForm clear maps / rounds | 2 innerHTML | Chuỗi rỗng hằng, giữ nguyên |
| resetSeasonForm thêm Map / Round mặc định | 2 insertAdjacentHTML | Template nội bộ, giữ nguyên |
| startEditSeason maps / rounds | 2 innerHTML | `/season-templates/:id`: Map id/name/image_url/note, round_number/max_score escape; Pokemon Type qua allowlist |
| loadGymList: loading / danh sách / lỗi | 3 innerHTML | `/gyms`: id/name/slug escape; trạng thái deleted chỉ chọn badge/class hằng; lỗi chuyển DOM |
| loadRequestList: loading / danh sách / lỗi | 3 innerHTML | `/gym-requests`: gym_name/desired_slug/contact_info escape kể cả fragment lồng nhau; lỗi chuyển DOM |

Sau sửa: **11 innerHTML + 4 insertAdjacentHTML**. Các template form/danh sách phức tạp giữ cây DOM, class và khoảng trắng để bảo toàn view/edit layout. Loading/clear là hằng; mọi scalar bên ngoài trong template động được escape ở text hoặc attribute có dấu nháy. Không dùng escape cho script/CSS/URL. Các fragment còn lại chỉ là template nội bộ và dropdown Pokemon Type từ allowlist P06.

Các surface đã an toàn được giữ nguyên: tiêu đề sửa season bằng textContent, input season/config bằng value, nhãn round/repeat-score, slug hint, thông báo submit bằng textContent và hộp thoại alert/confirm/prompt. `auth-client.js` dùng textContent cho lỗi. Không sửa các helper dùng chung này.

## Ảnh và URL ngoài innerHTML

- `masterHttpUrl`: chỉ HTTP(S)/đường dẫn tương đối hợp lệ, từ chối control/whitespace, dấu nháy, angle brackets, backtick, backslash, credentials, URL sai; không cho javascript:, data:, blob:, file: từ API/DB.
- Map preview từ DB tạo img bằng DOM khi bind form. alt lấy qua property; bỏ inline onerror khỏi HTML, thay bằng callback cố định để ảnh hỏng tự biến mất như trước. Hidden input giữ URL nguyên văn dưới dạng dữ liệu.
- FileReader preview dùng đường riêng `masterRasterPreviewUrl`: chỉ data:image/png hoặc data:image/jpeg với base64. Không cho data HTML/SVG hoặc chuỗi phá attribute. URL này chỉ được gán vào img.src bằng DOM và không dùng cho API/DB URL. Giữ giới hạn MIME PNG/JPEG và 5 MB hiện có.
- Callback đọc file bỏ qua kết quả nếu file đã bị clear/thay hoặc dòng Map bị xóa; tránh preview cũ xuất hiện lại sau thao tác user.
- Kết quả upload `/map-images` phải qua HTTP URL policy trước khi đưa vào template gửi lưu; URL nguy hiểm làm submit dừng với lỗi text. URL hợp lệ, dữ liệu file và tên/note được gửi nguyên văn, không lưu chuỗi HTML đã escape.
- Hai href sau tạo Gym cũng đi qua URL policy. URL không hợp lệ chỉ hiển thị text và không có href; không giữ lại liên kết cũ. Mã Admin hiển thị bằng textContent như trước.

## Regression

- `node --test test/master-xss-test.js`: **9 PASS / 0 FAIL**, 8 subtest + parent, không skip trong lượt cuối.

- `node test/frontend-ux-test.js`: **41 PASS / 0 FAIL**.
- `node test/master-routes-smoke-test.js`: **50 PASS / 0 FAIL**.
- `node --test test/frontend-session-test.js`: **5 PASS / 0 FAIL** (4 subtest + parent).

`test/master-xss-test.js` gồm helper roundtrip và URL policy; payload Gym/season/request/Map/Round/ID/note; preview URL và link tạo Gym; lỗi list/detail/create/upload/save; filename chứa payload; PNG/JPEG preview, clear, MIME/size và callback trễ; phản hồi upload nguy hiểm; responsive; luồng API/SQLite thật.

Luồng thật dùng session/CSRF, SQLite `:memory:` và tên season có UUID riêng: tạo template với PNG, mở lại preview, sửa tên Map/note và ảnh JPEG, thêm Round, xóa ảnh/Round, kiểm tra repeat_max_score, hủy draft. Kiểm tra ID Map/season không đổi, dữ liệu chứa payload vẫn nguyên văn, ảnh upload được phục vụ/decode và 5 mutation có CSRF. Chỉ dọn đúng file upload/snapshot do fixture trả về; không xóa thư mục hoặc dữ liệu production.

Các artifact local ở `tmp/p08/` (ignored): baseline `master-before.js`, ảnh before/after và JSON kết quả pixel. Visual subtest báo SKIP khi thiếu baseline ở checkout khác. Fixture dùng Edge headless, font ngoài bị chặn; animation/smooth scroll tắt riêng trong test để đo trạng thái cuối. Không sửa CSS ứng dụng.

### Kiểm tra responsive

15 cặp ảnh tại 390/768/1440 px × Dashboard Master, sửa template, preview PNG, Gyms và Gym Requests. So sánh chính xác tag/id/class và hình học của các phần tử hiển thị, kích thước ảnh và pixel với dung sai tối đa 1/255 mỗi kênh màu. Không tuyên bố PNG giống nhau từng byte. Đã xem ảnh mobile preview và desktop sửa template.

Lượt đầu báo khác 1 pixel/1 đơn vị màu, nên thay phép so PNG byte bằng pixel + hình học. Harness cũng chờ form cũ được thay sau API và tắt smooth scroll/animation trước đo để không so trạng thái giữa transition; không thay runtime/layout để làm test pass.

## Giới hạn và bước tiếp theo

Không coi validation URL là kiểm tra nội dung upload. Backend decode/re-encode ảnh và MIME thực thuộc P13; CSP thuộc P11. Không chạy toàn bộ backend suite trong ngày này. Giới hạn visual P06 đã ghi ở P07 không được sửa trong P08. Dừng tại P08, không làm P09, không commit/deploy.

Commit đề xuất: `fix(master): prevent XSS in rendering and secure image previews`.
