# P03 — Credential/schema checkpoint

Trạng thái: **DONE**, 05/09/2026. Thiết kế AUTH được người dùng xác nhận đã duyệt trong yêu cầu triển khai. Chưa triển khai P04/P05, chưa đủ điều kiện go-live.

## Thay đổi

- `auth/password.js`: async Argon2id qua Node crypto, salt 16 bytes, tag 32 bytes, m=19456/t=2/p=1, PHC strict/canonical, constant-time comparison. Password mới có 12 Unicode code points trở lên và tối đa 256 UTF-8 bytes, không trim/normalize. Legacy được hash nguyên trạng, kể cả ngắn hoặc dài hơn policy mới; chuỗi rỗng/Unicode hỏng bị từ chối.
- Chỉ một policy được allowlist tại P03. `needsRehash` trả false cho policy hiện tại, true cho hash không hỗ trợ; verify từ chối hash đó. Chưa có policy cũ được phát hành nên không tự nhận cost yếu tùy ý. Rehash sau login/dummy verify thuộc P04.
- `db/auth-schema.sql`: principals, sessions và rate-limit schema/index additive; chưa có session store/middleware. Bật foreign keys cho connection ứng dụng.
- `auth/migrate.js`, `scripts/migrate-auth.js`: preflight, SQLite online backup (bao gồm WAL), hash + verify trước transaction, insert tất cả credential còn thiếu trong một transaction, kiểm tra count gym + một Master. Kiểm tra lại source sau async hash để không ghi migration dựa trên dữ liệu đã thay đổi. Rerun bỏ qua principal đã có; không reset password đã đổi.
- Gym mới tạo principal trong cùng transaction với gym/gym_season. Lỗi insert rollback toàn bộ; mã chỉ trả một lần lúc tạo, response no-store. Danh sách gym không còn trả admin_code/hash.
- Không có credential mặc định. Thiếu MASTER_ADMIN_CODE trong development thì mọi Master header bị từ chối. Production kiểm tra runtime, signing keys, rate-limit key và Master config trước listen, yêu cầu migration đầy đủ.

## Chạy migration trên bản sao/staging

1. Dùng Node **24.19.0** (`.node-version`; engines >=24.7.0 <25). Dừng app/writer trước migration. Không chạy đồng thời nhiều runner.
2. Cài dependency bằng `npm ci`. Trên máy Windows checkpoint này, lifecycle build của npm yêu cầu C++ toolchain không có; `npm ci --ignore-scripts` dùng được binary đóng gói sẵn của better-sqlite3 13.0.3. Đã kiểm chứng bằng integration SQLite thật. Không thay dependency version; production cần kiểm chứng clean install trên runtime đích.
3. Cấu hình DB_PATH và AUTH_MIGRATION_BACKUP_PATH trỏ tới file backup mới trong thư mục riêng có sẵn, ngoài public/. Hạn chế quyền đọc backup vì còn plaintext. Runner không ghi đè backup cũ.
4. Cấp MASTER_ADMIN_CODE hiện tại qua secret store. Nếu bootstrap mới, có thể dùng MASTER_ADMIN_BOOTSTRAP_PASSWORD đạt policy. Nếu hai input khác nhau, P03 header vẫn dùng MASTER_ADMIN_CODE còn hash Master dùng bootstrap; operator phải biết password sẽ dùng ở P04. Không truyền password trên command line.
5. Chạy `npm run auth:migrate`. Chỉ in migrated/skipped/failed khi thành công; lỗi in thông báo cố định và exit 1, không in credential/SQL exception. Khi lỗi, giữ plaintext và các principal đã có; toàn bộ batch insert mới rollback. Sửa nguyên nhân offline rồi retry với tên backup mới.
6. Production cấp SESSION_SECRETS (các key phân cách dấu phẩy, mỗi key >=32 bytes) và AUTH_RATE_LIMIT_SECRET độc lập >=32 bytes. Dùng secret ngẫu nhiên từ secret store. Signing/rate-limit logic chỉ được sử dụng ở P04.
7. Chạy `npm start`; production từ chối mở cổng nếu còn gym thiếu principal hoặc chưa có Master active. Test header Master/Gym cũ trên bản sao trước rollout.

P03 cố ý còn yêu cầu MASTER_ADMIN_CODE cho request header ngay cả khi đã có principal; **chưa gỡ biến này** cho tới P04/P05. Bootstrap-only không đủ để chạy frontend P03. Đây là gate bảo toàn truy cập của release header-only, không phải fallback. Không scrub gyms.admin_code ở bước này. Không migrate database thật trong task này.

## Rollback

- Trước scrub: quay lại bản app trước P03, giữ nguyên bảng auth additive và legacy code/config. Không drop bảng, không restore cả DB lên dữ liệu business mới. Repository hiện chưa có commit gốc; operator phải lưu artifact app cũ trước rollout.
- Migration lỗi không cần restore: transaction đã rollback credential mới, dữ liệu plaintext vẫn nguyên vẹn. Partial migration từ lần trước được skip và có thể retry.
- Backup đã thử mở như DB độc lập, integrity_check=ok và code cũ còn nguyên. Nếu cần restore, dùng đường dẫn DB mới, kiểm tra dữ liệu rồi mới đổi DB_PATH; không ghi đè DB đang chạy.
- P03 không phát hành session nên không có session mới để revoke. Sau P04 phải revoke session của release lỗi. Sau scrub P05 chỉ rollback tới bridge release theo AUTH-DESIGN, không quay về binary plaintext.

## Kiểm thử và giới hạn

- `npm test`: 32 engine + 50 API smoke + 39 frontend checks pass; 6 nhóm auth ban đầu pass. Sau khi bổ sung kiểm thử process startup và CLI migration/startup production: `node --test test/auth-test.js` **8/8 pass** (tổng hiện tại 129 checks/groups). API smoke được chạy lại sau thay đổi cuối: 50/50 pass.
- Auth tests: salt, đúng/sai password, Unicode/null byte, parser/cost sai, runtime gate, DB trắng, legacy nhiều gym/soft-delete, rerun, partial retry, hash failure, insert failure, missing/duplicate code, backup restore, config và process production thiếu secret không listen/không lộ input.
- API tests: principal tạo cùng gym, hash verify mã trả lần đầu, no-store, list không trả credential, insert principal thất bại không tạo gym mồ côi; các luồng header/frontend cũ vẫn pass.
- Chưa làm login/session/logout/CSRF/rate-limit enforcement, frontend, scrub hay recovery CLI (khôi phục P03 bằng rollback plaintext; recovery hash thuộc bước auth tiếp theo). Argon2 load benchmark staging vẫn là gate trước production.
- npm báo 3 moderate dependency advisories khi cài; không tự nâng dependency trong P03, giữ việc phân loại ở P19.

Tham chiếu API đã kiểm tra: [Node.js crypto.argon2](https://nodejs.org/api/crypto.html#cryptoargon2algorithm-parameters-callback).

Commit đề xuất: `feat(auth): add P03 password hashing and additive credential migration`

