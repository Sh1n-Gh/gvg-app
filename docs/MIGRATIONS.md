# Versioned SQLite migrations (P16)

P21: production runner khóa canonical DB path từ trước preflight/backup đến hết
transaction; crash để lại khóa và chặn retry. Quy trình mở khóa, rollback code và
restore schema không tương thích tại [RELEASE-RUNBOOK.md](RELEASE-RUNBOOK.md).

`db/schema.sql` và `db/auth-schema.sql` chỉ còn là reference/fixture legacy. Runtime đọc manifest `db/migrations.js` và SQL bất biến trong `db/migrations/`. Không chạy hai file reference lên production.

## Lịch sử và baseline

`schema_migrations` lưu version liên tiếp, name, SHA-256 checksum (SQL chuẩn hóa CRLF thành LF và metadata manifest), applied_at UTC, mode `applied`/`adopted`, backup_ref. Không lưu credential hoặc nội dung backup. Version lạ, khoảng trống hoặc checksum sai chặn runner và startup production.

- 001: schema nghiệp vụ hiện tại.
- 002: schema auth trước cột block_count.
- 003: bổ sung block_count; nhận diện cột đã có ở P04.

DB trắng tạo schema. DB legacy đầy đủ được đối chiếu định nghĩa table/index, gồm constraint/default, trước khi ghi baseline; không chạy lại DDL lên các bảng đã có. Chấp nhận auth trước/sau block_count và DB chỉ có nghiệp vụ. Baseline thiếu một phần hoặc khác định nghĩa bị từ chối; không tự sửa/xóa dữ liệu. Định nghĩa tương đương nhưng khác cách viết có thể bị từ chối: đối chiếu offline rồi viết bước reconciliation được review, không giả mạo ledger.

Mỗi batch pending nằm trong một `BEGIN IMMEDIATE`; schema, dữ liệu và ledger commit cùng nhau. Lỗi version sau rollback cả các version trước trong batch đó. Runner từ chối transaction ngoài, SQL điều khiển transaction, VACUUM, PRAGMA, ATTACH/DETACH; các thay đổi cần thao tác không transactional phải có runbook riêng, không đánh dấu thành công bằng framework này. Migration SQL hiện không hỗ trợ trigger có BEGIN/END. SQLite write lock tuần tự hóa execution và history được đọc lại sau khi lấy lock; chạy offline một runner để giữ backup đúng thời điểm.

## Preflight và chạy offline

PowerShell, thay đường dẫn bằng DB được chỉ định rõ:

```powershell
$env:DB_PATH = 'D:\private\gvg.db'
$env:NODE_ENV = 'production'
npm run db:preflight
$env:MIGRATION_BACKUP_HOOK = 'D:\private\migration-backup-hook.cjs'
npm run db:migrate
npm run auth:migrate
npm start
```

DB_PATH bắt buộc tuyệt đối trong CLI. File không tồn tại bị từ chối; `npm run db:preflight -- --init` xem kế hoạch DB trắng mà không tạo file, `npm run db:migrate -- --init` chỉ dùng khi chủ ý tạo DB mới. Khởi động production không tạo DB và không chạy migration, chỉ xác minh ledger. Development/test tự chạy framework khi mở DB.

Preflight mở DB hiện có read-only, kiểm tra quick_check/foreign_key_check, ledger/checksum và chạy thử toàn bộ pending trên snapshot RAM. Snapshot bao gồm dữ liệu WAL; chỉ bản sao được đổi header journal sang rollback format. Không thay dữ liệu/schema/ledger nguồn. SQLite có thể cần truy cập sidecar WAL/SHM khi đọc DB WAL; không dùng immutable mode bỏ qua WAL. Dry-run không gọi backup hook. Cần RAM cho toàn DB và bản migration; DB lớn cần rehearsal trên môi trường đủ bộ nhớ. Preflight không chứng minh đủ disk/quyền ghi/khả năng lấy lock khi chạy thật.

Dừng service và mọi writer từ trước backup đến khi migration xong. Preflight không thay thế maintenance window. Sao lưu trước migration schema rồi chạy credential migration riêng theo runbook auth; credential migration vẫn có gate backup vốn có. Khi mọi version đã áp dụng, không gọi lại hook và không thêm ledger.

## Interface backup bắt buộc

P17 đã cung cấp `scripts/sqlite-backup.js`: đặt MIGRATION_BACKUP_HOOK tới đường dẫn tuyệt đối của module này, cấu hình BACKUP_DIR và BACKUP_RETENTION_DAYS. Xem [BACKUP-RESTORE.md](BACKUP-RESTORE.md). Contract dưới đây minh họa interface, không dùng stub làm provider:

```js
exports.beforeMigrate = async ({ databasePath, plan }) => {
  // Thực hiện/kiểm chứng backup SQLite nhất quán, bao gồm WAL.
  // Chỉ trả success sau khi backup hoàn tất; throw khi lỗi.
  // return { ok: true, reference: 'opaque-backup-receipt-id' };
  throw new Error('Backup provider must be implemented before production migration');
};
```

Runner await hook trước mọi thay đổi schema/ledger. Thiếu hook, throw, ok khác true hoặc reference rỗng/quá 512 ký tự đều chặn migration. Reference không chứa secret. Đây là hợp đồng tin cậy với provider, không phải xác minh file backup/restore của runner. Không dùng stub `{ok:true}` trong production. Với `--init`, file SQLite rỗng có thể đã được mở/tạo trước hook; hook phải xử lý cả DB mới. Không dùng hook để thay schema hoặc ghi nghiệp vụ. Giữ code hook ngoài public, quyền sửa chỉ dành operator. Không dùng env flag “đã backup” để bỏ gate.

## Thêm migration

1. Thêm `db/migrations/004-ten-thay-doi.sql` với SQL transactional, ưu tiên additive/backward compatible. Không sửa 001–003 hoặc version đã phát hành.
2. Append entry `{version: 4, name: 'ten-thay-doi', sql: fs.readFileSync(path.join(__dirname, 'migrations/004-ten-thay-doi.sql'), 'utf8')}` vào catalog. Không đặt baseline/column cho migration thông thường. Version phải liên tiếp.
3. SQL là source được review, không ghép input người dùng. Nếu cần script xử lý credential, dùng prepared statements và workflow riêng hiện có.
4. Test DB trắng, fixture phiên bản trước có dữ liệu, chạy lặp, lỗi sau DDL/DML, checksum và gate backup. Chạy `npm run test:p16`, sau đó smoke nghiệp vụ liên quan.
5. Rehearsal dry-run, backup và apply trên bản sao staging; review tương thích code cũ trước release.

## Lỗi, rollback và forward-fix

- Lỗi trước commit: runner rollback cả batch; không có dòng success chạy dở. Sửa nguyên nhân môi trường/dữ liệu offline và chạy lại. Thông báo chứa version/name, không SQL hoặc dữ liệu nhạy cảm. Có thể dùng preflight trên bản sao để điều tra sâu.
- Crash: SQLite phục hồi transaction chưa commit khi mở lại; kiểm tra integrity, ledger và preflight trước retry.
- Đã commit: không xóa ledger, không sửa checksum, không tự chạy down SQL. Rollback code chỉ khi schema/data vẫn tương thích với code cũ; startup bản cũ sẽ chặn unknown version, nên phải chọn artifact tương thích manifest hoặc restore đồng bộ cả code và DB.
- Ưu tiên forward-fix bằng version mới và backup mới. Với mất dữ liệu/không tương thích, restore backup vào đường dẫn mới theo runbook P17, kiểm chứng rồi chuyển DB_PATH + artifact tương ứng trong maintenance window. Không ghi đè DB hiện tại, không restore chỉ file chính khi WAL còn hoạt động.

P16 không thay thế P17 restore rehearsal hoặc P21 release orchestration; không thay đổi các blocker Critical/High đã ghi ở P15.
