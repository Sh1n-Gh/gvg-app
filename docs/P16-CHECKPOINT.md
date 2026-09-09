# P16 — Migration framework

Ngày thực hiện: 08/09/2026. Trạng thái: DONE trong phạm vi framework; không phải phê duyệt go-live.

## Đã hoàn thành

- Ledger version liên tiếp, SHA-256 checksum, timestamp, applied/adopted và backup reference.
- Baseline nghiệp vụ/auth nhận diện DB legacy đầy đủ, bảo toàn dữ liệu và sequence; hỗ trợ auth trước/sau block_count. Không chạy lại schema.sql ở runtime.
- Toàn bộ pending batch và ledger trong transaction IMMEDIATE, rollback DDL/DML/ledger khi lỗi; history được kiểm tra lại dưới write lock.
- Dry-run read-only với snapshot RAM hỗ trợ WAL, integrity/foreign-key checks và thực thi thử migration; không gọi backup hook.
- Production startup chỉ kiểm tra version/checksum, không tạo/migrate DB. CLI explicit DB_PATH, --init, hook async bắt buộc khi còn pending; auth credential migration tách riêng.
- [MIGRATIONS.md](MIGRATIONS.md) mô tả contract backup P17, tạo migration, maintenance window, rollback/forward-fix và giới hạn.

## File thay đổi

Thêm `db/migrations.js`, `db/migrations/001-core.sql`, `db/migrations/002-auth.sql`, `scripts/migrate-db.js`, `test/migrations-test.js`, `docs/MIGRATIONS.md`, checkpoint này. Sửa `db/index.js`, `auth/migrate.js`, `scripts/migrate-auth.js`, `server.js`, `package.json`, hai schema reference (chỉ comment), fixture `test/auth-test.js`, `.env.example`, `docs/DEPLOYMENT.md`, `docs/PRODUCTION-READINESS.md` và bảng P16.

Working tree ban đầu toàn bộ source là untracked; không commit, không ghi đè thay đổi không liên quan. Không mở hoặc chạy migration trên DB thật. Test chỉ dùng memory và DB fixture.

## Kiểm thử cuối

| Lệnh/nhóm | PASS | FAIL | Ghi chú |
|---|---:|---:|---|
| `npm run test:p16`: migrations | 11 | 0 | DB trắng/core legacy/auth cũ/auth hiện tại, lặp, drift/checksum/gap, preflight, WAL, backup gate, rollback batch thực tế sau preflight |
| `npm run test:p16`: auth + session | 23 | 1 | Schema CLI và credential CLI thành công; fixture startup P15-Q1 vẫn lỗi |
| `node test/engine-test.js` | 32 | 0 | Regression nghiệp vụ |
| `node test/master-routes-smoke-test.js` | 50 | 0 | Regression API/auth |
| **Tổng không đếm lặp** | **116** | **1** | 0 skip; không chạy toàn suite vì P16 không phải checkpoint audit |

`npm run test:p16` exit 1: test `CLI migration and production HTTP checkpoint work with explicit configuration` dừng ở startup; nguyên nhân đã ghi P15-Q1: config PORT=0 và thiếu TRUST_PROXY không đáp ứng P12. Chỉ cập nhật fixture schema migration trước credential/startup theo P16; không sửa cấu hình deployment test ngoài phạm vi. Không che lỗi bằng skip hoặc đổi assertion. Bản chạy đầu phát hiện lỗi snapshot WAL, đã sửa và thêm regression riêng; các test WAL/backup auth hiện PASS.

## Giới hạn và bước tiếp theo

Backup hook là interface, chưa có provider backup/restore P17; production pending migration bị chặn khi thiếu provider. Dry-run dùng RAM theo kích thước DB, không chứng minh quyền ghi/disk/lock lúc apply. Maintenance window phải dừng mọi writer trước backup; chưa triển khai điều phối release P21. Baseline so định nghĩa nghiêm ngặt có thể từ chối schema tương đương nhưng cách viết khác, cần review offline.

P10/P15 và P15-Q1 còn nguyên trạng thái; không kết luận production/staging GO. Dừng sau P16; P17 chỉ thực hiện khi được yêu cầu. Commit đề xuất: `feat(db): add versioned SQLite migrations and production backup gate`.
