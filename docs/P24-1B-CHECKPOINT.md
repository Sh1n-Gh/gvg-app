# P24.1b — Legacy admin_code scrub

**DONE (script + tests + clone rehearsal), 09/09/2026. C-01 scrub rollout vẫn OPEN; NO-GO không đổi.** Không apply DB thật, không làm P24.1c, không commit.

## Điều kiện và thiết kế

- Trước khi sửa đã xác nhận P24.1a **DONE** trong `PRODUCTION-GO-LIVE-PROMPTS.md` và `PRODUCTION-READINESS.md`; working tree sạch.
- File prompts lúc bắt đầu chưa có section P15-C1c. Đã đọc task P15-C1c trong bảng readiness và thiết kế Phase C / rollback trong `AUTH-DESIGN.md` (§11, §13–14); bổ sung cross-reference vào prompts, không tự coi rollout đã được duyệt.
- Giữ `gyms.admin_code` vì schema `NOT NULL UNIQUE`; thay bằng tombstone `disabled:` + 32 random bytes độc lập. Không table rebuild, không thay checksum migration cũ. Đây là data migration offline, không chạy khi server khởi động.

## Thay đổi

| File | Nội dung |
|---|---|
| `auth/scrub.js` | Preflight schema/principal; temporary password CSPRNG 32 bytes; Argon2id `m=19456,t=2,p=1`; handoff mã hóa; transaction scrub, version bump, revoke; quét tất cả cột; no-op idempotent |
| `scripts/rehearse-auth-scrub.js` | CLI **clone-only**, không đọc `.env`, không dùng `DB_PATH`, không có default DB hay flag live apply; chỉ mở file clone mới bằng SQLite |
| `auth/config.js`, `.env.example` | Bỏ runtime fallback cho `MASTER_ADMIN_CODE` / `MASTER_ADMIN_BOOTSTRAP_PASSWORD`; production bắt buộc có Master principal active, provision offline |
| `auth/migrate.js` | Chặn additive migration tạo principal bằng tombstone nếu principal bị thiếu; không biến tombstone thành password |
| `test/auth-scrub-test.js` | 7 test scrub/CLI/HTTP/rollback/crash/scan/preflight trên file clone |
| `test/auth-test.js`, `test/session-test.js` | Fixture/assertions theo yêu cầu Master principal thực sự; kiểm tra runtime không cần bootstrap |

Không có plaintext fallback trong login hoặc startup migration cần gỡ thêm: login đã chỉ dùng `auth_principals.password_hash`; legacy headers đã bị bỏ từ P05. Giữ **offline** `scripts/migrate-auth.js` / `migrateCredentials` để chuẩn bị DB legacy chưa có principal; đó không phải runtime fallback, không scrub, và cần backup. Master bootstrap input chỉ được đọc tại công cụ offline này.

## Atomicity, idempotence và bàn giao

1. Yêu cầu schema hiện hành, mọi gym (kể cả soft-deleted) có principal/hash hợp lệ và Master active để recovery. Gym tombstone có hash chấp nhận chính tombstone sẽ bị từ chối, không bị tính nhầm là đã sạch.
2. Chỉ gym chưa có tombstone được sinh password mới và hash/verify. Gym tạo bằng P24.1a hoặc đã scrub giữ nguyên hash, version và session. Disabled principal vẫn disabled; gym deleted vẫn không đăng nhập HTTP được.
3. **Trước DB writes**, ghi handoff AES-256-GCM vào file mới (`wx`, mode `0600`) rồi `fsync`. Key 32 bytes do operator cung cấp; password không đi ra stdout/log và không được lưu plaintext trong DB. Handoff mã hóa gồm gym ID, slug, password tạm và hash để đối chiếu lần chạy.
4. Một `BEGIN IMMEDIATE` cho toàn bộ gym: đối chiếu snapshot sau async hashing; thay hash, `must_rotate=1`, tăng password/session version, revoke session cũ, ghi tombstone. Không có await giữa transaction. Nếu lỗi bất kỳ gym hoặc quét còn plaintext, rollback **toàn bộ**.
5. Quét mọi bảng/cột lưu trữ, gồm TEXT/JSON/BLOB, tìm byte sequence của toàn bộ password cũ và password tạm mới. Nếu có bản sao trong trường nghiệp vụ thì dừng/rollback, không tự xóa nội dung đó. Mật khẩu legacy quá ngắn có thể tạo match trùng dữ liệu vô hại: cần xử lý offline riêng, không bỏ qua scan. Scan chứng minh các credential đã biết không còn trong các cột; không phải bộ phát hiện mọi loại secret chưa biết/đã encode.
6. Lần hai trả `changed:false`, `scrubbed:0`; không sinh/hash password mới, không ghi lại handoff, không đổi dữ liệu hay bytes DB. Handoff từ lần thành công vẫn còn.
7. Ngắt trước commit: SQLite rollback toàn bộ, credential/session trước scrub vẫn dùng được; handoff đã tạo có thể là bản **chưa commit**, phải đối chiếu `passwordHash` với DB. Retry với filename handoff mới, không overwrite. Ngắt ngay sau commit: handoff đã được flush trước đó nên có thể khôi phục password; chạy lại là no-op. Không tự xóa handoff khi kết quả commit chưa rõ.

**Bàn giao cho gym admin:** operator giữ key và handoff ngoài web root/repo, trong vùng có ACL riêng (mode Unix không bảo đảm ACL Windows; phải kiểm tra quyền thực tế khi rollout). Giữ key tách biệt handoff. Dùng `readHandoff(path,key)` trong công cụ offline có kiểm soát, đối chiếu hash trong DB, bàn giao thủ công qua kênh riêng sau xác minh người nhận. Không gửi email/message tự động; chưa có hệ thống email. Admin đăng nhập và đổi password qua flow hiện có. `must_rotate=1` là cảnh báo/grace period hiện hữu, không phải bắt buộc chặn mọi thao tác. Nếu mất key/handoff, Master reset password gym rồi bàn giao thủ công; không bật lại plaintext fallback.

## Kết quả kiểm thử

`node --test test/auth-scrub-test.js test/auth-test.js test/session-test.js test/request-security-test.js`

**38 PASS / 1 FAIL / 0 skip (39 tests)**. Toàn bộ **7 test P24.1b PASS**, cùng các test P24.1a và auth/session/request-security liên quan. FAIL duy nhất là `test/auth-test.js` → `CLI migration and production HTTP checkpoint work with explicit configuration`: fixture P15-Q1 đã biết (PORT=0, thiếu TRUST_PROXY, chờ log cũ), cũng đã FAIL trước task; không sửa ngoài phạm vi. Không chạy full regression/P24.1c. Log: `tmp/p24-1b/tests.txt`.

`node --test test/deployment-test.js`: **3 PASS / 0 FAIL / 0 skip**, xác minh cấu hình deployment liên quan việc gỡ runtime fallback. Log: `tmp/p24-1b/deployment-tests.txt`. `git diff --check`: PASS.

Test mới xác minh:

- Clone file có 3 gym legacy (1 soft-deleted) + 1 gym P24.1a: trước 3, sau 0. Hash đúng Argon2id; temporary login HTTP PASS cho gym active; old password/tombstone bị từ chối; gym deleted vẫn 404.
- Quét tất cả cột với password cũ/mới không có match; CLI clone sau secure-delete/VACUUM không còn chuỗi password cũ/mới trong bytes file. Gym P24.1a không đổi.
- Change-password, Master login/reset, login sau reset PASS; old gym session bị revoke, Master session giữ nguyên; source checksum không đổi.
- Lần hai không đổi rows, bytes file và handoff, không gọi hash generation.
- Exception sau gym đầu tiên rollback; hash failure và handoff file đã tồn tại không gây partial writes; conflict trong lúc hashing bị từ chối.
- Tiến trình con `process.exit` sau write gym đầu tiên (không close DB) → reopen phục hồi nguyên vẹn. Tiến trình dừng sau commit → mọi password khôi phục được từ handoff; retry no-op.
- Backup pre-scrub được copy/restore vào file mới và so sánh nguyên trạng; không restore đè nguồn. JSON/BLOB chứa bản sao password khiến scan fail và rollback. Thiếu principal hoặc tombstone có thể authenticate đều bị chặn.
- CLI thật chạy thành công trên clone; từ chối target đã tồn tại (kể cả source) và nguồn có WAL chưa checkpoint.

## Rehearsal DB có sẵn

Không có `db/gvg.db` trong workspace. Dùng **bản sao của `test/test.db`**, không giả định đó là production DB. Nguồn có WAL và schema legacy, nên copy bytes **DB + WAL** sang `tmp/p24-1b/prepared-copy.db`, không copy SHM; kiểm tra digest trước/sau copy, mở SQLite **chỉ trên copy**, integrity check PASS. Additive schema/auth preparation chỉ trên copy: 4 principal được tạo (3 gym + Master rehearsal), backup riêng. Đóng copy để checkpoint rồi chạy CLI helper tạo `scrubbed-clone.db` mới. CLI từ chối WAL nguồn, không tự checkpoint nguồn.

| Kiểm tra trên clone hiện có | Kết quả |
|---|---|
| Gym còn plaintext trước scrub | **3** |
| Gym scrub / plaintext còn lại | **3 / 0** |
| Match password cũ/mới trong mọi cột sau scrub | **0** |
| Đăng nhập HTTP bằng password tạm mới | **3/3 PASS** |
| Lần hai | **0 thay đổi, không lỗi** |
| Ngắt sau gym đầu tiên trên rollback clone riêng | **PASS, hash và plaintext cũ nguyên trạng** |
| DB nguồn và WAL nguồn | **SHA-256 trước/sau không đổi** |

Digest DB nguồn: `bbcc6590a64b25e6fcca0820aedd63c8c9916ee30d81f89cb88339823b9ede63`.

Digest WAL nguồn: `ba2485535c4c801622112b66f5e593561b868efd166094bc8913764fdfd414fb`.

Kết quả không chứa password/key: `docs/P24-1B-RESULTS.json`; log và clone local nằm trong `tmp/p24-1b/` (Git ignored). Key/handoff cùng thư mục ở rehearsal chỉ chứa credential của clone test; đây không phải bố trí secret được duyệt cho rollout thật.

## Rollout còn OPEN — không thực hiện trong task

Lệnh rehearsal trên **bản copy offline đã checkpoint**, với key file raw 32 bytes được cấp riêng:

```text
node scripts/rehearse-auth-scrub.js SOURCE_COPY.db NEW_CLONE.db NEW_HANDOFF.json KEY_FILE
```

CLI này luôn copy sang target mới và scrub target; **không có live apply command**. Việc áp dụng thật cần người dùng phê duyệt tường minh sau báo cáo và một rollout riêng: chốt maintenance window/dừng writers; backup nhất quán có restore drill; chuẩn bị Master recovery và ACL/key/handoff; xác minh DB/version/count; thực hiện migration đã được duyệt; kiểm tra login/reset/revoke, count/scan; bàn giao thủ công; quyết định resume.

`secure_delete=ON` áp dụng khi ghi; rehearsal dùng journal DELETE và VACUUM sau commit. Scrub logical không xóa plaintext trong backup cũ, WAL/journal đã có trước migration, snapshot filesystem hay bản sao bên ngoài. Rollout phải có checkpoint/truncate và kế hoạch retention/purge được duyệt cho các bản cũ, sau khi đã bảo đảm recovery. Không tự xóa backup trong task. Nếu cleanup sau commit lỗi, credentials đã đổi vẫn có handoff; giữ offline, sửa cleanup và scan lại, không coi là rollback transaction.

Sau scrub chỉ rollback app tới phiên bản hiểu Argon2id/session, không về header/plaintext. Restore toàn DB chỉ vào đường dẫn mới và chỉ chuyển sang bản restore khi được phê duyệt, tính tới business writes sau backup; ưu tiên forward-fix/Master reset. C-01 vẫn **OPEN** cho đến khi live apply và xác minh hoàn tất. Các gate NO-GO/regression khác không được đóng bằng rehearsal này.

Commit message đề xuất: `security(auth): rehearse atomic legacy credential scrub on database clones`.
