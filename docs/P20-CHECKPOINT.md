# P20 — Logging, monitoring và health check

DONE local ngày 08/09/2026; lịch 05/10 trong kế hoạch là ngày dự kiến. Dừng tại P20, không làm P21, không deploy hoặc thao tác DB thật. Working tree ban đầu toàn source untracked; không commit, không xóa hoặc reset dữ liệu.

## Thay đổi

- `security/observability.js`: JSON stdout, environment/level và schema allowlist; không serialize secret, input HTTP, PII, exception message/stack hoặc object tùy ý. `security/errors.js` ghi lỗi bằng UUID và loại lỗi; lỗi sau headersSent đóng response, không chuyển raw Error vào Express final logger.
- `server.js`: dùng request ID P14 xuyên log/response, ghi một completion kể cả aborted; dotenv quiet; startup event an toàn; /health process, /ready prepared database read, no-store, lỗi generic và Host protection.
- `security/lifecycle.js`, `auth/backend.js`, `routes/master.js`: theo dõi HTTP và toàn handler async; SIGTERM/SIGINT idempotent, dừng cleanup timer/listener, drain rồi db.close; giới hạn deadline, fail exit 1 nếu hết hạn. Client disconnect không bỏ qua operation còn chạy.
- `test/observability-test.js`, `test/auth-test.js`, `package.json`: suite P20 và regression liên quan.
- `.env.example`, `deploy/gvg.service.example`, `deploy/nginx.conf.example`: log level/deadline, systemd stop window, proxy logs tối thiểu không raw request data.
- `docs/OBSERVABILITY.md`, `docs/DEPLOYMENT.md`, `docs/PRODUCTION-READINESS.md`, `docs/PRODUCTION-GO-LIVE-PROMPTS.md`, checkpoint này: runbook collector/Sentry, disk/backup/error-rate/telemetry alerts và cập nhật trạng thái.

## Kiểm thử

`npm run test:p20` exit 0 trên Node 24.19.0: **30 node:test PASS + 50 Master HTTP smoke PASS = 80 checks PASS, 0 FAIL, 0 skip**. Trong đó 7 test P20 kiểm tra allowlist ở mọi environment, nested secrets/getter/toJSON/circular input, log-level/sink failure, health/readiness/Host/draining/DB đóng thật, UUID error correlation, graceful async DB write với client connected/aborted, signal lặp và deadline không đóng DB dưới operation còn chạy. Regression: 4 error-handling, 16 session/auth, 3 deployment; smoke gồm Master mutations/upload và Gym session.

Lượt đầu fixture P20 thiếu bootstrap nên 5 test fixture không khởi tạo được; đã thêm password test tổng hợp, chạy lại toàn command trên PASS. Một lượt baseline trước khi nối server cũng PASS 20 error/session; không cộng vào 80 checks. Log ignored: `tmp-p20-tests.log`. Chỉ chạy suite liên quan, không chạy full checkpoint và không tuyên bố sửa lỗi P15. Sau chỉnh deployment mẫu chạy lại 3 deployment tests PASS (`tmp-p20-deployment.log`).

Kiểm tra thêm `node --test test/auth-test.js`: ban đầu 6 PASS/2 FAIL; cập nhật assertion startup từ stderr AUTH_CONFIG/URL text sang JSON startup_failed/server_started theo contract P20. Chạy lại **7 PASS/1 FAIL, 0 skip** (`tmp-p20-auth.log`): lỗi duy nhất còn lại là P15-Q1 đã biết, fixture PORT=0/thiếu TRUST_PROXY; xem P16 checkpoint. Không sửa cấu hình fixture hoặc skip lỗi đó. Như vậy suite P20 đạt 80/80; mở rộng auth có thêm 7 PASS và 1 FAIL đã biết, không tuyên bố toàn bộ regression xanh.

## Giới hạn và bước kế tiếp

Readiness chỉ chứng minh DB đọc được, không bảo đảm write capacity/integrity; disk/backup monitoring riêng. Deadline có thể kết thúc request chưa xong, supervisor cần timeout lớn hơn. Không bảo đảm log được giao bền vững khi crash/host chết. Không xuất stack production: điều tra bằng UUID/time/loại lỗi và tái hiện fixture. Development HTTP debug P14 vẫn có raw error theo hành vi cũ, bắt buộc production env đúng.

Collector/Sentry, retention, alert recipient/delivery và off-server backup age chưa được cấu hình thật; runbook đã có cách tích hợp và ngưỡng đề xuất. Test signal dùng emitter; cần diễn tập SIGTERM trên Linux/systemd thật và kiểm tra Nginx effective config ở staging. Giữ các gate P10/P15 và quyết định NO-GO hiện hữu. Khi người dùng yêu cầu tiếp, thực hiện P21 riêng.

Commit đề xuất: `feat(observability): add private structured logs probes and graceful shutdown`.
