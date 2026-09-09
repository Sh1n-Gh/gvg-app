# Authentication Design — Master Admin và Gym Admin

Trạng thái: **APPROVED — người dùng xác nhận phê duyệt khi yêu cầu P03 ngày 05/09/2026**  
Ngày thiết kế: 04/09/2026  
Runtime mục tiêu: Node.js 24 LTS, tối thiểu `>=24.7.0`; runtime đã kiểm tra tại P02 là `v24.19.0`  
Phạm vi triển khai dự kiến: P03 (credential/schema) → P04 (session/authorization) → P05 (frontend/cắt legacy)

Tài liệu này không chứa password, hash, session ID, token hoặc secret thật.

## 1. Quyết định kiến trúc

| Hạng mục | Quyết định |
|---|---|
| Password hashing | Argon2id qua API async `node:crypto`; không thêm native hashing addon. |
| Credential model | Một bảng `auth_principals` cho đúng một Master Admin và một principal cho mỗi Gym. |
| Session | `express-session@1.19.0` với custom store dùng chính `better-sqlite3`; tuyệt đối không dùng `MemoryStore` ở production. |
| Session token | Cookie chỉ giữ opaque random session ID có chữ ký; database chỉ giữ SHA-256 của ID, không giữ bearer token dùng lại được. |
| Cookie | Hai cookie tách biệt Master/Gym, `HttpOnly`, `Secure` ở production, `SameSite=Lax`, `Path=/`, không `Domain`. |
| CSRF | Same-origin/Origin validation + synchronizer token gắn với session cho mọi POST/PATCH/DELETE. |
| Authorization | Role và `gym_id` lấy từ session phía server; Gym Admin luôn phải khớp gym đã resolve từ slug. |
| Migration | Additive, idempotent, dual-auth có feature flag; chỉ scrub plaintext sau khi frontend session đã được xác minh. |
| Password reset | Master có thể reset Gym Admin; Master recovery chỉ qua CLI/offline trên server. Không có email reset trong phạm vi hiện tại. |
| Rate limiting | Persistent SQLite buckets cho login; giới hạn bổ sung cho mutation/public API ở P09. |

Lý do chọn:

- Node đã có `crypto.argon2()` từ 24.7.0 và runtime 24.19.0 hiện tại expose cả async/sync API. Thiết kế chỉ dùng async API để không chặn event loop. [Node.js Crypto API](https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptoargon2algorithm-parameters-callback)
- OWASP ưu tiên Argon2id và nêu baseline `m=19456 KiB, t=2, p=1`; tham số phải benchmark lại trên server production, với mục tiêu mỗi lần verify dưới một giây. [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- `express-session` do Express duy trì, cookie chỉ chứa session ID và session data nằm phía server; tài liệu chính thức cảnh báo MemoryStore không phù hợp production. Bản stable được kiểm tra tại P02 là 1.19.0. [Express session repository](https://github.com/expressjs/session), [Express session documentation](https://expressjs.com/en/resources/middleware/session/)

Không chọn bcrypt vì Argon2id đã có ngay trong runtime mục tiêu, memory-hard và không có giới hạn input 72 byte đặc thù của bcrypt. Không chọn JWT cho browser session vì logout/revoke/password rotation khó kiểm soát hơn và không có nhu cầu stateless/multi-service.

## 2. Baseline hiện tại cần thay thế

- Master dùng một giá trị module-level từ environment, có fallback công khai, và so trực tiếp với `x-master-admin-code` (`routes/master.js:9-24`).
- Gym Admin so trực tiếp `x-admin-code` với `gyms.admin_code` plaintext (`routes/gym-admin.js:12-31`; `db/schema.sql:35-43`).
- Frontend giữ mã trong biến JS rồi gửi lại ở mọi request (`public/master.js:1-13,16-35`; `public/admin.js:1-29,41-55`). Không thấy lưu vào localStorage/sessionStorage; đặc tính tốt này phải được giữ.
- Master tạo gym có thể nhận `admin_code`, lưu plaintext và trả lại trong response (`routes/master.js:271-309`).
- Master middleware toàn cục nằm sau upload special case; route HTML `/master` được mount trước router và thứ tự đó phải giữ (`routes/master.js:40-72`; `server.js:20-28`).
- Gym Admin đã có tenant scoping đáng giữ: resolve gym từ slug chưa soft-delete, rồi member/entry scope theo active `gym_season_id` (`routes/gym-admin.js:12-21,64-66,140-142,159-162`).

## 3. Password hashing

### 3.1 Format và tham số

- Thuật toán: `argon2id`.
- Salt/nonce: 16 random bytes từ `crypto.randomBytes()` cho mỗi credential.
- Derived key: 32 bytes.
- Baseline: memory `19456` KiB, passes `2`, parallelism `1`.
- Lưu self-describing PHC-style string gồm algorithm/version/parameters/salt/hash; parser phải strict và từ chối algorithm/parameter ngoài allowlist.
- Mỗi login đọc tham số từ hash hiện có. Sau login thành công, rehash nếu hash dùng policy cũ/yếu hơn.
- Dùng `crypto.timingSafeEqual()` trên hai buffer cùng độ dài khi verify.
- Không dùng fast hash như SHA-256 để hash password. SHA-256 chỉ dùng cho opaque session ID.
- Không thêm pepper ở giai đoạn đầu: vận hành/rotation chưa có secret manager hoàn chỉnh. Có thể thêm sau với versioned policy; salt vẫn bắt buộc và không bí mật.

### 3.2 Password policy

- Password mới: tối thiểu 12 Unicode characters và tối đa 256 UTF-8 bytes; cho phép space, Unicode và password manager output; không ép pattern chữ hoa/số/ký tự đặc biệt.
- Không trim hoặc Unicode-normalize password; hash đúng byte UTF-8 người dùng nhập.
- Legacy admin code được hash nguyên trạng dù ngắn hơn policy để không khóa người dùng; principal đó mang `must_rotate=1` nhưng vẫn được phép dùng trong grace period.
- Password không xuất hiện trong log, URL, command-line argument, analytics, error hoặc tài liệu. Request body auth phải có giới hạn nhỏ và `Cache-Control: no-store` cho response auth/reset.
- Login cho principal không tồn tại vẫn chạy verify với một dummy Argon2id hash cùng cost để giảm username/slug timing oracle.

### 3.3 Runtime/dependency gate

- P03 phải fail fast nếu `typeof crypto.argon2 !== 'function'`; không âm thầm hạ xuống hash yếu hơn.
- Pin Node 24 LTS version trong `engines`/deployment; không chỉ dựa vào version developer machine.
- Benchmark async hash trên staging với concurrent login attempts trước khi tăng cost. Rate limiting phải chạy trước expensive hash.

## 4. Data model

P03 thêm schema theo kiểu additive; chưa xóa cột hiện tại.

### `auth_principals`

| Column | Ý nghĩa/ràng buộc |
|---|---|
| `id INTEGER PRIMARY KEY` | Internal principal ID. |
| `role TEXT NOT NULL` | Chỉ `master` hoặc `gym`. |
| `gym_id INTEGER REFERENCES gyms(id)` | NULL cho Master; bắt buộc và unique cho Gym. |
| `password_hash TEXT NOT NULL` | PHC-style Argon2id string; không trả qua API. |
| `password_version INTEGER NOT NULL DEFAULT 1` | Tăng khi đổi/reset/rehash có thay credential. |
| `session_version INTEGER NOT NULL DEFAULT 1` | Tăng để revoke đồng loạt session cũ. |
| `must_rotate INTEGER NOT NULL DEFAULT 0` | Đánh dấu credential bootstrap/legacy/temp. |
| `created_at`, `password_changed_at` | UTC timestamps. |
| `disabled_at` | Disable principal mà không xóa audit relationship. |

Ràng buộc bắt buộc:

- `CHECK ((role='master' AND gym_id IS NULL) OR (role='gym' AND gym_id IS NOT NULL))`.
- Partial unique index bảo đảm chỉ một `master`.
- Unique index trên `gym_id` khi role là `gym`.
- Không dùng `SELECT *` ở API Master sau migration để tránh vô tình trả `password_hash` hoặc legacy `admin_code`.

### `auth_sessions`

| Column | Ý nghĩa/ràng buộc |
|---|---|
| `sid_hash BLOB PRIMARY KEY` | SHA-256 của random session ID; cookie ID thô không lưu trong DB. |
| `namespace TEXT NOT NULL` | `master` hoặc `gym`, khớp cookie/middleware tương ứng. |
| `principal_id INTEGER NOT NULL REFERENCES auth_principals(id)` | Chủ session. |
| `principal_session_version INTEGER NOT NULL` | Snapshot để revoke khi password/session version đổi. |
| `gym_id INTEGER` | Denormalized để audit/index; middleware vẫn đối chiếu principal và request gym. |
| `session_json TEXT NOT NULL` | Dữ liệu tối thiểu: principal ID/role/gym, CSRF token; không chứa password/hash. |
| `created_at`, `last_seen_at`, `idle_expires_at`, `absolute_expires_at` | Epoch milliseconds hoặc UTC thống nhất. |
| `revoked_at` | Logout/reset/revoke marker; cleanup có thể xóa sau retention ngắn. |

Index: `principal_id`, `idle_expires_at`, `absolute_expires_at`, và `(namespace,gym_id)`. Store phải implement `get/set/touch/destroy/clearExpired`; `touch` chỉ ghi tối đa mỗi 5 phút để giảm SQLite write contention.

### `auth_rate_limits`

| Column | Ý nghĩa |
|---|---|
| `bucket_hash BLOB PRIMARY KEY` | HMAC của namespace + canonical IP hoặc principal key; không lưu IP/password thô. |
| `window_started_at`, `attempt_count`, `blocked_until` | Sliding/fixed window state đủ cho baseline. |
| `updated_at` | Cleanup và audit. |

HMAC key lấy từ secret store (`AUTH_RATE_LIMIT_SECRET`), khác session signing secret.

## 5. Session và cookie

### 5.1 Hai namespace độc lập

- Master cookie: production `__Host-gvg_master_session`; development HTTP `gvg_master_session`.
- Gym cookie: production `__Host-gvg_gym_session`; development HTTP `gvg_gym_session`.
- Tách cookie cho phép cùng một browser giữ Master và Gym session đồng thời, không làm role này ghi đè role kia.
- Một Gym cookie chỉ mang một Gym principal tại một thời điểm. Login gym khác thay session Gym hiện tại; Master session không bị ảnh hưởng.

### 5.2 Cookie attributes

- `HttpOnly=true` để JavaScript không đọc session ID.
- `Secure=true` bắt buộc production; development localhost mới được `false`.
- `SameSite=Lax`; CSRF token và Origin check vẫn bắt buộc vì SameSite chỉ là defense-in-depth.
- `Path=/`, không set `Domain`, `Priority=High` nếu thư viện/browser hỗ trợ.
- Dùng prefix `__Host-` chỉ ở production vì prefix này yêu cầu Secure và Path `/`.
- `saveUninitialized=false`, `resave=false`; regenerate session ID sau login và password change để chống fixation.
- Session signing keys đến từ `SESSION_SECRETS` trong secret store: key hiện tại đứng đầu, key cũ chỉ verify trong rotation window. Thiếu key ở production phải fail fast.

### 5.3 Expiry

| Principal | Idle timeout | Absolute timeout |
|---|---:|---:|
| Master | 30 phút | 8 giờ |
| Gym Admin | 8 giờ | 24 giờ |

- Server kiểm tra cả idle và absolute expiry mỗi request; cookie Max-Age không thay thế server expiry.
- Activity có thể gia hạn idle nhưng không vượt absolute timeout.
- Expired/revoked/version-mismatch session trả 401, destroy store row và clear đúng cookie.
- Startup và job định kỳ xóa expired session; request path không thực hiện full-table cleanup.

## 6. CSRF

- Login và mọi unsafe request phải là same-origin JSON/raw upload. Production yêu cầu `Origin` đúng configured public origin; nếu client không gửi Origin, chỉ chấp nhận Referer HTTPS cùng origin, nếu không thì reject.
- Sau login, server sinh random CSRF token tối thiểu 32 bytes, lưu trong server-side session và trả trong JSON của login/session endpoint.
- Frontend giữ CSRF token trong memory, không localStorage/sessionStorage/cookie; gửi `X-CSRF-Token` cho POST/PATCH/DELETE, bao gồm upload ảnh và logout.
- Server so sánh token constant-time. Thiếu/sai token hoặc Origin trả 403 với error chung.
- `GET` phải read-only. Không dùng GET cho logout, reset, activate, delete hoặc mutation khác.
- Regenerate session phải rotate CSRF token. XSS vẫn có thể bypass CSRF, nên P06–P08 vẫn là dependency bắt buộc trước go-live.

## 7. Authentication API

Các business endpoint hiện tại giữ nguyên URL và response ngoài việc bỏ field credential. Auth endpoint mới:

### Master — `/master/auth/*`

| Method/path | Request/response |
|---|---|
| `POST /master/auth/login` | Body `{password}`; thành công 200 `{ok:true, role:'master', csrf_token, expires_at, must_rotate}` + regenerated cookie. |
| `GET /master/auth/session` | 200 cùng session metadata + CSRF token; không auth trả 401. |
| `POST /master/auth/logout` | CSRF required; revoke/destroy Master session, clear Master cookie; idempotent 204. |
| `POST /master/auth/change-password` | `{current_password,new_password}` + CSRF + recent auth; rotate credential/session version, revoke session cũ, issue session mới. |
| `POST /master/gyms/:id/admin-password/reset` | Master + CSRF + recent auth; sinh temporary password một lần, store hash, set `must_rotate=1`, revoke mọi Gym session; response `no-store`. |

### Gym — `/g/:slug/admin/auth/*`

| Method/path | Request/response |
|---|---|
| `POST /auth/login` | Body `{password}`; lookup principal theo resolved gym; thành công 200 `{ok:true, role:'gym', gym:{id,name,slug}, csrf_token, expires_at, must_rotate}`. |
| `GET /auth/session` | Chỉ session role gym có `gym_id` đúng slug; mismatch trả 403, unauthenticated trả 401. |
| `POST /auth/logout` | CSRF required; revoke/destroy Gym session, clear Gym cookie; idempotent 204. |
| `POST /auth/change-password` | `{current_password,new_password}` + CSRF; đổi password, revoke session khác, issue session mới và bỏ `must_rotate`. |

Status contract:

- 400 malformed/policy violation; 401 credential/session không hợp lệ; 403 wrong role/gym hoặc CSRF/Origin; 404 gym/resource không tồn tại; 429 rate limited với `Retry-After`.
- Login failure luôn dùng thông báo chung, không phân biệt principal/password. Không phản chiếu password/header/cookie.
- Auth/reset/session responses có `Cache-Control: no-store`.

### Legacy bridge

- P04 giữ `GET /verify` và custom headers chỉ khi `LEGACY_AUTH_ENABLED=1` được set rõ ràng.
- Bridge verify header password qua Argon2id hash, không còn so plaintext. Login legacy thành công có thể issue session cookie để hỗ trợ rollout, nhưng old frontend vẫn hoạt động khi tiếp tục gửi header.
- Middleware trong P04 ưu tiên valid session; chỉ thử legacy header khi feature flag bật. Ghi metric/counter không chứa credential để biết còn client legacy.
- P05 đổi frontend sang auth API rồi tắt flag trên staging trước, production sau. Sau xác minh, custom headers và `/verify` bị xóa; không duy trì hai auth paths lâu dài.

## 8. Authorization và tenant isolation

### Master

- `requireMasterAdmin` chỉ chấp nhận Master session namespace + role `master`, principal active và session version hiện hành.
- Gym cookie không bao giờ cấp quyền Master, dù request có gym ID/slug hợp lệ.
- Các thao tác reset credential, activate template, delete/restore gym yêu cầu CSRF; reset credential yêu cầu recent authentication trong 10 phút hoặc nhập lại current password.

### Gym Admin

Thứ tự middleware bắt buộc:

1. Resolve `:slug` sang gym chưa soft-delete như hiện tại.
2. Load Gym session.
3. Load principal từ DB, kiểm tra active/version/expiry.
4. Bắt buộc `role='gym'` và `principal.gym_id === req.gym.id`.
5. Với mutation, kiểm tra Origin + CSRF.
6. Business query tiếp tục scope theo `req.gymSeason.id`; không lấy `gym_id`/`gym_season_id` từ body để quyết định tenant.

Gym A gọi URL Gym B bằng session Gym A phải nhận 403 và không được đọc/ghi gì. Gym soft-delete vẫn 404 như baseline. Master không tự động có quyền trên Gym Admin API; nếu cần thao tác thay gym phải dùng endpoint Master chuyên biệt có audit, không giả lập Gym session.

## 9. Rate limiting và chống enumeration

Baseline cho P04/P09:

| Scope | Limit khởi điểm | Hành vi |
|---|---:|---|
| Master login, per IP và principal | 5 lần thất bại / 15 phút | Block 15 phút, tăng dần tối đa 1 giờ; `Retry-After`. |
| Gym login, per IP | 10 lần thất bại / 15 phút | Chặn spray qua nhiều gym. |
| Gym login, per gym principal | 5 lần thất bại / 15 phút | Chặn brute-force targeted; tăng dần tối đa 1 giờ. |
| Authenticated mutation, per session | 120 request / phút | 429, không mutation. Tuning ở P09. |
| Public read, per IP | 300 request / phút | Tuning/load test ở P09/P23. |

- Rate check diễn ra trước Argon2 verify; unknown principal chạy dummy verify khi chưa bị rate limit.
- Success reset principal failure streak nhưng không xóa IP abuse bucket.
- Bucket update là atomic SQLite transaction/upsert; cleanup expired bucket định kỳ.
- Không tin `X-Forwarded-For` cho tới P12 cấu hình explicit `trust proxy` theo reverse proxy cụ thể. Trước đó dùng socket IP; staging phải kiểm tra nhiều client không bị gom thành một IP.
- Không log password, auth header, cookie, raw CSRF/session token hay raw rate-limit HMAC key.

## 10. Password rotation và recovery

- Self-service change luôn yêu cầu current password, CSRF và valid session; tăng `password_version` + `session_version`, revoke session khác và regenerate current session.
- Master reset Gym Admin sinh temporary password bằng CSPRNG, hiển thị đúng một lần, không lưu plaintext, không gửi email tự động, set `must_rotate=1` và revoke toàn bộ Gym session.
- Gym legacy migration `must_rotate=1` chỉ hiện cảnh báo trong grace period; không chặn nghiệp vụ ngay để tránh mất quyền truy cập.
- Master bootstrap/recovery:
  - Nếu chưa có Master principal, production chỉ khởi động khi có one-time `MASTER_ADMIN_BOOTSTRAP_PASSWORD` hoặc legacy `MASTER_ADMIN_CODE` trong migration release.
  - Giá trị được hash trong transaction rồi không dùng cho request auth; operator phải gỡ biến plaintext khỏi deployment secret sau khi xác minh login.
  - Nếu Master mất password, dùng CLI chạy trực tiếp trên server, đọc password ẩn từ TTY/stdin (không command argument), yêu cầu backup trước và revoke toàn bộ Master sessions.
- Không có câu hỏi bảo mật, password hint, password qua URL hoặc reset token dài hạn.

## 11. Migration từ plaintext không khóa admin

### Phase A — P03: additive credential migration

1. Preflight backup/checkpoint DB; đếm gym, kiểm tra mọi gym có exactly one legacy code và không log giá trị.
2. Tạo `auth_principals` idempotently. Chưa sửa/xóa `gyms.admin_code`.
3. Với mỗi gym chưa có principal: hash chính xác legacy code (kể cả dưới policy mới), verify hash vừa tạo, rồi insert principal `must_rotate=1` trong transaction. Có principal rồi thì skip; mismatch role/gym là hard failure.
4. Tạo Master principal từ one-time bootstrap secret. Trong migration release, `MASTER_ADMIN_CODE` được chấp nhận như alias legacy nếu principal chưa tồn tại; fallback công khai bị xóa hoàn toàn.
5. Báo count migrated/skipped/failed, không báo code/hash. Production fail fast nếu không có Master principal và không có bootstrap input.
6. Mọi gym tạo mới trong transition phải đồng thời tạo hash principal; plaintext chỉ được trả một lần cho Master theo legacy UI và không log.

Nếu bất kỳ hash/verify/insert nào lỗi, record đó giữ plaintext và migration dừng rõ ràng; không đánh dấu hoàn tất. Không scrub plaintext ở P03.

### Phase B — P04: session + dual-auth bridge

1. Thêm `auth_sessions`, `auth_rate_limits`, custom SQLite store và auth endpoints.
2. Session path là mặc định. Legacy header chỉ chạy khi explicit `LEGACY_AUTH_ENABLED=1`.
3. Test current Master code và từng Gym code đại diện vẫn login được qua bridge, rồi test session mới.
4. Theo dõi metric legacy requests; không chứa credential hoặc tenant-private data.

### Phase C — P05: frontend cutover và plaintext scrub

1. Frontend login/session/logout/change-password hoạt động trên Master và Gym; không gửi legacy headers.
2. Tắt `LEGACY_AUTH_ENABLED` trên staging; full regression/security tests pass; sau đó tắt ở production.
3. Backup DB. Với mọi gym, xác nhận principal/hash tồn tại và verify migration marker/count.
4. Thay giá trị `gyms.admin_code` bằng tombstone unique không dùng để authenticate, vì schema hiện tại là `NOT NULL UNIQUE`. Không trả field này từ API/snapshot/log.
5. Cột legacy được xóa vật lý bằng migration table rebuild ở P16 hoặc migration sớm hơn đã được rehearsal; không giữ plaintext chờ P16.
6. Gỡ `MASTER_ADMIN_CODE`/bootstrap plaintext khỏi runtime config; giữ chỉ signing/rate-limit secrets trong secret store.

## 12. Thay đổi frontend dự kiến ở P05

- Giữ trang HTML public-load hiện tại nhưng panel admin khóa cho tới khi `GET auth/session` trả 200.
- Login dùng POST JSON; clear input password ngay sau request; không giữ password/session ID trong biến dài hạn, DOM, localStorage hoặc sessionStorage.
- Mọi fetch admin dùng cookie cùng origin và thêm `X-CSRF-Token` cho mutation. Không còn `x-master-admin-code`/`x-admin-code`.
- 401: khóa panel, xóa CSRF token memory, hiện “Phiên đã hết hạn, vui lòng đăng nhập lại”. 403 tenant/CSRF không tự retry mutation.
- Thêm nút logout và đổi password; hiển thị cảnh báo `must_rotate` nhưng grace-period migration không khóa thao tác hiện tại.
- Master và Gym cookie tách biệt nên hai panel vẫn dùng song song.
- Giữ nguyên route HTML `/master`, `/g/:slug`, redirect `/g/:slug/admin → #admin`, layout và toàn bộ business behavior baseline.

## 13. Test bắt buộc

### P03 — hash/schema/migration

- Argon2id hash khác nhau với cùng password do salt; đúng password pass, sai password fail, Unicode/null-byte input được xử lý đúng, malformed PHC fail closed.
- Parameter serialization/parser và `needsRehash`; minimum runtime thiếu `crypto.argon2` fail fast.
- Production thiếu Master principal/bootstrap fail fast, không lộ secret.
- DB trắng, DB legacy nhiều gym, rerun idempotent, partial migration retry, hash failure giữa chừng, duplicate/missing code.
- Mỗi legacy code vẫn verify qua hash; không có password/hash trong log/API.
- New gym transition tạo principal atomically; transaction rollback không tạo orphan gym/principal.

### P04 — session/authz/CSRF/rate limit

- Master/Gym login success/failure, generic 401, dummy verify, session fixation rotation.
- Cookie attributes chính xác ở production và development; hai cookie không ghi đè nhau.
- Idle timeout, absolute timeout, cleanup, revoked/disabled/version mismatch.
- Logout idempotent; password change/reset revoke session cũ; signing-key rotation chấp nhận previous key nhưng ký bằng current key.
- CSRF missing/wrong/correct, Origin/Referer cross-site, raw image upload, mọi POST/PATCH/DELETE.
- Master cookie không vào Gym API; Gym cookie không vào Master API; Gym A không đọc/ghi Gym B; archived/active season isolation; soft-deleted gym 404.
- Rate limit per IP/principal, `Retry-After`, restart persistence, proxy-IP configuration và successful-login reset semantics.
- Legacy flag on/off, header bridge success/failure, no fallback credential, no credential logging.

### P05 — frontend/E2E

- Fresh login, refresh giữ session, logout, idle/absolute expiry, wrong password, must-rotate warning/change.
- Master + Gym simultaneous session; login gym khác có UX rõ ràng.
- Không request nào còn custom legacy auth header; không localStorage/sessionStorage chứa credential/token.
- 401 relock không mất unsaved data ngoài giới hạn đã mô tả; mutation CSRF header đầy đủ.
- Toàn bộ 117 baseline checks (hoặc số mới có giải thích), auth/security regression và route/business invariants pass.

## 14. Rollout và rollback

### Release gates

1. Backup có thể restore trước mọi bước scrub/destructive schema.
2. P03 chỉ additive và phải chứng minh migrated principal count khớp gym count + một Master.
3. P04 deploy với legacy bridge explicit; session metrics/error rate ổn định.
4. P05 staging tắt legacy trước production; xác nhận không còn legacy request trong observation window đã thống nhất.
5. Chỉ scrub plaintext sau khi user duyệt, backup xong và test login/reset cho Master + Gym pass.

### Rollback trước plaintext scrub

- Có thể rollback app về release trước vì `gyms.admin_code` và `MASTER_ADMIN_CODE` vẫn còn; bảng auth additive được để nguyên.
- Revoke session sinh bởi release lỗi; không cần xóa credential hash.
- Không restore DB backup nếu production đã có business writes mới; ưu tiên forward-fix.

### Rollback sau plaintext scrub

- Không rollback về binary header-only ban đầu vì plaintext đã bị loại.
- Giữ một “bridge release” đã kiểm thử: hiểu Argon2id credential và cả session/legacy login nhưng không cần plaintext column. Rollback app chỉ tới bridge release này.
- Nếu auth schema lỗi, deploy forward-fix/bridge, dùng offline Master recovery hoặc Master reset Gym password. Chỉ restore toàn DB khi chấp nhận mất mọi write sau backup và có phê duyệt vận hành rõ ràng.

## 15. Điều kiện phê duyệt thiết kế

P03 chỉ bắt đầu khi người dùng phê duyệt các quyết định sau:

- Argon2id built-in Node 24 với baseline `m=19456, t=2, p=1` và benchmark gate.
- `express-session@1.19.0` + custom better-sqlite3 store, hai cookie Master/Gym.
- Timeout: Master 30 phút idle/8 giờ absolute; Gym 8 giờ idle/24 giờ absolute.
- Dual-auth chỉ trong P04/P05 qua explicit feature flag; plaintext không scrub trước frontend cutover.
- Master-reset-Gym và offline-only Master recovery.
- Sau scrub chỉ rollback tới bridge release, không quay về header/plaintext implementation.

Chưa có code/schema/package/config nào được thay đổi trong P02.

