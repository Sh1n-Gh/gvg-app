# P24 — Tổng duyệt cuối

Ngày thực hiện: 09/09/2026, Asia/Bangkok (ngày lịch P24 dự kiến 09/10/2026).
Kết luận: **NO-GO**. P24 **BLOCKED** ở gate go-live; audit và rehearsal local đã thực hiện.
Không deploy, đổi DNS/domain, firewall hoặc truy cập DB/secret production. Không commit.

## Môi trường và khả năng tái lập

Windows, Node v24.19.0/npm 11.17.0, dependency hiện có. `git ls-files` trả 0 file;
working tree toàn source untracked, được giữ nguyên. Không có AGENTS.md trong cây
workspace. Nginx/Docker/OpenSSL không tìm thấy trong PATH; không có target/provider
adapter, artifact cũ hoặc domain staging đã cấu hình. Vì vậy chọn **mô phỏng local**
được yêu cầu cho phép, không tự cài/chạy hạ tầng công khai.

Các lệnh đã thực thi:

```powershell
node scripts/test-ci.js
node scripts/rehearse-p24.js
node test/master-routes-smoke-test.js --restore-rehearsal
npm audit --json
```

Runner full regression chạy đủ 20 `*-test.js` tuần tự, không dừng ở suite fail.
Log riêng ở `tmp/p24/` (ignored); kết quả, thời gian, từng suite và SHA-256 log
được giữ trong [P24-RESULTS.json](P24-RESULTS.json). Không đưa DB/hash mật khẩu/session
hay secret vào tài liệu. Các fixture được tạo trong thư mục temp riêng; script P24
giữ fixture/receipt để kiểm tra, không có tùy chọn nhận URL/DB/secret của người dùng.
Mọi process P24 đã dừng khi kết thúc. ACL temp được đọc: nhóm sandbox có Modify;
**không đạt phân quyền production**, chỉ chấp nhận dữ liệu tổng hợp.

## Release, rollback và restore

[scripts/rehearse-p24.js](../scripts/rehearse-p24.js) gọi protocol P21 thật
`release(adapter, request)`, nhưng adapter được gắn nhãn simulation rõ ràng:

1. Tạo DB fixture ở schema 003 và principal Master tổng hợp với Argon2id. Không
   đọc `.env` vào child; child chạy ở thư mục fixture, secret ngẫu nhiên truyền env
   trong memory, không qua argument. Đây không phải secret manager integration.
2. Verify digest **server.js hiện tại**, release lock, maintenance mô phỏng, stop,
   SQLite Backup API thật và restore bản backup vào đường dẫn mới để kiểm integrity/FK,
   ghi receipt. Không coi digest một file là digest/provenance artifact phát hành.
3. Chạy CLI `migrate-db.js` với `NODE_ENV=production`, DB_PATH fixture tuyệt đối,
   hook `sqlite-backup.js` thật, BACKUP_DIR riêng. Migration 004 thực sự được áp;
   ledger đủ 4 version và backup_ref không rỗng. Có backup gate trước migration
   và backup hook riêng trước DDL; không chỉnh/xóa ledger để ép schema.
4. Assert exact schema/integrity, activate mô phỏng, start `server.js` bằng child
   process, HTTP `/health` và `/ready` 200/status=ok, login/cookie/headers/Host/private
   paths smoke trước mở maintenance mô phỏng. Listen loopback và port động.
5. Gọi mode rollback: stop, backup trạng thái hiện tại, assert schema, activate label
   previous và start/readiness/smoke. Chỉ một lần migrate trong chuỗi deploy/rollback;
   không down SQL. **Hai label dùng cùng source và schema hiện tại**, không chứng minh
   rollback artifact cũ hoặc rollback qua schema khác. Không có code pointer thật.
6. Dừng process, restore snapshot trước rollback vào **DB riêng mới**, giữ DB nguồn;
   integrity/FK/exact schema/principal count PASS; khởi động app trên DB restore,
   health/readiness/login/security smoke rồi dừng. Bản pre-migration cũng được restore
   kiểm integrity tại backup gate; không khẳng định code schema 004 chạy trên schema 003.

Kết quả lần cuối: **58 checks PASS** (53 runtime/protocol assertions và 5 config
assertions, trong đó 4 chỉ đọc template). Deploy 1.096 ms, rollback 859 ms,
restore + startup + smoke 812 ms. Đây là thời gian fixture nhỏ; không phải RTO
production 60 phút đã được chứng nhận. RPO là thời điểm snapshot; không có business
writes giữa snapshot và restore và không suy ra zero data loss cho production.
Một lần chạy đầu harness không đạt do auth fixture helper tự nâng schema trước
CLI migration; đã thay bằng seed principal trực tiếp ở schema 003 rồi chạy lại.

Giới hạn còn nguyên: maintenance không có proxy thật; không có runtime file do
rehearsal sinh nên receipt files ghi `SIMULATED-empty-runtime-files`; chưa backup
upload/season snapshot đồng bộ, off-server mã hóa/download/decrypt, atomic release
pointer, trusted registry/provenance, watchdog/provider failure hoặc secret store.
Windows kill không chứng nhận graceful drain systemd/Linux. Failure injection và
tranh lock nằm trong release/migration suites đã chạy, không thay rehearsal provider.

Smoke restore bổ sung dùng chế độ P17: **52 PASS / 0 FAIL**, bao gồm marker WAL,
integrity và 50 kiểm tra HTTP nghiệp vụ trên DB restore tổng hợp. E2E P22 chạy trên
fixture riêng của suite, không phải trên cùng DB P24; không gộp thành PASS của release.

## Kiểm tra hạ tầng và bảo mật

| Hạng mục | Kết quả/bằng chứng | Gate còn thiếu |
|---|---|---|
| HTTP → HTTPS | STATIC PASS: Nginx 308 tới host cố định, giữ URI | Chưa gửi request qua Nginx; cần nginx -t và redirect thực |
| TLS | STATIC PASS: TLS1.2/1.3, reject unknown SNI | Chưa handshake/chain/SAN/expiry/renewal staging CA; không gọi header XFP là TLS |
| Proxy/Host | Deployment tests và P24 HTTP probe PASS: Host lạ 400, cấu hình chỉ loopback, XFF/XFP overwrite trong template | Chưa xác minh hai client/IP budget và spoof qua proxy thật |
| Headers/CSP | 3/3 security-headers tests PASS, gồm browser/CSP thực; P24 kiểm CSP/HSTS/nosniff tại login | Early Host 400 trước middleware vẫn thiếu headers (`server.js:18–20`); edge errors chưa xác minh |
| Cookie/CSRF | P24 cookie __Host-, Secure, HttpOnly, SameSite=Lax, Path=/, không Domain; HTTP không Set-Cookie; session 16/16 PASS | Chưa trình duyệt đi qua HTTPS thật; giữ CSRF regression trên staging |
| Firewall/port | Production listenOptions ép 127.0.0.1 kể cả HOST wildcard; child nhận HTTP loopback | Không kiểm firewall host/security group/IPv6 hay probe từ mạng ngoài; không mở port |
| File permissions | Template user gvg, UMask 0077, ProtectSystem=strict; probe 6 private paths 404 | ACL fixture chỉ sandbox; chưa Linux ownership/mode, WAL/SHM/upload/backup và Nginx temp permissions |
| Secret injection | Secret fixture ngẫu nhiên trong child env, không có trong child logs; không truyền args | Unit mẫu vẫn EnvironmentFile bền vững, trái yêu cầu vận hành P21 nếu dùng nguyên; phải thay bằng secret agent/tmpfs 0600 và thử failure/rotation |
| Dependencies | npm audit exit 0, 0 advisory mọi severity, gồm dev | Chưa clean Linux install/native smoke/Gitleaks/immutable build; test và untracked tree đang chặn CI |
| Staging access gate | Chỉ dùng loopback/fixture trong P24 | Mẫu Nginx chưa có VPN/IP/identity gate bảo vệ toàn bộ dashboard/API/upload |

## Toàn bộ test

**240 PASS / 9 FAIL / 0 skip / 0 cancelled**, runner exit 1. Đây là tổng checks
legacy cộng node:test (có tính parent), không phải 249 test độc lập. 15/20 suite
xanh. Migration 12/12, backup 5/5, release 13/13, observability 7/7,
deployment 3/3, security headers 3/3, session 16/16, concurrency 5/5 đều PASS.

9 FAIL gồm **5 lỗi gốc + 4 parent fail**:

| Lỗi gốc | Kết quả chính xác | Hành động |
|---|---|---|
| Auth CLI fixture (`test/auth-test.js:132`) | startup exited; PORT=0, thiếu TRUST_PROXY, chờ log cũ `http://localhost` | P15-Q1: config hợp lệ, chờ readiness/HTTP thật; giữ negative config tests |
| Gym workflow (`test/admin-xss-test.js:221`) | Timeout 7s chờ `#member-list .list-row`; POST avatar javascript trả 400 trước đó | P15-Q2/P23-Q1: assert rejection riêng, dùng input hợp lệ rồi đi hết create/edit/log |
| Dashboard visual (`test/dashboard-xss-test.js:80`) | Pixel mismatch `390 dashboard` | P15-Q3: điều tra geometry/font/pixels, không cập nhật baseline mù |
| Master visual (`test/master-xss-test.js:226`) | `390/edit`, 390×1664, maxDelta=2, changedPixels=21855 | P15-Q3: điều tra nguồn bất định; không nới tolerance để che lỗi |
| P22 stored XSS (`test/security-e2e-test.js:177`) | Timeout 30s chờ text payload visible; các bước sau chưa được chứng minh | Điều tra fixture/tab/rendering và chạy hết Gym/Dashboard/Master; timeout không chứng minh payload đã thực thi |

P22 suite 10 PASS/2 FAIL gồm parent. Không tự đánh dấu P22 DONE. Gym visual PASS
ở lượt này nhưng các failure lịch sử vẫn cần giải thích. Baseline visual còn phụ
thuộc `tmp/p06–p08`, và runner chỉ xét exit code nên clean checkout có thể skip mà
không chặn release: phải bổ sung gate không skip/baseline tái lập trước CI release.

## Tất cả vấn đề còn mở và điều kiện đóng

| Severity | ID | Vấn đề còn mở / điều kiện cần đạt |
|---|---|---|
| Critical | C-01 | `routes/master.js:269–280` vẫn ghi plaintext admin_code; phase C chưa scrub. Dừng plaintext mới, rehearsal scrub/idempotence/login/reset/revoke trên clone, phê duyệt rollout dữ liệu thật riêng. Không đọc DB thật để audit này. |
| High | H-05/P22 | 5 lỗi gốc trên; full runner phải 0 fail/skip, baseline tái lập, stored-XSS E2E hoàn tất; không coi failure là lỗ hổng XSS đã xác nhận. |
| High | H-01/P15-S1 | Gate staging toàn bộ route và bằng chứng TLS/redirect/proxy/firewall/permissions trên hạ tầng đích còn thiếu. |
| High | H-04 | Backup/schema/restore local đã PASS; còn snapshot DB+files đồng bộ, off-server encryption/recovery key, scheduling/retention/alert, restore dataset đại diện và RPO/RTO đầy đủ. |
| High | H-06 | `routes/gym-public.js:54` SELECT * members; cần quyết định audience/allowlist/retention và negative tests trước public dữ liệu thật. |
| Medium | M-04 | Protocol P21 có, nhưng chưa source commit/clean Linux build/provenance/registry/provider adapter/secret integration; cần rollback hai artifact thật cùng schema và restore khác schema trên staging cô lập. |
| Medium | M-01/P23-Q2 | WAL/FK/timeout/index/concurrency đã triển khai và test xanh; còn soak 30 phút ở 2× peak được chốt, NAT/proxy/backup/disk, một Node instance. Không còn blocker thiếu FK/timeout như baseline. |
| Medium | M-03 | Health/log/drain local xanh; chưa alert owner/delivery, collector retention/watchdog, SIGTERM/Linux thực. |
| Medium | M-05 | Audit 0 advisory; còn clean install/native modules trên CPU/libc đích, Gitleaks và quy trình cập nhật vận hành. |
| Low | P15-H1 | Early Host 400 thiếu security headers, headers edge errors chưa kiểm; sửa/test riêng. |
| Low | L-01/P23-Q3 | Safari/iOS thật, webfonts online, zoom/screen reader/contrast/touch QA còn mở; P23 Chrome/Edge/Firefox không thay thế chúng. |
| Low | L-02 | Metadata/owner, lint/format/coverage policy hoặc miễn trừ rõ ràng. |
| Low | L-03/H-02 residual | Upload mới có normalize/quota; ảnh legacy chưa normalize, orphan cleanup/season snapshot lifecycle và resource monitoring vận hành chưa hoàn tất. |

C-02/C-04/C-05, validation/body limit, upload mới và error privacy có regression
local xanh; không có bằng chứng mới để tuyên bố tất cả security đã được chứng nhận
trên production. Scan secret lịch sử P15 chỉ là bằng chứng lịch sử, P24 không chạy
lại Gitleaks hoặc scan DB thật. Không dùng bảng baseline cũ để nói framework migration,
CI protocol hoặc browser suite hiện vẫn chưa tồn tại.

Thứ tự tiếp theo: đóng C-01 và 5 regression failures; chốt privacy; dựng release
artifact/adapter/gate staging, xác minh toàn bộ hạ tầng và backup/rollback thật trên
staging; đóng hoặc có quyết định chấp nhận rõ cho residual Medium/Low; audit lại.
**Dừng trước mọi thao tác production/domain thật và chờ lệnh phê duyệt rõ ràng của
người dùng.** Kết quả local không cấp quyền go-live.

File P24: script rehearsal, checkpoint này, P24-RESULTS.json, PRODUCTION-READINESS.md,
bảng P24 trong PRODUCTION-GO-LIVE-PROMPTS.md. Không sửa runtime ứng dụng hoặc các test
fail để đổi kết quả. Commit đề xuất: `test(ops): record P24 rehearsal and production blockers`.
