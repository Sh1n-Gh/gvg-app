# Release và rollback — P21

Đây là pipeline trung lập cho mô hình P12: một Linux host, một Node process,
SQLite trên local disk. Không có target/provider/credential mặc định và không có
deploy tự động khi push. P10/P15 vẫn BLOCKED; tài liệu này không cấp quyền go-live.

## Build một lần, promote cùng artifact

1. Review và commit source/lockfile; chọn version trong package.json và cập nhật
   package-lock.json tương ứng. Không sửa tag hoặc ghi đè artifact đã phát hành.
2. Runner disposable Linux cùng CPU/libc với server, Node 24.19.0, npm 11.17.0;
   pin runner image bằng digest và Gitleaks bằng version/checksum do tổ chức review.
   Không mount DB/upload, secret production hoặc socket quản trị vào build job.
3. Chạy `bash scripts/ci-release.sh` trên checkout sạch. Pipeline chạy clean install,
   Chromium cho browser tests, tất cả `*-test.js` tuần tự, audit mọi dependency
   (chặn từ low, registry lỗi cũng chặn), kiểm tra cây production, scan Git history
   với redaction, rồi package. Test cũ fail vẫn chặn release, không skip để lấy artifact.
4. Package dùng allowlist source đã commit, không lấy `.env`, DB, backup, upload,
   season snapshot hoặc log; clean install production trong staging riêng và smoke
   native SQLite/Sharp. Gitleaks scan staging trước/sau install. Không có frontend
   bundler: build là runtime bundle gồm code, public assets và production node_modules.
5. Kết quả `dist/<version>-<full-commit>.tar.gz` và `.sha256`; `release.json` chứa
   version/commit/Node/OS/CPU. Upload vào registry/object storage có create-only,
   retention/object lock; lưu digest trong release record tin cậy, ký provenance
   bằng workload identity nếu provider hỗ trợ. Không lấy expected digest từ cùng
   nguồn download không tin cậy. Job lỗi không được publish, kể cả còn file dist.
   Không chạy npm install/build lại trên server; promote chính bytes đã test staging.

Artifact bất biến nghĩa là không ghi đè và deploy theo digest; không tuyên bố tar
rebuild byte-for-byte giống nhau. Phải giữ artifact trước, digest, runtime tương ứng
và backup đủ lâu cho cửa sổ rollback. Source hiện chưa tracked nên pipeline cố ý
không tạo release từ workspace này; không tự commit trong P21.

## Secret store

Build/test không nhận secret production. Test chỉ tự sinh credential fixture.
Registry private dùng workload identity/credential ngắn hạn từ secret store, chỉ
mount ngoài staging, không truyền qua command arguments. Runtime dùng agent/SDK
secret manager truyền env trong memory cho service; không lưu secret vào YAML,
checkout, release.json, log, artifact hoặc release receipt. Không bật shell trace,
dump env, HTTP body/header logging. Adapter phải sanitize lỗi và chỉ ghi receipt
opaque vào hồ sơ riêng mode 0600. Không upload raw test/build diagnostics.

Mẫu EnvironmentFile P12 chỉ là mẫu cũ: trước dùng thực tế thay bằng integration
secret store của provider; nếu systemd cần file thì agent mount ephemeral credential
trên tmpfs riêng mode 0600, không dùng file secret bền vững trong /etc hoặc release.
Không ghi giá trị secret vào unit. Quyền lấy secret chỉ cấp deploy/runtime job đã
được duyệt, không cấp PR runner. Backup DB cũng là dữ liệu nhạy cảm, không phải CI artifact.

## Deploy adapter bắt buộc (chưa cấu hình provider)

`scripts/release.js` export `release(adapter, request)`; không có CLI target mặc định.
Provider entrypoint phải được review, có protected environment/manual approval và
chỉ chạy artifact từ pipeline thành công. CI build ở trên không gọi entrypoint này.
Request gồm `mode: 'deploy'`, `databasePath` tuyệt đối và `digest` SHA-256 tin cậy.
Không đưa secret vào request. Adapter phải implement toàn bộ contract dưới đây;
thiếu method sẽ bị chặn trước mutation. Đây là interface cần tích hợp, không phải
adapter systemd đã sẵn sàng dùng trên production.

| Method | Điều kiện thành công bắt buộc |
|---|---|
| verifyArtifact | Verify digest/provenance, version, OS/CPU/libc/Node; unpack an toàn vào thư mục release mới, từ chối traversal/symlink ngoài bundle và ghi đè release |
| maintenance(true/false) | Đóng/mở traffic tại proxy; khi đóng chặn cả upload/mutation; giữ health quản trị riêng |
| stop | Dừng service, disable restart và mọi cron/worker/writer; chờ graceful drain P20, chứng minh process đã thoát trước trả về |
| backup | Dùng P17 Backup API, integrity check và snapshot đồng bộ uploads + season-configs khi writer đã dừng; verify restore/checksum, bản copy độc lập mã hóa theo P17; trả `{ok:true,database:opaqueRef,files:opaqueRef,verified:true}` chỉ khi đạt đủ gate |
| record | Lưu durable receipt riêng: release trước/sau, digest, DB/file refs, thời điểm, operator, trạng thái; không lưu env/credential; failure phải throw |
| migrate | Chạy `scripts/migrate-db.js` của target với NODE_ENV=production, DB_PATH rõ ràng và MIGRATION_BACKUP_HOOK trỏ tuyệt đối tới scripts/sqlite-backup.js; BACKUP_DIR riêng; child exit khác 0 phải throw |
| assertSchema | Chạy `db/migrations.assertCurrent` của TARGET release trên DB được chọn read-only, fileMustExist; ledger version/checksum phải khớp chính xác |
| activate | Atomic switch code pointer khi service dừng; giữ DB ngoài release; gắn uploads/map-images và season-configs vào storage riêng có quyền ghi; không symlink public tới dữ liệu riêng tư |
| start | Start đúng một process dùng secret store và release/DB đã chọn, không chạy migration lúc startup |
| ready | Dùng scripts/release-readiness.js với port loopback và Host từ PUBLIC_ORIGIN; chỉ trả true khi HTTP 200 JSON status=ok; bounded retries; xác nhận đúng PID/digest của service vừa start và TLS/proxy smoke riêng |
| restore | Chỉ dùng recoveryRef đã xác minh; P17 restore DB vào NEW path và file snapshot vào NEW directories; cập nhật target DB cho assertSchema/start; giữ nguyên DB/file hiện tại |

Trình tự executable: verify → release lock → maintenance → stop → backup gate →
receipt → migration → target schema check → activate → start → readiness → receipt →
mở traffic. Bất kỳ lỗi nào sau lock đều cố giữ maintenance và stop, trả lỗi generic;
operator phải xác nhận proxy/process thật đã dừng nếu provider mất kết nối. Không
auto rollback DB, không auto mở lại traffic sau lỗi. Adapter cần timeout từng lệnh,
external watchdog và rehearsal trên fixture trước được kết nối staging.

## Khóa migration và release

Production migrateProduction lấy atomic mkdir `<realpath(DB)>.migration-lock`
trước preflight/async backup và giữ tới transaction xong; tiến trình thứ hai bị
từ chối ngay. SQLite BEGIN IMMEDIATE vẫn bảo vệ transaction. Release/rollback dùng
khóa riêng `<realpath(DB)>.release-lock` bao trùm toàn bộ operation; CI provider
cũng phải cấu hình concurrency theo môi trường, không cancel job đang migration.

Local disk duy nhất, DB canonical path duy nhất, không dùng hardlink alias hoặc
network filesystem. Manual migration phải theo maintenance procedure, không được
chạy đồng thời release; quyền vận hành chỉ dành cho một runner. Không bypass runner
bằng SQL/auth migration cũ. Crash giữ khóa: không tự expire/steal theo PID hoặc tuổi.
Operator phải xác nhận mọi process/job đã dừng, kiểm tra ledger/integrity và receipt,
sau đó chỉ xóa đúng thư mục khóa rỗng đã xác định; không xóa DB/WAL/SHM. Khi restore
đổi DB path, tiếp tục khóa theo databasePath gốc tới hết operation, cấm job mới cho
đến khi đổi cấu hình môi trường và kết thúc recovery.

## Rollback khẩn cấp

1. Đóng traffic, tuyên bố incident, chỉ định một operator; dừng writer và các job
   deploy/migration. Giữ logs redacted và ghi digest/receipt đang chạy. Nếu job crash,
   xử lý khóa như trên, không retry mù.
2. Chọn artifact trước bằng trusted digest, kiểm tra compatibility trên bản sao DB.
   Gọi cùng `release(adapter, {...request, mode:'rollback'})`. Code có sẵn sẽ backup
   trạng thái hiện tại, kiểm tra schema bằng code target, switch code rồi readiness;
   không chạy migration ngược. Chỉ mở traffic khi gate pass.
3. Runner hiện `assertCurrent` yêu cầu EXACT manifest. Vì vậy ngay cả migration
   additive mới cũng có thể khiến code cũ không start. Không sửa ledger/checksum hoặc
   xóa hàng để ép rollback. Prefer forward-fix với manifest hiện tại, hoặc recovery
   DB + file snapshot tương ứng release cũ.
4. Với migration không backward-compatible: trước release phải có maintenance window,
   backup DB/files đồng bộ, rehearsal restore và kế hoạch RPO/data reconciliation.
   Ưu tiên expand → chuyển code/data → contract ở release sau; không drop/rename trước
   khi hết cửa sổ rollback. Khi cần restore, người chịu trách nhiệm phải duyệt mất các
   ghi mới kể từ snapshot; giữ DB hiện tại cho reconciliation.
5. Sau duyệt, gọi rollback với `restore:true`, `dataLossApproved:true` và `recoveryRef`
   opaque của backup trước release. Adapter restore vào đường dẫn MỚI, kiểm tra
   integrity/foreign keys/manifest, gắn đúng snapshot runtime và code cũ. Không down SQL
   tự động. Xem BACKUP-RESTORE.md về session hồi sinh, revoke/rotate và auth recovery.
6. Readiness + kiểm tra login/CSRF/phân quyền, Dashboard và upload trên môi trường
   recovery; mở traffic có kiểm soát, theo dõi errors/latency/disk/backup. Nếu thất bại,
   giữ maintenance và forward-fix/recovery, không tự chuyển lại DB đã có ghi khác.

Mục tiêu RTO ≤60 phút theo P17, phải đo trong rehearsal; RPO recovery là thời điểm
snapshot được chọn, không hứa zero data loss. Không dùng fixture test để ghi lên DB thật.

## Bằng chứng P21 và việc còn lại

Local chỉ chạy suite liên quan release/migration/backup, không full checkpoint suite.
Lệnh `node --test test/release-test.js test/migrations-test.js test/backup-restore-test.js`
đạt **30 PASS, 0 FAIL, 0 skip** ngày 08/09/2026. Bao gồm hai OS process tranh khóa,
hai production runner tranh khóa trong async backup, failure injection các gate,
rollback/restore approval và probe HTTP thực trên loopback. Lần test đầu probe Host
không khớp; đã sửa dùng node:http và rerun toàn bộ ba suite thành công.
Chưa chạy clean install/build Linux, Gitleaks CI, immutable registry, provider adapter,
secret store integration hoặc staging rehearsal. Những gate đó chưa được chứng nhận
PASS. Trước rollout phải hoàn tất adapter và kiểm tra failure injection, hai job cùng
lúc, crash/stale lock, code rollback cùng schema, restore khác schema, mất secret store
và readiness fail; ghi digest, thời gian RPO/RTO và người review. P22/P24 chưa thực hiện.
