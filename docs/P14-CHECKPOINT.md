# P14 — Error handling và public privacy

Ngày thực hiện: 08/09/2026. **DONE trong phạm vi P14**; H-06 vẫn chờ quyết định sản phẩm. Không thực hiện P15/deploy/commit. Working tree ban đầu toàn bộ source/docs là untracked; không xóa dữ liệu runtime.

## Error boundary

- `security/errors.js`: request context, 404, centralized error handler. Context đứng trước Host guard, parser, limiter, static và authentication trong `server.js`.
- Contract lỗi JSON: `{ error: string, code: string, request_id: UUID }`; header `X-Request-ID` trùng body. Giữ error cho frontend. Tất cả response có ID server sinh mới, không tin/echo ID client gửi; lỗi có Cache-Control: no-store. Success payload giữ nguyên.
- Codes: INVALID_REQUEST (400), UNAUTHENTICATED (401), FORBIDDEN (403), NOT_FOUND (404), CONFLICT (409), PAYLOAD_TOO_LARGE (413), RATE_LIMITED (429), INTERNAL_ERROR (500).
- Chỉ PublicError do nghiệp vụ/validation/upload tạo được phép đưa message ra từ thrown error. SQL constraint trả 409 generic; lỗi database khác và lỗi bất ngờ trả 500 generic; parser không trả lại body/password. Không tin err.message chỉ vì err.status=400. Các response lỗi trực tiếp đã rà: dùng thông báo ứng dụng, không còn route serialize exception message.
- Engine dùng PublicError cho lỗi nghiệp vụ, giữ thông báo thiếu vé/vượt điểm. Catch create/edit/delete entry chuyển lỗi ra boundary thay vì gán mọi lỗi thành 400. Upload cũng chuyển lỗi ra boundary.
- Chỉ NODE_ENV=development bổ sung debug.message/stack vào JSON. Production và môi trường không khai báo đều ẩn chi tiết. Không dùng development trên dịch vụ public. Không thêm logger dữ liệu request/exception; structured logging và liên kết ID trong log thuộc P20.
- HTML 404/500 tối giản phù hợp Express/static: tiếng Việt, viewport, liên kết về trang chủ, mã yêu cầu. Không chèn URL/input/exception, không inline script/style. API giữ JSON kể cả Accept: text/html; dùng originalUrl vì router mount rút gọn req.path. Khi headers đã gửi, chuyển tiếp lỗi theo Express, không ghi body lần hai.

## Audit public API — không thay quyền hiển thị

Các API dưới đây không cần login, chỉ cần biết slug; slug không phải cơ chế bảo mật. Public router chặn gym missing/soft-delete; archive ràng buộc gym_id. Không có public danh bạ toàn bộ gym trong router hiện tại. Mutation vẫn yêu cầu session/role/CSRF.

| API và bằng chứng | Dữ liệu public | Nhu cầu UI và quyết định sản phẩm |
|---|---|---|
| /g/:slug/state, /seasons/:id/state; routes/gym-public.js:18–80 | Gym name/slug, season name/ID, map/round/progress; member id/gym_season_id/name/avatar_url/is_banned/banned_at/created_at, vé và tổng điểm | Name/avatar/điểm/vé phục vụ Dashboard. Cần duyệt roster public, nickname/tên thật và avatar opt-out. banned_at/created_at/gym_season_id không thấy Dashboard dùng trực tiếp: đề xuất bỏ sau duyệt. |
| /overview; routes/gym-public.js:129–189 | Tên/avatar/is_banned, điểm tổng và theo map, vé theo round/map, IDs | Ma trận dùng dữ liệu cá nhân này. Cần chốt công khai hiệu suất/trạng thái khóa hay chỉ tổng hợp. |
| /leaderboard; routes/gym-public.js:192–224 | Tên/avatar/is_banned, điểm, vé dùng/cấp/còn/tương lai, trung bình điểm/vé | UI có xếp hạng và badge khóa. Cần duyệt công khai tình trạng khóa và vé ngoài điểm số. |
| /log; routes/gym-public.js:227–244 | 300 lượt mới nhất mùa active: tên/avatar, member/map IDs, round/vé/điểm, created_at/updated_at, tên/ảnh map | Tên/map/round phục vụ filter, created_at hiển thị thời gian. Tiết lộ thời điểm hoạt động/hiệu suất: cần chốt audience, retention, độ chính xác thời gian và nhu cầu updated_at. 300 là giới hạn response, không phải chính sách retention. |
| /seasons và archive state; routes/gym-public.js:101–126 | Mọi mùa của gym, created_at/is_active, điểm tổng; roster và số liệu cá nhân mùa cũ | UI archive dùng danh sách này; cần duyệt public lịch sử vô thời hạn hay giới hạn mùa/quyền xem. |
| Gym identity và assets | Gym chỉ serialize name/slug; static/ảnh Map public; avatar có thể trỏ host ngoài | Không serialize admin_code/principal/hash/session/gym_requests qua public router. Cần duyệt nguồn ảnh/avatar và việc bên thứ ba có thể ghi nhận người xem; CSP allowlist đã có P11. |

SELECT * + spread member/map ở state có nguy cơ tự public cột mới khi schema mở rộng. Đề xuất chốt field allowlist sau review sản phẩm, kèm contract test trước khi thêm cột nhạy cảm. Không đổi success response hoặc quyền truy cập trong P14. Nhu cầu trên căn cứ frontend hiện tại, không thay cho quyết định đồng ý chia sẻ dữ liệu. **H-06 vẫn OPEN**.

## Kiểm thử

`npm run test:p14`: **116 checks PASS, 0 FAIL, 0 skip**: 34 Node tests (4 error, 3 deployment, 5 upload, 6 request security, 16 session), 32 engine checks và 50 route smoke checks. SQLite memory và kho upload test riêng; không dùng DB thật.

Test mới: unknown route/missing gym, Host reject sớm, JSON/HTML negotiation, ID khác nhau/không echo client, no-store, validation, malformed JSON chứa secret canary, body limit, lỗi giả status400, SQLite UNIQUE thật, query lỗi khi table không có, async rejection, development debug và default fail-closed. HTML kiểm tra qua HTTP/content; chưa browser visual QA/responsive ở P14. Smoke giữ public leaderboard/overview/log, tenant/soft-delete behavior.

Lượt đầu có lỗi escape fixture; harness fetch không giữ Host tùy chỉnh nên chuyển node:http. Test phát hiện req.path bị mount router rút gọn, đã sửa originalUrl. Assertion auth cũ so sánh cả ID giữa hai request được sửa so sánh nội dung trừ ID, đồng thời kiểm tra ID khác nhau. Lượt cuối toàn bộ runner P14 xanh. Không chạy full suite ngoài checkpoint.

## File thay đổi và giới hạn

- server.js; security/errors.js (mới); security/request-limits.js; security/validation.js; security/map-images.js; engine/index.js; routes/gym-admin.js; routes/master.js.
- test/error-handling-test.js (mới); test/session-test.js; package.json (test:p14).
- docs/P14-CHECKPOINT.md (mới); docs/PRODUCTION-GO-LIVE-PROMPTS.md; docs/PRODUCTION-READINESS.md.

H-03 PASS local. P10/C-01 và H-05 giữ trạng thái cũ; H-06 cần product decision; NO-GO không thay đổi. Lỗi do reverse proxy tự sinh cần xử lý ở cấu hình deploy, boundary này áp dụng Node. Logging có redact/correlation thuộc P20. Bước tiếp theo chỉ khi được giao: P15.

Commit đề xuất: `fix(errors): centralize safe responses and request IDs; audit public privacy`.
