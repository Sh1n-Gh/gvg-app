# P20 — Logging, probes và vận hành

Triển khai local ngày 08/09/2026. Chưa cài collector, tạo tài khoản Sentry, gửi telemetry ra ngoài hoặc cấu hình server thật. Một Node instance/SQLite theo P18. Người vận hành phải điền owner/on-call và xác minh cảnh báo trên staging trước GO.

## Log và điều tra

`security/observability.js` xuất một JSON/event ra stdout: UTC time, environment (`production/development/test/unknown`), level, event; HTTP có UUID do server tạo, method, status, duration_ms và probe. `X-Request-ID` và error response dùng cùng UUID; không tin ID client. `LOG_LEVEL` nhận debug/info/warn/error, mặc định development debug, còn lại info; giá trị sai trở về mặc định. Production phải dùng **info** để giữ mẫu số error rate. Probe được phân loại riêng để loại khỏi traffic nghiệp vụ.

Logger dùng allowlist kiểu/giá trị, loại toàn bộ trường không được phép: password/hash, cookie/set-cookie, authorization, admin code, session/CSRF/access/refresh token, body, query, URL/path, IP, tên/email/avatar/gym và dữ liệu thành viên. Không serialize Error, stack, message, object lồng nhau, toJSON hoặc getter. Cùng chính sách trong development. Đây là loại bỏ dữ liệu tại nguồn, không dựa vào regex đoán secret trong chuỗi. Muốn thêm trường log phải review privacy và bổ sung test canary trước. Không gọi console.log(req/err/env), không bật DEBUG của thư viện trong production.

P14 vẫn cho debug response ở development; production bắt buộc NODE_ENV=production. Log runtime không chứa stack ngay cả development. Điều tra bằng request_id → request_complete → request_error (database/application), thời điểm và artifact release đang chạy; tái hiện trên fixture để xem stack. Không yêu cầu người dùng gửi password/cookie hoặc bản chụp DB để tìm lỗi. Startup failure chỉ báo event; kiểm tra cấu hình theo runbook trên máy riêng tư.

Thu gom stdout JSON bằng journald/agent vào Loki, Elastic hoặc hệ thống tương đương qua TLS, tài khoản chỉ ghi; không thêm metadata từ env, process command line hoặc HTTP. Giới hạn retention đề xuất 14 ngày, quyền đọc chỉ nhóm vận hành; dashboard chỉ chứa số liệu tổng hợp. Cấu hình journald SystemMaxUse/RuntimeMaxUse/MaxRetentionSec theo dung lượng host, rotate/compress access log (ví dụ daily, 14 bản), cảnh báo collector drop/no-data. Logger không lưu DB hay tạo file log trong web root; sink lỗi không làm request thất bại. stdout không bảo đảm bền vững khi host chết; theo dõi agent/queue và disk.

Mẫu Nginx chỉ ghi status, duration và upstream request ID, bỏ URI/query/IP/referrer/user-agent. Error log Nginx có thể chứa URL/secret nên mẫu bỏ vào /dev/null; cấu hình log ở http/server/location khác không được override về combined/raw. Kiểm tra cấu hình hiệu lực trên staging. Điều tra proxy qua status/latency, service journal và nginx -t trong phiên quản trị riêng; nếu cần raw diagnostics, chỉ tái hiện dữ liệu tổng hợp trên staging riêng tư, không bật raw request error log cho traffic thật. Backup CLI P17 vẫn xuất receipt chứa đường dẫn: giữ journal job backup riêng, không ship receipt thô; adapter chỉ xuất success/time/duration/age và exit status.

## Health và readiness

- GET/HEAD `/health`: 200, GET có `{"status":"ok"}` khi process trả lời, kể cả DB hỏng. Không chứng minh database hoặc event loop luôn nhanh.
- GET/HEAD `/ready`: đọc bảng schema_migrations bằng prepared SELECT trên connection ứng dụng; 200 khi truy cập được, 503 generic khi DB lỗi hoặc draining. Không trả version/path/SQL/stack. Đây là kiểm tra đọc, không xác nhận dung lượng còn đủ để ghi hoặc integrity toàn DB.
- Cả hai no-store, không cần session, không chịu limiter ứng dụng nhưng vẫn có Host allowlist/security headers và limiter proxy. Check mỗi 15 giây, timeout 7 giây (SQLite busy_timeout 5 giây); ba lần lỗi liên tiếp cảnh báo. Không dùng readiness failure để restart loop khi disk/DB đang lỗi.

Ví dụ local production: `curl --fail --max-time 7 -H 'Host: gvg.example.invalid' http://127.0.0.1:3000/ready` (thay Host đúng PUBLIC_ORIGIN). Monitor ngoài dùng domain HTTPS thật; Node port vẫn không public. Probe lỗi trả error envelope P14 và request_id, không thông tin nội bộ.

## Shutdown

SIGTERM/SIGINT đánh dấu draining, dừng timer auth cleanup, ngừng nhận kết nối mới, đóng idle connections, chờ HTTP responses và handler async đang chạy rồi mới db.close. Request tới app khi draining trả 503/Connection: close; ready 503, health 200 nếu còn kết nối phục vụ probe. Sau server.close, probe có thể nhận connection refused, cũng là unavailable.

`trackedRouter` theo dõi toàn bộ handler routes Master/auth; `tracked` bọc map image middleware. Vì vậy client abort không khiến database đóng trước password hashing/upload và SQL tiếp theo. SQL better-sqlite3 chạy đồng bộ, transaction hoàn tất trước event loop nhận signal. Handler async/background operation mới có dùng DB phải tham gia lifecycle.track; không fire-and-forget. Timer cleanup hiện đồng bộ và được hủy lúc bắt đầu drain.

Deadline mặc định 30 giây, SHUTDOWN_TIMEOUT_MS 1000..120000; hết hạn ghi shutdown_timeout và exit 1, không chủ động db.close bên dưới operation còn chạy. Có thể mất request chưa hoàn tất; SQLite transaction/WAL không thay thế backup. Shutdown bình thường để process thoát tự nhiên nhằm flush stdout; không process.exit(0). SIGTERM lặp lại không rút ngắn deadline. Systemd mẫu TimeoutStopSec=45s, KillSignal=SIGTERM, Restart=on-failure; nếu tăng deadline phải tăng TimeoutStopSec tương ứng. Event loop bị block sẽ trì hoãn timer Node, nên supervisor là giới hạn cuối. Xác minh signal OS thật trên Linux staging (unit test local dùng signal emitter).

## Collector tương đương Sentry và cảnh báo

Phương án triển khai P20: collector nhận **chỉ JSON đã sanitize** ở trên, index environment/event/request_id/time và dashboard status/duration. Trên staging, gửi canary trong password, Authorization/Cookie, query, URL và lỗi giả; tìm canary trong stdout, proxy log, collector và alert payload phải không có. Gửi một 500 tổng hợp, xác nhận alert tới owner rồi recovery; không đưa input người dùng vào notification. Gắn release từ metadata deploy được review ở collector, không dump env.

Nếu chọn Sentry thay collector, làm adapter chỉ gửi event từ schema logger, không captureException(err) thô. Cài bản SDK đã audit ở task tích hợp; tắt thu thập PII, HTTP body, breadcrumbs, request/SQL instrumentation, traces/profiles/replay/attachments mặc định. beforeSend phải dựng event mới từ allowlist (event code cố định, environment, UUID hợp lệ, status), bỏ request/user/extra/contexts/exception và nội dung tự động; kiểm tra cả payload envelope, không chỉ dashboard. Dùng server-side scrubbing như lớp bổ sung, không thay sanitize tại nguồn. Không bật sendDefaultPii; advisory chính thức cho thấy cấu hình này từng làm lộ Cookie/Authorization trong spans: [Sentry security advisory](https://github.com/getsentry/sentry-javascript/security/advisories/GHSA-6465-jgvq-jhgp). Tài liệu [Sentry beforeSend](https://docs.sentry.io/pdfs/developer-quick-reference-guide.pdf) mô tả client-side filtering. P20 không thêm SDK hoặc DSN.

Ngưỡng khởi điểm cần hiệu chỉnh sau P23, không phải kết quả load test:

| Tín hiệu | Điều kiện đề xuất | Hành động/owner phải điền |
|---|---|---|
| Error rate | request_complete, probe=none, status>=500 / tất cả request_complete probe=none >2% trong 5 phút, >=50 requests; hoặc >=5 lỗi/5 phút ở traffic thấp | App on-call: UUID/time, release, ready, dependency/disk; không đếm request_error thêm lần nữa |
| Proxy errors | proxy_request 502/503/504 >=3/1 phút | Infra on-call: service/listener, timeout, ready, disk; phân biệt app 5xx |
| Process/probe | health/ready lỗi 3 lần; restart >=3/15 phút; shutdown_timeout bất kỳ | Infra + app on-call; kiểm tra nguyên nhân trước restart |
| Disk/inodes | volume DB/WAL, upload, backup, journal/temp: >80% 15 phút warning; >90% hoặc free <2 GiB critical; inodes >90% | Infra: mở rộng/retention đã review; không xóa DB/WAL/SHM hoặc upload đang dùng |
| Backup | job exit khác 0 ngay; last verified success >26 giờ với lịch daily; off-server verified copy >26 giờ | Backup owner: theo BACKUP-RESTORE, xác minh receipt/integrity và bản mã hóa off-server; không tính job start là success |
| Restore drill | quá 35 ngày chưa restore/integrity/smoke thành công | Backup owner lên lịch drill vào DB mới; theo dõi RPO/RTO P17 |
| Telemetry | agent lỗi/drop hoặc không có probe request_complete >5 phút | Infra: collector/journal/disk; tránh hiểu no-data là healthy |

Dashboard và alert chỉ kèm event/status/time/request ID; không gửi log thô CLI backup, DB hoặc credentials. Điền người trực chính/dự phòng, kênh nhận, escalation sau 15 phút chưa acknowledge; thử delivery/recovery trên staging trước GO. Không có automation hoặc thông báo bên ngoài được tạo trong task này.
