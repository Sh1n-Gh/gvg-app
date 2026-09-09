# Backup và restore SQLite — P17

Ngày kiểm chứng: 08/09/2026. Chỉ dùng fixture test; chưa chạy backup, restore hoặc đổi cấu hình database thật.

## Cơ chế và cấu hình

`scripts/sqlite-backup.js` dùng `better-sqlite3 db.backup()` (SQLite Online Backup API), mở nguồn read-only/fileMustExist. API đọc cả WAL đang hoạt động; không copy trực tiếp file DB, không checkpoint nguồn, không dùng immutable mode. SQLite có thể truy cập/tạo sidecar SHM khi đọc WAL. Backup phản ánh một trạng thái nhất quán trong thời gian chạy, không bảo đảm đúng thời điểm bắt đầu khi writer tiếp tục commit.

Đích được kiểm tra đường dẫn thực (kể cả junction/symlink thư mục), phải ngoài `public/`. Thư mục phải tồn tại, đường dẫn tuyệt đối, do operator quản lý độc quyền; không dùng thư mục mọi user đều ghi được. File mới tạo exclusive với mode 0600; Linux đặt thư mục 0700, umask 077; Windows đặt ACL chỉ service backup/operator, vì mode POSIX không thay thế ACL. Không cấu hình proxy/static alias tới thư mục backup. Không đặt backup trong checkout dù `.gitignore` đã bỏ qua `*.sqlite3`, sidecar và `*.sqlite3.partial*`.

Ví dụ PowerShell, thay đường dẫn bằng cấu hình của môi trường cần vận hành; các lệnh dưới chưa được chạy trên DB thật:

```powershell
$env:DB_PATH = 'D:\private\gvg\gvg.db'
$env:BACKUP_DIR = 'D:\private\gvg-backups'
$env:BACKUP_RETENTION_DAYS = '7'
npm run db:backup
```

Thư mục phải được tạo và cấp ACL trước. CLI không có DB mặc định, không tự tạo nguồn thiếu. Thành công exit 0 và JSON chứa `ok`, `reference`, `path`; thất bại exit 1, không in dữ liệu/credential. File có tên `gvg-<UTC timestamp>-<UUID>.sqlite3`. Ghi vào `.partial`, chuyển bản sao về journal DELETE, chạy toàn bộ `PRAGMA integrity_check` và `foreign_key_check`, đóng và fsync rồi publish bằng hard link không ghi đè. Yêu cầu filesystem local hỗ trợ hard link (NTFS/ext4); không chạy đích trên object store/network share. Bản hoàn tất không cần WAL/SHM. Crash có thể để lại partial: không dùng nó để restore hoặc upload; chỉ dọn sau khi xác nhận job đã dừng. Thư mục/metadata durability phụ thuộc filesystem và máy chủ; không xem backup local là bảo vệ khỏi mất máy.

Retention mặc định 7 ngày (số nguyên 1..3650), dựa timestamp UTC trong tên, chỉ xóa file thường đúng mẫu tên của công cụ sau khi backup mới đã kiểm chứng. Không xóa file thủ công, symlink, partial, bản vừa tạo hoặc đường dẫn nguồn. Dùng một thư mục riêng cho mỗi database; tránh chạy nhiều job đồng thời. Lỗi dọn retention vẫn khiến job exit 1 dù bản mới có thể đã hoàn tất; kiểm tra trước khi chạy lại. Retention local độc lập retention off-server.

## Lịch, RPO/RTO và off-server

- Chạy mỗi giờ ở phút 05 bằng Task Scheduler Windows hoặc systemd timer/cron Linux; đặt working directory về release, Node 24, env từ secret store, một job tại một thời điểm. Cấu hình không khởi chạy instance thứ hai; timeout job 10 phút. API có giới hạn tiến độ 5 phút; watchdog scheduler xử lý trường hợp I/O bị treo.
- Backup thêm trước migration/release nguy hiểm. Dừng mọi writer từ trước backup migration tới khi migration hoàn tất. Đặt `MIGRATION_BACKUP_HOOK` thành đường dẫn tuyệt đối tới `scripts/sqlite-backup.js` trong release tin cậy; `BACKUP_DIR` và retention như trên. Provider trả receipt thật cho ledger P16. Không thay credential backup riêng của auth.
- Sau exit 0, mã hóa và chuyển đúng file `path` hoàn tất lên storage ở máy/tài khoản độc lập. Dùng công cụ backup mã hóa được tổ chức quản lý, TLS khi truyền, encryption at rest/KMS hoặc mã hóa client trước upload. Key trong secret manager riêng; kiểm thử khả năng lấy key khi mất server. DB backup chứa hash, session và có thể cả credential legacy: coi là secret.
- Giữ off-server tối thiểu 30 ngày bản theo giờ và 12 bản tháng; dùng versioning/immutability và quyền service chỉ upload nếu storage hỗ trợ. Xác minh checksum trước/sau tải về và thử giải mã; không ghi key vào log/repo. Chỉ copy file backup đã hoàn tất, không copy DB nguồn. Việc upload/mã hóa chưa được tự động hóa hoặc cấu hình lên dịch vụ thật trong P17.
- RPO mục tiêu local ≤1 giờ khi job đúng lịch; mất cả máy: ≤75 phút nếu upload hoàn thành trong 15 phút. RTO mục tiêu ≤60 phút kể từ tuyên bố sự cố, gồm lấy key/download, restore/check, kiểm tra app và chuyển service. Đây là mục tiêu vận hành chưa được đo với dung lượng/network production. Nếu job/upload trễ thì RPO tăng theo tuổi bản gần nhất đã xác minh.
- Cảnh báo ngay khi exit khác 0, không có backup local mới trong 75 phút, off-server trong 90 phút, upload/checksum/decrypt thất bại, hoặc thiếu dung lượng. Dự trù disk ít nhất toàn bộ retention cộng hai lần kích thước DB cho backup/restore, đo lại theo tăng trưởng. Operator trực chịu trách nhiệm tiếp nhận; phải chỉ định người thay thế trước go-live.

## Restore vào đường dẫn mới

```powershell
$env:BACKUP_FILE = 'D:\private\gvg-backups\gvg-TIMESTAMP-UUID.sqlite3'
$env:RESTORE_DB_PATH = 'D:\private\recovery\gvg-restored-20260908.db'
npm run db:restore
```

Tải/giải mã và xác minh checksum từ off-server trước bước này. Parent phải tồn tại và có ACL riêng. Restore cũng dùng SQLite Backup API, integrity/foreign-key check và fsync. Từ chối đích đã tồn tại, kể cả symlink/hardlink hoặc sidecar `-wal`, `-shm`, `-journal`. Không có `--force`; không mặc định dùng `DB_PATH`, không đổi `.env` hay khởi động service. Lỗi sẽ dọn file đích do chính lần gọi tạo; nguồn không bị thay đổi dữ liệu.

Sau restore:

1. Dùng release tương ứng với schema snapshot. Kiểm tra ledger bằng `db:preflight` với `DB_PATH` trỏ rõ ràng tới bản restore; không tự migration bằng release mới nếu đang rollback.
2. Chạy app cô lập chỉ localhost trên bản restore; dùng cấu hình/secret phù hợp, kiểm tra login Master/Gym, phân quyền, state/leaderboard/overview, thành viên và entry. Chỉ ghi thử trên bản diễn tập được phép thay đổi. Tuyệt đối không chạy smoke fixture lên dữ liệu thật: suite bên dưới luôn tự tạo dữ liệu test.
3. Khôi phục `public/uploads/map-images` và `season-configs` từ backup file riêng cùng thời điểm/release; SQLite backup không chứa các file này. Muốn snapshot DB và file đồng bộ phải dừng writer/upload trong maintenance window. Giữ release/config/secret store đủ để dựng lại app, nhưng không gộp khóa giải mã cùng backup.
4. Khi được phê duyệt chuyển service: dừng writer, giữ nguyên DB cũ, đổi DB_PATH sang bản đã kiểm chứng, kiểm tra quyền/secret/session policy rồi khởi động và smoke. Session cũ trong snapshot có thể sống lại: cân nhắc revoke sessions và đổi signing keys theo quy trình auth trước mở truy cập.
5. Nếu kiểm tra thất bại, dừng service và điều tra trên bản riêng; không ghi đè DB cũ. Chuyển lại DB cũ cần đánh giá dữ liệu đã ghi sau cutover để tránh mất cập nhật.

## Diễn tập và bằng chứng

```powershell
npm run test:p17
node --test test/migrations-test.js
```

`test:p17` tạo thư mục temp độc lập và nguồn fixture; giữ kết nối WAL mở khi backup, xác minh dữ liệu đã commit và loại dữ liệu chưa commit. Test thêm chống overwrite/sidecar, junction ra web root, nguồn thiếu/hỏng, retention, CLI và hook P16 trên DB mới. Smoke tạo schema cùng marker trong WAL, backup/restore rồi chạy 50 kiểm tra HTTP hiện có trên bản restore, thêm 2 check marker/integrity. Không reset hay mở database thật. Fixture tự dọn sau thành công; smoke có tạo/xóa các file ảnh/snapshot test do chính nó sinh.

Kết quả cuối ghi tại bảng P17. Lần đầu phát hiện fsync read-only handle không hợp lệ trên Windows; đã sửa sang handle r+ của bản sao và chạy lại thành công.

Hàng tuần chạy test fixture này. Hàng tháng operator tải một backup off-server, giải mã, restore vào máy cô lập, integrity/foreign-key check, kiểm tra ledger và các luồng ứng dụng bằng dữ liệu phục hồi; ghi thời điểm snapshot, checksum, kích thước, release/schema, số bản ghi kỳ vọng, thời gian download/restore/check/cutover và người thực hiện. Hàng quý diễn tập mất server và phục hồi khóa, đo RPO/RTO thực tế. Sau đổi schema/Node/storage/key phải diễn tập lại. Không đánh dấu off-server đã kiểm chứng chỉ vì upload thành công.

P17 hoàn tất phần code và diễn tập fixture. Scheduler, storage mã hóa, ACL thực, backup file upload và RPO/RTO production còn phải triển khai/đo khi có môi trường được phê duyệt. P10/P15 vẫn bị chặn; tài liệu này không phải quyết định GO. Dừng ở P17, không làm P18.

## Hồ sơ thay đổi P17

- Thêm `scripts/sqlite-backup.js`, `scripts/backup-db.js`, `test/backup-restore-test.js`, `docs/BACKUP-RESTORE.md`.
- Sửa `test/master-routes-smoke-test.js` (temp riêng và chế độ restore rehearsal), `package.json` (ba lệnh backup/restore/test), `.env.example`, `.gitignore`, `docs/MIGRATIONS.md`, bảng P17 trong `docs/PRODUCTION-GO-LIVE-PROMPTS.md`.
- Kiểm thử cuối: `npm run test:p17` = 5 test backup/restore + 52 smoke PASS, 0 FAIL; `node --test test/migrations-test.js` = 11 PASS, 0 FAIL. Tổng 68 checks PASS, 0 FAIL, 0 skip. `git check-ignore` xác nhận file backup/partial bị ignore. Không chạy full suite vì P17 không phải checkpoint audit.
- Working tree ban đầu toàn bộ source untracked; không commit, không xóa hoặc chỉnh DB thật. Commit đề xuất: `feat(ops): add WAL-safe SQLite backup and verified restore rehearsal`.
