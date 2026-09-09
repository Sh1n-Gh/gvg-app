# P09 — Validation, body limits và rate limiting

DONE — thực hiện 07/09/2026. Chỉ P09; không commit, deploy hoặc thực hiện P10. Working tree ban đầu toàn bộ source chưa được track; bảo toàn các file có sẵn và dữ liệu runtime.

## Giới hạn request

- JSON thông thường: **128 KiB**; `/auth/*` và reset credential: **8 KiB**. Parser giới hạn cả khi không có Content-Length; header dung lượng quá lớn bị từ chối trước khi parse. JSON nén bị từ chối để tránh chi phí giải nén.
- Upload: chỉ POST `/master/map-images`, PNG/JPEG raw, **5 MiB**, không giải nén request; giữ kiểm tra MIME/magic bytes và quyền Master/CSRF. Chưa decode/re-encode ảnh (P13).
- URL-encoded/multipart form: **không hỗ trợ**, từ chối ngay với 400, không parse/allocate field/file; Content-Length trên 8 KiB trả 413. Form chunked cũng bị từ chối ngay 400, không chờ đọc hết. Client hiện tại dùng JSON và raw image nên không cần multipart.
- Body có nội dung với media type khác bị từ chối 400; oversized Content-Length trả 413. Không thay đổi database/schema hoặc frontend.

## Rate limits

| Nhóm | Hạn mức | Khóa / lưu trữ |
|---|---|---|
| Kiểm tra credential Master | 5 lần thất bại / 15 phút | IP và principal Master, SQLite/HMAC |
| Kiểm tra credential Gym | 10 lần / IP và 5 lần / gym / 15 phút | IP và ID gym độc lập, SQLite/HMAC |
| Login/change-password/verify ở lớp HTTP | 20 request / 15 phút | IP, trước parser/auth; tính cả thành công và input sai |
| Upload | 10 request / phút | IP, trước parser/auth |
| Mutation khác | 120 request / phút | IP, trước parser/auth |
| API đọc và trang Master/Gym | 240 request / phút | IP, gồm GET/HEAD/OPTIONS; static asset không tính |

Credential limiter giữ hành vi P04: reserve atomic trước hash; thành công hoàn lại reservation; thất bại khóa tăng 15 → 30 → 60 phút; khóa gym theo ID nên đổi slug/IP không vượt được. `/verify` legacy vẫn 404, có hạn mức HTTP, không khôi phục xác thực legacy. IP IPv4-mapped được chuẩn hóa; IPv6 gom /64 để không né bằng privacy address.

HTTP limiter dùng fixed window trong RAM, tối đa 20.000 bucket, dọn hết hạn mỗi phút khi có request, fail closed khi đầy; không dùng timer mới. 429 luôn có `Retry-After` (giây). Upload có bucket riêng với mutation. Các ngưỡng đọc đủ cho Dashboard polling thông thường, cần đo tải/NAT thực tế ở P23.

**Giới hạn vận hành:** HTTP buckets reset khi restart và chưa chia sẻ giữa nhiều Node process. Chỉ vận hành một instance; trước khi scale phải dùng shared store hoặc limiter tại edge. Credential buckets vẫn bền vững trong SQLite. Rate limit ứng dụng không thay thế chống flood/giới hạn connection tại reverse proxy.

## Validation và mã lỗi

`security/validation.js` dùng chung cho các route: ID path là số nguyên dương an toàn, không nhận số âm/thập phân/NaN/ký tự đuôi; ID body phải là JSON number nguyên an toàn. ID đúng cú pháp nhưng không có/không thuộc tenant trả 404.

- Tên Gym/Season/Map/member: chuỗi Unicode hợp lệ, tối đa 120 ký tự UTF-16, không rỗng/control. Tên member được trim khi sửa/tạo.
- Slug: input tối đa 100, giữ slugify tiếng Việt hiện có; slug kết quả và path chỉ lowercase ASCII số/chữ, dấu `-`, tối đa 100. Không ép object thành string.
- URL avatar/Map: tối đa 2048, HTTP(S) hoặc relative; cấm credentials, protocol-relative, scheme khác, control/whitespace, quote/angle/backslash/backtick. Đây là policy URL, không xác minh nội dung máy chủ ảnh.
- Note: tối đa 2000, cho newline/tab; type weakness giữ allowlist 18 type.
- Bulk roster: tối đa 500, validate toàn bộ trước ghi; phần tử sai không còn bị bỏ qua âm thầm, tên trùng trong payload trả 409.
- Điểm/max score: JSON number nguyên 1..1.000.000.000; vé entry 1..3 (quy tắc engine). Không nhận numeric string, null, boolean, NaN/Infinity hoặc số ngoài giới hạn.
- Template tối đa 100 Map và 100 Round; Round liên tục từ 1, không trùng. Map ID sửa phải thuộc template, Map mới không tự cấp ID. Round của entry vẫn do server quyết định.
- Ticket config: day1/daily là số nguyên 0..10.000; regen_days 0..366; battle_start_at là ISO UTC hợp lệ có giây, tùy chọn 3 chữ số millisecond, không nhận ngày bị Date tự cuộn như 30/02.
- Không tin trường tính toán dư từ client (repeat score/last round vẫn tính từ rounds); không cho input sai đi tới phép ép Number/SQL. Middleware xét cả route viết hoa/trailing slash như Express.

Error JSON giữ `error` tương thích frontend, thêm `code` ổn định:

| HTTP | code | Ý nghĩa |
|---|---|---|
| 400 | INVALID_REQUEST | Cú pháp/type/range/URL hoặc quy tắc input không hợp lệ |
| 401 | UNAUTHENTICATED | Thiếu session hoặc credential không hợp lệ |
| 403 | FORBIDDEN | CSRF/Origin/tenant hoặc thành viên bị khóa |
| 404 | NOT_FOUND | Resource không tồn tại/không thuộc phạm vi; verify legacy |
| 409 | CONFLICT | Trùng slug/tên, constraint xung đột hoặc rotation race |
| 413 | PAYLOAD_TOO_LARGE | Vượt body limit |
| 429 | RATE_LIMITED | Vượt hạn mức, có Retry-After |

Fallback route trả JSON 404. Không trả SQL/stack từ centralized middleware; chỉ error validation tự tạo được trả cụ thể. Audit privacy/correlation ID/error handling đầy đủ vẫn thuộc P14.

## Trust proxy bắt buộc khi triển khai

`TRUST_PROXY` mặc định rỗng/false: Express bỏ qua X-Forwarded-For của client trực tiếp. Khi reverse proxy cùng máy kết nối qua loopback, đặt `TRUST_PROXY=127.0.0.1,::1`. Proxy máy riêng: chỉ liệt kê địa chỉ hoặc CIDR nhỏ thực sự thuộc proxy, phân cách dấu phẩy. Không chấp nhận `true`, hop count hoặc subnet `/0`; giá trị sai fail startup.

Limiter dùng `req.ip` sau khi Express kiểm tra trust chain, không lấy socket IP hoặc tự tin header. Proxy phải ghi đè header từ client tại edge: `X-Forwarded-For` bằng IP kết nối thực, `X-Forwarded-Proto` bằng scheme thật, `Host` đúng domain. Ví dụ Nginx edge: `proxy_set_header X-Forwarded-For $remote_addr;` và `proxy_set_header X-Forwarded-Proto $scheme;`. Với nhiều proxy, edge xóa header giả, proxy nội bộ append chain, chỉ trust các hop thực tế. Giới hạn truy cập Node port bằng loopback/firewall để client không tiếp cận qua một peer đã được trust.

Cookie Secure production cần X-Forwarded-Proto đúng và `PUBLIC_ORIGIN=https://domain-thuc` chính xác. Không bật trust proxy mà chưa xác định topology. P12 sẽ tạo config deployment hoàn chỉnh và kiểm tra trên staging; P09 không sửa server/domain thật.

## Kiểm thử và file thay đổi

- `npm run test:p09`: **22 PASS / 0 FAIL** (6 nhóm request security + 16 session), rồi **50 PASS / 0 FAIL** smoke API. Không chạy toàn bộ suite (checkpoint P10).
- P09 kiểm tra brute force cùng gym khác IP, cùng IP khác gym, header giả trực tiếp, trust proxy, IPv6 /64, verify đã gỡ, từng quota/expiry/Retry-After, JSON/upload/form oversized, JSON hỏng, tên/note/array dài, URL sai, ngày sai, ID sai, số âm/numeric string/null/NaN/Infinity, constraint 409 và request ghi hợp lệ. SQLite `:memory:`; smoke test dùng DB fixture và tự dọn đúng upload/snapshot tạo trong test.
- Regression smoke xác nhận template/create/edit, slug, auth, raw PNG/upload, member/avatar, entry/điểm/vé và public views vẫn chạy. Session regression xác nhận CSRF/tenant/expiry/reset và credential limit atomic/persistent.
- Lượt phát triển đầu: test Type Weakness lệch message và fixture entry thiếu khởi tạo Round; đã sửa message validation và fixture, lượt cuối tất cả pass.
- Runtime: `server.js`, `auth/backend.js`, `routes/master.js`, `routes/gym-admin.js`, `routes/gym-public.js`, thêm `security/validation.js`, `security/request-limits.js`.
- Test/config/docs: thêm `test/request-security-test.js`, sửa `package.json`, `.env.example`, tài liệu này, bảng P09 và `PRODUCTION-READINESS.md`.

Bước tiếp theo: P10 theo yêu cầu riêng của người dùng. Dừng tại P09. Commit đề xuất: `fix(security): validate inputs and enforce request and rate limits`.
