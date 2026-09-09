# P04 — Backend session và phân quyền

Trạng thái: **DONE — checkpoint backend**, 05/09/2026. Dựa trên AUTH-DESIGN đã duyệt và P03. Không thay frontend, không scrub plaintext, không deploy.

## Kết quả và file

- `auth/backend.js`: hai namespace Master/Gym dùng **express-session 1.19.0**; login/session/logout/change-password và Master reset Gym. Regenerate SID/CSRF sau login/đổi password; current password hoặc recent authentication bảo vệ reset. Principal active, role, gym và session_version được kiểm tra phía server. `must_rotate` là cảnh báo, không khóa nghiệp vụ trong grace period.
- `auth/session-store.js`: custom SQLite Store, chỉ giữ SHA-256 SID, JSON allowlist không có password/hash; get/set/touch/destroy/clearExpired. Master idle 30 phút/absolute 8 giờ; Gym idle 8 giờ/absolute 24 giờ. touch tối đa mỗi 5 phút, deadline server có thể sớm hơn idle từ hoạt động cuối tối đa 5 phút do gộp write. Server luôn có quyền quyết định expiry.
- Logout/revoke giữ tombstone tới deadline thay vì xóa ngay: response đang bay không thể ghi lại SID đã logout. Cleanup lúc startup và mỗi 5 phút; timer unref, có `app.locals.auth.close()` cho shutdown/test. `cleanupFailures` đếm lỗi cleanup, không ghi dữ liệu nhạy cảm.
- `auth/rate-limit.js`: HMAC bucket theo namespace/socket IP và principal; reserve atomically trước Argon2 để giới hạn request đồng thời. Master 5/IP và 5/principal, Gym 10/IP và 5/principal trong 15 phút; block lặp 15/30/60 phút, Retry-After. Success reset bucket principal, giữ các failure IP; IP reservation thành công được trừ lại. State SQLite tồn tại sau restart. P09 tiếp tục public/mutation limits.
- `db/auth-schema.sql`, `auth/migrate.js`: bổ sung `block_count` additive/idempotent cho DB P03, bảo toàn credential/business data.
- `server.js`, `routes/master.js`, `routes/gym-admin.js`: auth guard đứng trước toàn bộ business API, bao gồm raw upload. Giữ HTML `/master` và redirect `/g/:slug/admin`; Gym vẫn scope resource theo active gym_season_id. Auth payload giới hạn 8 KiB, response no-store, lỗi JSON chung không lộ exception/input.
- `scripts/recover-master.js`: offline recovery nhận password qua stdin pipe, không argv/TTY echo. Backup bắt buộc trước write, tăng version và revoke mọi Master session; đặt must_rotate=1.
- `auth/config.js`, `.env.example`, `package.json`, `package-lock.json`: cấu hình origin/secrets/legacy bridge và dependency/scripts.
- Tests: `test/session-test.js`, cập nhật P03 tests và smoke tests cho status 401, hash principal và Origin.

## API

| Prefix | Endpoint |
|---|---|
| `/master` | POST `/auth/login`, GET `/auth/session`, POST `/auth/logout`, POST `/auth/change-password` |
| `/g/:slug/admin` | Cùng bốn endpoint auth; Gym phải chưa soft-delete |
| `/master` | POST `/gyms/:id/admin-password/reset` — session Master + CSRF + recent auth 10 phút hoặc current_password |

Login body `{password}`; change-password `{current_password,new_password}`. Login/session/change response có role, csrf_token, expires_at, must_rotate và Gym metadata khi phù hợp. Reset trả temporary_password đúng một lần, không ghi plaintext. Login sai credential hoặc principal không có dùng lỗi 401 chung; known gym thiếu principal chạy dummy Argon2 cùng cost. Gym không tồn tại/soft-delete vẫn 404 theo contract resolver.

Mutation bằng cookie luôn cần Origin đúng (hoặc HTTPS Referer đúng ở production) và X-CSRF-Token của session. Login chỉ yêu cầu same-origin, chưa có token. Logout có session cần CSRF; logout khi session đã hết hạn/đã logout trả 204 idempotent sau Origin check. Sai gym/session hợp lệ trả 403; thiếu credential/session hợp lệ trả 401. Không có route GET logout/reset/change.

## Cấu hình và chạy

1. Node 24.19.0, cài dependency theo lockfile. Trong môi trường Windows này dùng `npm install --save-exact express-session@1.19.0 --ignore-scripts --cache ./tmp/npm-cache` để dùng native binary better-sqlite3 đã có; không đổi version hashing/runtime.
2. Trên DB chưa migrate, làm đúng runbook P03 với backup và `npm run auth:migrate` offline trước rollout. Không tự hash từ environment mỗi lần request/startup.
3. Production bắt buộc SESSION_SECRETS (current key trước, old key phía sau; mỗi key >=32 bytes), AUTH_RATE_LIMIT_SECRET độc lập >=32 bytes và PUBLIC_ORIGIN là exact HTTPS origin không slash cuối. Có Master principal rồi thì bỏ MASTER_ADMIN_CODE/bootstrap khỏi runtime được; chúng chỉ dùng cho migration.
4. Development có thể để secrets rỗng: sinh CSPRNG keys trong memory, restart làm cookie cũ hết hiệu lực. Muốn test restart/key rotation, cấu hình key cố định qua secret store. Local HTTP cookie tên `gvg_master_session`/`gvg_gym_session`; production tên `__Host-gvg_master_session`/`__Host-gvg_gym_session`, Secure/HttpOnly/SameSite=Lax/Path=/, không Domain, Priority=High.
5. `npm start`. Production từ chối login qua HTTP không secure. Chưa bật trust proxy hoặc tin X-Forwarded-*; HTTPS/reverse proxy thật cần cấu hình rõ ở P12. P04 không phải checkpoint public deployment.
6. `npm run test:auth`; regression legacy: `node test/master-routes-smoke-test.js`.

Đổi signing key bằng SESSION_SECRETS=current,previous: chấp nhận chữ ký cũ nhưng response ký key mới. Gỡ previous sau observation/expiry window; không dùng chung key rate-limit. `auth/session-library.js` vô hiệu hóa namespace debug của upstream trước khi load vì nó có thể in SID/cookie, kể cả DEBUG=*; code không log auth headers/cookie/password/hash/CSRF.

## Bridge phải xóa ở P05

> Cập nhật P05: bridge đã được gỡ khỏi code sau kiểm thử browser/session. Phần dưới ghi lại trạng thái release P04; xem [P05 checkpoint](P05-CHECKPOINT.md) để vận hành code hiện tại.

- Mặc định **OFF**. Với frontend hiện tại phải set rõ `LEGACY_AUTH_ENABLED=1` ở P04 rollout. `/verify` và custom header chỉ chạy khi flag bật; verify hash principal, không đọc gyms.admin_code hay MASTER_ADMIN_CODE để xác thực.
- Bridge không phát hành cookie để frontend cũ không vô tình đi vào đường cookie đòi CSRF. Unsafe legacy requests cần Origin/Referer hợp lệ và custom credential header, không yêu cầu synchronizer token khi chưa có session. Đây là ngoại lệ transition cần thiết của header auth; không phải đường bỏ qua CSRF bằng cookie.
- Session hợp lệ luôn ưu tiên: kể cả gửi legacy header đúng vẫn phải có CSRF; session Gym A không được chuyển sang Gym B bằng header. Test frontend cũ và auth API mới trong browser profile riêng nếu cần tránh trộn cookie session với frontend chưa biết token.
- `app.locals.auth.metrics.legacyAccepted` là bộ đếm không chứa credential, chỉ trong process; monitoring lâu dài thuộc P20.
- P05 chuyển frontend sang cookie + CSRF, tắt bridge trên staging, kiểm thử rồi mới scrub plaintext theo phê duyệt. Chưa xóa field legacy khỏi DB. Khi password được đổi/reset, plaintext cũ không còn dùng login được và không được dùng làm nguồn ghi đè hash.

## Recovery và rollback

Recovery: dừng writer; đặt DB_PATH và AUTH_RECOVERY_BACKUP_PATH tới file backup mới ngoài public; cấp **raw UTF-8 bytes** password qua stdin từ secret manager vào `npm run auth:recover-master`. Không thêm newline ngoài password mong muốn, không đặt password trong command argument. Policy 12 Unicode characters/256 bytes. Sai cấu hình/policy/backup trả lỗi chung exit 1. Backup dùng SQLite API và chứa credential cũ, cần quyền truy cập riêng.

Rollback code giữ nguyên DB mới, không restore lên business writes mới. **Sau lần đổi/reset password đầu tiên, không quay về binary P03/header plaintext** vì credential cũ có thể cấp lại quyền; giữ release bridge hiểu hash (P04) để forward-fix/rollback. Có thể tắt session UI thử nghiệm và dùng bridge với password hiện hành. Revoke bằng tăng session_version/marker hoặc recovery offline nếu Master mất quyền. Không scrub trong P04.

## Bằng chứng và phần còn lại

- `npm run test:auth`: **24 PASS / 0 FAIL** (8 nhóm P03 + 16 nhóm P04). P03 hash/migration/config cùng P04 sessions, CSRF, tenant, cookie/key rotation, expiry/revoke, limiter/concurrency/escalation, recovery, empty development secrets, production origin và unknown principal.
- `node test/master-routes-smoke-test.js`: **50 PASS / 0 FAIL**, giữ business behavior frontend header hiện tại, bổ sung Origin và principal fixture. Không chạy lại frontend suite vì không sửa frontend.
- Cookie Secure được kiểm tra bằng harness đánh dấu request đã qua TLS termination; **chưa** kiểm thử TLS/certificate/proxy/domain thật. Staging load benchmark Argon2, proxy IP và browser integration P05/P12/P22 vẫn là gate.
- P03 chỉ có một policy Argon2 allowlist đang phát hành, chưa có hash policy cũ hợp lệ cần rehash; không nhận cost tùy ý. Phiên bản/hash thay đổi được revoke qua session_version.
- P04 không sửa XSS, public validation, public/mutation rate limits, deployment hoặc frontend. Trạng thái go-live vẫn NO-GO.

Tham chiếu: [Express session documentation](https://expressjs.com/en/resources/middleware/session/).

Commit đề xuất: `feat(auth): implement P04 SQLite sessions, CSRF and tenant authorization`


