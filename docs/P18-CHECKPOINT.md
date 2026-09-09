# P18 — SQLite concurrency và index

DONE, thực hiện local ngày 08/09/2026. Không truy cập/sửa DB thật, không deploy, không commit. Working tree ban đầu toàn bộ source là untracked; bảo toàn các file ngoài phạm vi. P10/P15 vẫn BLOCKED; P18 không kết luận GO.

## Cấu hình và transaction

- `db/index.js`: file DB phải trả về WAL, nếu không startup fail; `:memory:` dùng journal memory trong test. `foreign_keys=ON` được giữ. Đặt rõ timeout 5.000 ms ở constructor (bao gồm startup), tương ứng `busy_timeout=5000`; đây là làm rõ mặc định better-sqlite3 hiện tại, không phải tăng thời gian chờ. Đặt `synchronous=FULL` để sync mỗi commit, có chi phí I/O. Giữ auto-checkpoint mặc định 1.000 pages; không chạy checkpoint cưỡng bức trong request.
- Production vẫn `assertCurrent` trước khi thay journal; migration chạy offline qua backup gate P16/P17. Development mới chạy migration tự động. FK bật trong migration runner. Các connection CLI backup/restore/migration có vòng đời riêng, không phải pool request.
- Trước P18, create/edit/delete log đọc vé/progress trước transaction; transaction chỉ ghi entry/progress rồi recompute round ngoài commit. P18 bọc **toàn bộ** thao tác engine trong `BEGIN IMMEDIATE`, gồm validation đọc DB và recompute. Các transaction bên trong trở thành savepoint. Lỗi cập nhật round phải rollback cả entry/progress. Không có await/network/hash trong transaction này.
- Migration runner và auth password/rate-limit đã dùng immediate, hash/backup ở ngoài transaction. Session store dùng statement autocommit và throttle touch. Các bulk member/template/season routes vẫn có transaction đồng bộ deferred; một số kiểm tra route ở ngoài transaction. Chưa chứng minh toàn ứng dụng an toàn nhiều writer process. Không mở rộng refactor các luồng đó ở P18.
- SQLite WAL vẫn chỉ có một writer tại một thời điểm. Timeout đồng bộ có thể chặn event loop tới 5 giây; hết hạn vẫn có thể báo SQLITE_BUSY qua error boundary hiện tại. Không retry mutation mù vì request chưa có idempotency key. WAL không dùng trên shared/network filesystem. Cơ sở: [SQLite WAL](https://www.sqlite.org/wal.html), [transaction semantics](https://www.sqlite.org/lang_transaction.html).

## Query plan và phép đo

Chạy `npm run perf:p18`. Harness tạo DB riêng trong OS temp, dùng baseline migration 001, lấy SQL trực tiếp từ routes và index SQL từ migration 004. Không nhận DB_PATH. Fixture: **100.000 entries, 10 gym seasons, 1.000 members, 5 maps**, 10.000 entries/season; timestamp phân biệt trong mỗi season. Node 24.19.0, SQLite 3.53.4, Windows local, WAL/FULL. ANALYZE ở mỗi stage; warmup 3 lần, 25 samples/query. So sánh deep equality kết quả trước/sau từng index. SQL, toàn bộ EXPLAIN QUERY PLAN và p50/p95 từng stage nằm trong [P18-BENCHMARK.json](P18-BENCHMARK.json).

| Query thực tế | Plan trước → sau | p50 trước → sau (ms) | p95 trước → sau (ms, xấp xỉ) |
|---|---|---:|---:|
| Overview: tổng điểm members (`gym-public.js:140`) | Join entries chỉ theo season → SEARCH member_id + gym_season_id | 91,23 → 2,90 | 94,77 → 3,92 |
| Overview: score cells (`:149`) | SEARCH season + TEMP B-TREE GROUP BY, giữ nguyên | 3,59 → 3,52 | 5,00 → 4,63 |
| Overview: ticket entries (`:155`) | SEARCH season, map PK, TEMP B-TREE ORDER BY, giữ nguyên | 7,61 → 6,96 | 8,61 → 8,07 |
| Leaderboard (`:203`) | Automatic covering index tạo lúc query → index member_id lưu sẵn | 63,79 → 3,02 | 66,62 → 4,53 |
| Public history (`:230`) | SEARCH season + TEMP sort → SEARCH season_created, không TEMP sort | 12,91 → 0,34 | 13,45 → 0,71 |
| Admin log management | SEARCH season + TEMP sort → SEARCH season_created, không TEMP sort | 13,01 → 0,34 | 13,42 → 0,38 |

History filter Thành viên/Round/Map thực thi ở `public/dashboard.js` và `public/admin.js` trên **300 log mới nhất**, không có SQL filter riêng. Không tạo index cho WHERE không tồn tại, không thay phạm vi lịch sử hay phân trang. Edit/delete tìm entry bằng primary key với tenant guard, không cần composite index. Với created_at trùng nhau, SQL hiện tại không quy định tie-break; thứ tự các dòng bằng thời gian không được bảo đảm bởi API.

Giữ TEMP sort cho aggregate leaderboard/overview: index thường không sort được SUM tính lúc chạy. Không thêm index cho score/ticket cells khi chưa có bằng chứng lợi ích riêng. Các lookup map/round/progress có PK/UNIQUE sẵn hoặc tập cấu hình nhỏ. Phép đo bảng trên là các SQL nặng, **không phải latency toàn endpoint**; `/state` và leaderboard còn các truy vấn theo từng member. Không suy rộng sang dữ liệu lệch phân bố, nhiều round, dữ liệu lớn hơn hoặc disk production.

## Hai index được giữ và chi phí

Migration **004-entry-query-indexes.sql**, không sửa checksum baseline 001–003:

| Index | Lợi ích riêng khi thêm | Tăng page allocation trên fixture |
|---|---|---:|
| `entries(member_id, gym_season_id)` | Overview member join và leaderboard nhanh ngay ở stage 1 | 1.261.568 bytes (~12,6 bytes/entry) |
| `entries(gym_season_id, created_at DESC)` | Hai query latest-300 bỏ sort ngay ở stage 2 | 3.493.888 bytes (~34,9 bytes/entry) |

Allocated DB pages × page_size: **5.681.152 → 6.942.720 → 10.436.608 bytes** (+4.755.456 bytes, ~84%). Đây là dung lượng DB cấp phát trên fixture, không phải đo WAL/SHM, backup, peak migration hay cam kết bytes/row cho mọi dữ liệu. Timestamp ISO trong fixture dài hơn datetime mặc định. Giữ index season cũ vì vẫn phục vụ các query scan theo season; không bỏ index baseline ở task này.

Microbenchmark 1.000 INSERT trong transaction rồi ROLLBACK, 15 samples: p50 **2,573 → 3,335 → 4,380 ms** (+~70% tổng); p95 **4,205 → 4,379 → 5,458 ms**. Chỉ đo chi phí CPU/page/index maintenance, không gồm fsync COMMIT và không đại diện write throughput. Mỗi INSERT/DELETE thêm hai B-tree cần cập nhật; UPDATE member/season/created_at cũng phải cập nhật index tương ứng. UPDATE points/tickets không đổi key hai index. Migration cần thời gian xây index và disk trống, lấy khóa ghi; lên lịch maintenance sau backup/preflight, đo trước trên bản sao production. Không đã áp dụng DB thật.

## Concurrency và regression

`npm run test:p18` đã PASS **160 checks / 0 FAIL / 0 skip**: node:test 37, engine 32, route smoke 50, frontend UX/filter 41. Sau đó bổ sung test upgrade v3 có entry data và chạy lại migrations: **12 PASS / 0 FAIL** (11 test cũ + 1 mới). Tổng phạm vi cuối cùng **161 checks duy nhất** đã PASS; không chạy toàn bộ suite ngoài phạm vi P18.

- Kiểm tra WAL/FK/FULL/timeout trên file DB; FK sai bị từ chối.
- Worker giữ writer lock 250 ms: reader vẫn đọc được (~0,1 ms); writer đợi rồi thành công. Case timeout riêng đặt 50 ms dưới lock 300 ms nhận **1 SQLITE_BUSY có chủ đích**, không thêm entry. Đây là chứng minh timeout có giới hạn, không phải production error.
- **3 writer connections × 100 createEntry** và **100 snapshot reads** bắt đầu cùng barrier; 300 entries và 300 progress points, snapshot không thấy trạng thái nửa commit, integrity/FK PASS, **0 lỗi ngoài dự kiến**, thời gian ~4,73 giây. Worker threads là kết nối SQLite độc lập, không phải ba Node servers.
- Tiêm trigger lỗi recompute: create/edit/delete đều rollback, snapshot DB không đổi.
- **Một Node HTTP server**, session/cookie/CSRF thật, DB file WAL, **80 POST log + 40 GET overview/leaderboard/history/admin entries**, concurrency **10**, tổng 120 responses 200, 80 entry IDs và progress=80; **0 lỗi**. Latency gộp p50 **43,40 ms**, p95 **71,82 ms**, p99 **77,82 ms**. Rate limits vẫn bật. Fixture nhỏ, chạy ngắn, không phải soak test hay giới hạn tải an toàn production.
- Migration v3→v4 bảo toàn entries, chạy lặp không đổi dữ liệu; backup/restore, session và engine/filter hồi quy PASS. Hai lỗi harness trong lúc phát triển (thiếu backup path fixture và assertion cố định 3 migrations) đã sửa và chạy lại thành công.
- Engine test chuyển sang thư mục temp tự tạo thay vì xóa `test/test.db`; file DB test cũ của workspace được giữ nguyên.

## Ngưỡng PostgreSQL và vận hành

**Chỉ vận hành một Node instance, một host, disk local.** Kết quả worker/HTTP trên không chứng minh cluster/PM2 nhiều instance, rate-limit dùng memory, concurrent template edits hay nhiều server. [SQLite khuyến nghị client/server khi cần nhiều writer đồng thời](https://www.sqlite.org/whentouse.html).

Các ngưỡng sau là **chính sách đề xuất của dự án**, không phải giới hạn cứng SQLite hoặc SLA đã được chứng minh. P20/P23 cần đo trên host/dữ liệu đại diện; P18 chưa triển khai monitoring:

1. Cần từ **2 Node instances ghi DB**, nhiều host, HA/failover hoặc storage mạng: lập kế hoạch PostgreSQL **trước** khi bật topology đó.
2. Ở tải peak dự kiến, sau index và transaction ngắn, `SQLITE_BUSY/LOCKED` vượt **0,1% mutation trong 15 phút**, hoặc lặp lại timeout đủ **5 giây**: điều tra writer dài/backup/checkpoint trước; nếu tái diễn ở tải bình thường, chuyển PostgreSQL thay vì tăng timeout liên tục.
3. p95 ghi log **>500 ms** hoặc p99 **>1 giây** trong **15 phút**, có bằng chứng thời gian chờ khóa/serialize writes là nguyên nhân; nếu không đạt sau xử lý transaction dài, chuyển PostgreSQL. Nếu CPU/query scan/event loop mới là nguyên nhân thì phải sửa query/phân trang, đổi DB đơn thuần không bảo đảm giải quyết.
4. Soak test tối thiểu **30 phút ở 2× peak dự kiến** không giữ được error budget/latency trên, hoặc write queue tăng liên tục: không GO với cấu hình đó; giảm tải hoặc chuyển PostgreSQL rồi kiểm thử lại. Concurrency 10 trong test này chưa thay thế gate đó.
5. WAL lớn **>256 MiB trong 15 phút** hoặc tăng qua nhiều checkpoint: điều tra long reader/disk và release snapshot; nếu workload bắt buộc giữ read transaction dài làm writer/checkpoint không đáp ứng vận hành, ưu tiên PostgreSQL. Dung lượng rows/GB tự nó không phải trigger chuyển DB.

Bước áp dụng sau này: backup đã verify → offline preflight/migrate P16/P17 → chạy ANALYZE trên DB đã migrate trong maintenance → smoke test → khởi động một instance. Migration v4 additive nhưng code cũ P16 từ chối version không biết; rollback code không tự xóa index/ledger. Dùng forward-fix hoặc restore vào đường dẫn mới theo runbook; không DROP dữ liệu/migration history để ép startup. Tiếp tục đo workload đại diện ở P23 khi được yêu cầu; dừng P18 tại đây, không làm P19.

File thay đổi: `db/index.js`, `db/migrations.js`, migration 004, `engine/index.js`, `package.json`, `scripts/benchmark-sqlite.js`, `test/p18-fixture.js`, `test/p18-worker.js`, `test/sqlite-concurrency-test.js`, `test/migrations-test.js`, `test/backup-restore-test.js`, `test/engine-test.js`, checkpoint/benchmark này và bảng P18/PRODUCTION-READINESS.

Commit đề xuất: `perf: harden SQLite log transactions and add measured entry indexes`.
