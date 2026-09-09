# P13 — Gia cố upload ảnh Map

Ngày thực hiện: 08/09/2026. Phạm vi upload; không làm P14, không deploy, không commit.

## Hành vi và giới hạn

- Giữ POST `/master/map-images`, raw PNG/JPEG, session Master + CSRF, response `{ok,image_url}` và UX preview/lưu/sửa hiện tại; không sửa frontend.
- Giữ **5 MiB (5 × 1024² byte)** đầu vào và áp cùng trần cho ảnh sau encode. Mỗi chiều tối đa **8192 px**, tổng tối đa **16.000.000 pixel**. Không resize ngầm: ảnh vượt mức trả 413 để người dùng giảm kích thước. Đây là mức dư cho Map dashboard, giới hạn một raster RGBA 8-bit khoảng 64 MB (không phải trần RSS toàn decoder).
- Sharp **0.35.4** được pin trong manifest/lock: kiểm tra magic PNG/JPEG rồi kiểm tra format decoder, strict `failOn: warning`, `limitInputPixels`, từ chối nhiều trang được decoder báo cáo, decode toàn ảnh khi encode lại. Áp EXIF orientation trước khi bỏ metadata; PNG giữ alpha, JPEG quality 90. Metadata EXIF/ICC/IPTC/XMP và payload nối đuôi không được sao chép.
- Tên UUID do server sinh, exclusive write `wx`; filename client không được sử dụng. MIME request chỉ chọn raw parser, không quyết định format đầu ra (PNG khai JPEG vẫn được chuẩn hóa thành PNG). SVG/GIF/HTML/file chỉ có signature hoặc ảnh lỗi trả 400.
- Handler riêng cho `/uploads/map-images` đứng trước static: allowlist tên/đuôi PNG/JPG/JPEG, không symlink, không fallback sang static, `Content-Type` cố định theo format server và `nosniff`. Giữ URL ảnh cũ. File cũ **chưa được re-encode**; không tự sửa/xóa chúng. Nginx phải proxy đường dẫn này qua Node theo mẫu P12, không thêm static alias bypass handler.
- Tối đa 2 tác vụ decode đồng thời/process; tác vụ tiếp theo nhận 429; timeout xử lý Sharp 10 giây. Rate limit P09 và body limit tiếp tục áp dụng. Đây không phải sandbox native decoder/hard memory limit; service cần giới hạn tài nguyên, một Node instance và cập nhật Sharp/libvips định kỳ.

Tham khảo chính thức: [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/) và [output/metadata mặc định](https://sharp.pixelplumbing.com/api-output/).

## Quota và thiết kế dọn orphan

Quota đã triển khai: **512 MiB hoặc 2000 file** cho toàn kho Map (Master dùng chung), gồm ảnh cũ và orphan; `.gitkeep` không tính. Kiểm tra lại dung lượng ngay trước exclusive write, không `await` giữa kiểm tra và ghi, tránh vượt quota khi nhiều upload cùng hoàn tất trong một process. Đầy kho trả 409 có thông báo; không xóa ảnh để nhường chỗ. File/subdirectory/symlink bất thường khiến admission dừng an toàn. Các giá trị nằm ở `security/map-images.js`; cần duyệt dung lượng disk trước khi tăng. Không hỗ trợ nhiều process ghi chung kho; quota OS/disk và cảnh báo 80% nên cấu hình khi vận hành.

**Không bật automatic cleanup và không thêm lệnh xóa trong P13.** Đây là lựa chọn bảo toàn dữ liệu: upload và PATCH template là hai request riêng; browser có thể đang giữ URL chưa lưu. Quota giới hạn phần tồn đọng. Quy trình cleanup cần triển khai sau khi có inventory backup/restore P17:

1. Lập báo cáo chỉ đọc, tên + size + hash + thời gian; không coi tuổi file là bằng chứng orphan. Chỉ xét tên file server-generated, regular file trong root kho đã resolve; bỏ qua file cũ không rõ nguồn/symlink/reparse point.
2. Tập tham chiếu phải gồm **tất cả** `season_template_maps.image_url` (không lọc active, gồm gym soft-delete/mùa cũ), mọi trường URL DB khác như avatar có thể dùng cùng ảnh, mọi JSON trong `season-configs`, và manifest các backup/restore còn retention. Chuẩn hóa URL relative/absolute cùng origin, percent encoding, query/fragment về cùng asset; tham chiếu không hiểu được hoặc nguồn không đọc được thì dừng cleanup, không suy đoán là orphan.
3. Chỉ lập ứng viên không được tham chiếu, tối thiểu 7 ngày tuổi; chụp lại inventory ở hai lần cách nhau ít nhất 24 giờ. Dry-run là mặc định và cần báo cáo review trước bước chuyển file.
4. Khi thực thi: maintenance offline, dừng **tất cả** writer/Node, khóa độc quyền, đóng phiên edit cũ hoặc yêu cầu reload trước khi resume; kiểm tra lại toàn bộ references + hash + root ngay sát lúc chuyển. Nếu chưa bảo đảm được các điều kiện này, không dọn. Không chạy cron online dựa trên một SELECT rồi unlink vì có race với PATCH template.
5. Chuyển ứng viên vào quarantine ngoài web root, có manifest để phục hồi URL gốc, giữ ít nhất 30 ngày và không ngắn hơn retention backup dài nhất. Không giảm quota/disk accounting vận hành bằng cách che giấu quarantine. Không purge khi còn backup có thể cần ảnh. Trước purge phải rà references/retention lại dưới maintenance và có backup kiểm chứng restore.
6. Cleanup tương lai bắt buộc có test: shared image, template inactive, gym đã xóa mềm, snapshot/backup-only reference, pending upload/edit, absolute/encoded URL, tham chiếu phát sinh giữa dry-run/apply, symlink/path traversal, crash/quarantine restore. Chưa có cleanup executable nên P13 không tuyên bố đã test deletion.

## Kiểm thử và giới hạn

Lệnh: `npm run test:p13` — suite upload mới, session/CSRF, Master API smoke và Master browser/XSS/preview/template regression. **80 checks PASS, 0 FAIL, 0 skip**: 5 upload + 16 session + 50 smoke assertions + 9 browser (gồm parent). Chạy thêm `node --test test/request-security-test.js`: **6 PASS**, tổng **86 checks PASS**. Lượt đầu test mới dùng nhầm PUT và nhận 404; đã sửa fixture về PATCH đúng API rồi chạy lại thành công. So sánh responsive từ baseline có sẵn PASS; không thay baseline.

Suite mới dùng SQLite memory và kho ảnh temp riêng: PNG/JPEG hợp lệ, orientation/metadata/alpha, payload cuối file, signature sai/giả đuôi/truncated, byte/width/height/pixel limits, quota cạnh tranh và bảo toàn file cũ, HTTP MIME/filename giả, fixed serving, PATCH template và giữ ảnh trước đó. Không dùng database production.

`npm audit --omit=dev`: 1 moderate ở dependency `qs`, 0 high/critical; không tự audit-fix ngoài phạm vi P13, chuyển đánh giá sang P19. P10 vẫn BLOCKED và kết luận go-live không thay đổi.

Rollback code cần rollback cả manifest/lock và cài dependency tương ứng; ảnh mới vẫn PNG/JPEG, URL/DB schema không đổi. Không xóa upload khi rollback. Bước tiếp theo chỉ khi được giao: P14.

Commit đề xuất: `fix(upload): normalize map images and bound storage and decoding`.
