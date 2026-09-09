# Deployment — P12 (cấu hình mẫu, chưa deploy)

P21: quy trình release/rollback và secret store mới tại [RELEASE-RUNBOOK.md](RELEASE-RUNBOOK.md).
Áp dụng quy định secret store của P21 thay cho EnvironmentFile bền vững trong mẫu P12.

P19: baseline production **Node 24.19.0 / npm 11.17.0**; dùng lockfile đã review và chạy lại audit trước mỗi release. Chính sách cập nhật, phạm vi tương thích và yêu cầu clean install/native smoke trên máy đích: [P19-CHECKPOINT.md](P19-CHECKPOINT.md). Audit local PASS không thay quyết định NO-GO P15.

P16: trước startup production, thực hiện schema migration offline theo [MIGRATIONS.md](MIGRATIONS.md), với backup hook bắt buộc. Không chạy `db/schema.sql` hoặc dùng startup/auth:migrate để nâng schema production. Backup provider/restore vẫn chờ P17.

Chọn **Nginx** vì có sẵn giới hạn body, request/connection và virtual host từ chối domain lạ. Kiến trúc duy nhất của mẫu: Internet → Nginx TLS → `127.0.0.1:3000` → một Node process/SQLite trên cùng máy Linux. Chưa có thông tin server/domain thật. Không áp dụng nguyên mẫu cho Docker, CDN hoặc load balancer; các mô hình đó cần rà lại IP tin cậy.

## Giá trị người vận hành phải điền

| Giá trị | Nơi dùng / yêu cầu |
|---|---|
| Domain chuẩn thay `gvg.example.invalid` | Tất cả vị trí trong `deploy/nginx.conf.example`; không wildcard/alias mặc định |
| `PUBLIC_ORIGIN=https://<domain>` | Không slash cuối, chỉ HTTPS port 443; đây cũng là allowlist Host production |
| IPv4/IPv6 server, IP/VPN quản trị, SSH port | DNS và firewall; không suy đoán từ máy local |
| Certificate fullchain/private key, ACME account/email | Điền đường dẫn TLS; private key chỉ root/ACME đọc |
| `NODE_ENV=production`, `TRUST_PROXY=127.0.0.1`, `PORT=3000` | Bắt buộc đúng topology; nếu đổi port phải đổi upstream tương ứng |
| `DB_PATH=/var/lib/gvg/gvg.db` | File tuyệt đối ngoài source/public; thư mục cần cho SQLite WAL/SHM |
| `SESSION_SECRETS`, `AUTH_RATE_LIMIT_SECRET` | Secret riêng từ secret store, theo `.env.example`; không dùng placeholder |
| Bootstrap/migration/recovery và backup path | Theo AUTH-DESIGN/checkpoint P03–P05; chạy offline theo quy trình được duyệt |
| Node binary, app path, service user/group | Mẫu `/usr/bin/node`, `/srv/gvg/app`, `gvg:gvg`; đối chiếu `.node-version` và package engines |
| Backup location, người nhận cảnh báo TLS, CSP image origins | Backup ngoài public, off-server riêng; CSP chỉ origin ảnh thật được duyệt |

## TLS và Nginx

`deploy/nginx.conf.example` là fragment đặt trong `http {}` (ví dụ conf.d), không phải nginx.conf hoàn chỉnh. Rà cấu hình default site hiện hữu, tránh trùng default_server. Dùng bản Nginx còn được vá bảo mật, hỗ trợ `ssl_reject_handshake` (>=1.19.4). Không có root/alias vào repository; toàn bộ nội dung app đi qua Node, vốn chỉ static từ `public/`. Source backend không public; JS/CSS frontend trong public là tài nguyên chủ ý công khai.

HTTP domain hợp lệ redirect 308 tới HTTPS domain cố định (giữ path/query); host khác bị đóng kết nối. TLS chỉ 1.2/1.3, SNI không khớp bị từ chối. Mẫu ghi đè Host, X-Forwarded-Host/Proto/For/Port và X-Real-IP, xóa Forwarded; không nối thêm XFF do client cung cấp. Express production chỉ tin `127.0.0.1` và kiểm tra cả raw Host lẫn forwarded Host. Local không áp allowlist, mặc định không tin proxy; HOST có thể dùng cho development LAN, production luôn bind localhost.

Body mặc định 128 KiB, raw upload `/master/map-images` 5 MiB (cả case/trailing slash tương thích Express); auth vẫn giới hạn 8 KiB ở Node. Nginx giới hạn 10 request/giây/IP, burst 60 và 20 connection/IP, trả 429; Node giữ các quota auth/read/mutation/upload của P09. Điều chỉnh bằng đo tải/NAT thực tế ở P23. Timeout body/header là thời gian không có dữ liệu, không phải deadline tổng. Lỗi Nginx có thể là HTML; không cache response session/API. HSTS của P11 do Node phát khi HTTPS production, không bật preload/includeSubDomains tự động.

Ưu tiên ACME DNS-01 để lấy chứng chỉ trước khi bật site (token DNS tối thiểu quyền, chỉ cấp cho ACME, không cho Node). Mẫu không mở endpoint HTTP-01. Nếu chọn HTTP-01 cần thiết kế webroot challenge riêng ngoài repository trước; không chạy standalone chiếm port trên server hiện hữu. Thiết lập renewal tự động, thử renewal bằng môi trường staging CA, reload Nginx chỉ sau `nginx -t` thành công và giám sát expiry. Không kích hoạt mẫu khi cert chưa tồn tại.

## Service, filesystem và dữ liệu riêng tư

Mẫu `deploy/gvg.service.example` dùng Linux/systemd, user `gvg` không login/sudo, không chạy Node bằng root. Chỉ chạy một instance. EnvironmentFile `/etc/gvg/gvg.env` root:root mode 0600, thư mục 0700; systemd đọc file và truyền env cho service. Không đặt .env trong public hoặc artifact phát hành. Không in env/secret vào log. Không để secret bootstrap tồn tại sau khi hoàn tất migration theo quy trình auth.

Source `/srv/gvg/app` root:gvg, thư mục 0750/file 0640; gvg chỉ đọc, script không cần executable nếu gọi bằng node. Chỉ cấp ghi cho `/var/lib/gvg` (gvg:gvg 0700, DB/WAL/SHM 0600), `public/uploads/map-images` và `season-configs` (gvg:gvg 0700, file 0600). Hai thư mục sau là đường dẫn ghi runtime hiện có; phải tạo trước khởi động để ReadWritePaths hoạt động. Chỉ ảnh runtime thuộc uploads, không đặt DB/backup/source/.env vào public. Không tạo symlink trong public dẫn ra dữ liệu riêng tư. Kiểm kê nội dung public trước release, không sao chép toàn repository vào webroot.

Backup đặt ngoài app, ví dụ `/var/backups/gvg`, 0700 với tài khoản backup riêng; không cấp Node quyền đọc backup nếu không cần. SQLite cần snapshot nhất quán với WAL, không copy DB đang ghi tùy tiện; restore/retention được xử lý ở P17. Nginx worker không cần đọc source, DB, env hay upload trực tiếp. Thư mục body/proxy temp của Nginx phải riêng tư với worker (0700), không nằm trong webroot; body upload có thể được buffer xuống disk. Service mẫu dùng UMask 0077, ProtectSystem=strict và chỉ cho ghi các đường dẫn runtime. Rà quyền sau khi copy/restore; không chmod 777.

## Firewall và checklist DNS (chỉ hướng dẫn, chưa thực hiện)

- [ ] Xác nhận quyền sở hữu domain, zone/provider và IP server; A trỏ IPv4 đúng. Chỉ thêm AAAA nếu IPv6/TLS/firewall được kiểm tra đầy đủ; xóa/điều chỉnh record cũ theo kế hoạch được duyệt.
- [ ] Kiểm tra CAA cho CA đã chọn, DNS propagation/TTL và SAN của cert đúng domain. Alias www không được hỗ trợ nếu chưa cấu hình riêng.
- [ ] Trước thay đổi firewall, có console cứu hộ; giữ SSH chỉ từ IP quản trị/VPN. Inbound mặc định deny trên cả host firewall và security group, IPv4 lẫn IPv6; chỉ TCP 80/443 public. Không public 3000, database hoặc service nội bộ; không thêm NAT/port-forward Node.
- [ ] Kiểm tra listener với `ss -lntp`: Node chỉ `127.0.0.1:3000`; firewall không thay thế bind localhost. Không có process/root webserver khác phục vụ repository.
- [ ] Đánh giá quyền file, dung lượng temp/upload/DB và khả năng ghi của service user trước start. Không chỉnh quyền trên dữ liệu thật khi chưa duyệt rollout.

## Xác minh trên staging sau khi được phép

1. Điền mọi placeholder, kiểm tra nginx -t và systemd-analyze verify với bản cấu hình thực tế; chưa reload nếu thất bại. Chuẩn bị backup/migration/auth trước service start, không tự khởi tạo DB production mới vì nhầm đường dẫn.
2. HTTP domain chuẩn trả 308 tới domain cố định; host lạ bị chặn, SNI lạ không bắt tay. HTTPS chứng chỉ hợp lệ/đủ chain, renewal thử thành công.
3. Thử request có Host lạ (cả khi SNI đúng), XFF/XFH/XFP giả: bị chặn hoặc bị proxy ghi đè; hai client thật có IP/rate budget riêng. Localhost là ranh giới tin cậy: không chạy workload không tin cậy cùng máy.
4. Kiểm tra login/logout, Secure/HttpOnly/SameSite cookie, CSRF, CSP và HSTS; HTTP không nhận cookie Secure. Upload hợp lệ hoạt động, >5 MiB và JSON >128 KiB trả 413, auth >8 KiB bị Node chặn; kiểm tra cả body chunked và 429.
5. Từ mạng ngoài, Node port không kết nối được; `/.env`, `/.git/config`, `/server.js`, `/package.json`, `/db/gvg.db`, `/backups/backup.db`, `/season-configs/...` không trả file. Kiểm tra GET/HEAD/encoded traversal và các file nhạy cảm thực sự được đóng gói.
6. Ghi bằng chứng TLS/firewall/DNS/permissions và kết quả test trước quyết định go-live. P10 vẫn BLOCKED; P12 không phải phê duyệt production.

## Nguồn kỹ thuật

- [Express behind proxies](https://expressjs.com/en/guide/behind-proxies/): trust proxy và ghi đè forwarding headers.
- [Nginx proxy](https://nginx.org/en/docs/http/ngx_http_proxy_module.html), [body limits](https://nginx.org/en/docs/http/ngx_http_core_module.html#client_max_body_size), [rate limits](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html), [TLS](https://nginx.org/en/docs/http/ngx_http_ssl_module.html).

## P20 — Observability và dừng service

Xem [OBSERVABILITY.md](OBSERVABILITY.md): JSON stdout redacted, Host cho /health và /ready, drain SIGTERM/SIGINT, deadline 30s và systemd TimeoutStopSec 45s. Mẫu Nginx dùng access schema tối thiểu và bỏ raw error log chứa request data. Cấu hình retention/collector/alert owner và thử delivery, SIGTERM trên staging trước GO.
