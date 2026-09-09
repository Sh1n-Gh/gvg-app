# P12 checkpoint — HTTPS, reverse proxy, domain

Ngày thực hiện: 08/09/2026. Phạm vi: mẫu Linux/Nginx/systemd, không server/domain thật, không deploy.

- `deploy/nginx.conf.example`: HTTP 308 domain cố định, TLS 1.2/1.3, default deny Host/SNI, localhost upstream, body/request/connection limits, ghi đè proxy headers, không root/alias source.
- `deploy/gvg.service.example`: user gvg, env riêng tư, read-only source, quyền ghi runtime tối thiểu.
- `security/deployment.js`, `server.js`: production fail-fast khi topology/origin sai, allowlist raw Host và forwarded Host từ PUBLIC_ORIGIN; Node production bắt buộc bind 127.0.0.1. Local không áp allowlist, HOST tùy chọn cho LAN.
- `.env.example`, `docs/DEPLOYMENT.md`: giá trị phải điền, TLS/renewal, DNS/firewall/user/permissions, kiểm tra staging và bảo vệ DB/backup/secret.
- `test/deployment-test.js`: config invalid, bind, Host spoofing, client IP/protocol, local và private file paths. `test/session-test.js` mô phỏng forwarding headers từ proxy thay cho socket encrypted. `package.json`: thêm test:p12.

Lượt đầu: 26 PASS/2 FAIL do test dùng fetch không truyền được Host tùy chỉnh trên Node hiện tại và fixture production cũ thiếu topology mới. Đã chuyển Host test sang node:http và cập nhật fixture proxy; không nới kiểm soát production để làm test pass.

Giới hạn: không có Nginx trong môi trường này, chưa chạy nginx -t, TLS handshake/renewal, systemd verify, firewall/DNS hoặc staging thật. Cấu hình cần người dùng điền và kiểm tra theo DEPLOYMENT trước áp dụng. Không đọc/sửa DB hoặc secret production, không commit, không mở port public, không đổi DNS. Test chỉ dùng loopback và DB test.

P10 vẫn BLOCKED/NO-GO; P12 hoàn thành phạm vi cấu hình mẫu, không chứng nhận production sẵn sàng. Dừng tại P12, chưa làm P13.

Commit đề xuất: `feat(security): add production localhost proxy and HTTPS deployment templates`

Kết quả cuối: `npm run test:p12` — **28 PASS, 0 FAIL, 0 SKIP** (deployment, request security, headers/CSP browser, session). Không chạy full suite ngoài phạm vi checkpoint.
