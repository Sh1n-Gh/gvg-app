# P19 — Dependency audit

Thực hiện 08/09/2026 (Asia/Bangkok); ngày 02/10 trong kế hoạch là lịch dự kiến. **DONE: dependency production không còn advisory do npm registry báo tại thời điểm kiểm tra.** Đây là gate dependency, không phải quyết định GO; P10/P15 vẫn BLOCKED.

## Kiểm tra và thay đổi

Registry duy nhất: `https://registry.npmjs.org`. Runtime local: Node **24.19.0**, npm **11.17.0**. Working tree ban đầu là source untracked; không commit hoặc ghi đè công việc khác. Lưu bản package/lock trước thay đổi tại `tmp/p19/` (ignored).

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org --json
npm outdated --registry=https://registry.npmjs.org --cache=tmp/p19/npm-cache --json
npm view qs version engines --registry=https://registry.npmjs.org --cache=tmp/p19/npm-cache --json
npm update qs --ignore-scripts --registry=https://registry.npmjs.org --cache=tmp/p19/npm-cache
npm run test:p09
npm audit --omit=dev --registry=https://registry.npmjs.org --cache=tmp/p19/npm-cache --json
npm outdated --all --omit=dev --registry=https://registry.npmjs.org --cache=tmp/p19/npm-cache --json
```

Lượt outdated đầu dùng cache mặc định lỗi EPERM; chạy lại với cache trong workspace thành công (exit 1 biểu thị có outdated, không phải lỗi registry). Không dùng audit fix hoặc force, không xóa/tạo lại lockfile. Một nhóm duy nhất: **qs 6.15.3 → 6.16.0**, dùng range hiện có của Express/body-parser, không override. So sánh toàn bộ `packages` trong hai lock JSON xác nhận chỉ entry `node_modules/qs` đổi; `package.json` giữ nguyên byte. Registry trả qs latest 6.16.0; engines >=0.6, tương thích runtime đã chốt.

## Đánh giá từng advisory trước vá

Audit trước: **3 package moderate, 0 high/critical**, nhưng chỉ **2 advisory độc lập**. Chuỗi: express 5.2.1 → qs 6.15.3 và express → body-parser 2.3.0 → cùng qs deduped. Các dòng express/body-parser là ảnh hưởng lan truyền, không phải lỗi thứ ba/thứ tư. `fixAvailable: false` ở một số dòng không chứng minh không có bản vá; registry và advisory đều có 6.16.0.

| Advisory | Điều kiện và ảnh hưởng thực tế | Quyết định |
|---|---|---|
| [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx), CVE-2026-82562; qs >=6.14.2 <=6.15.3; moderate | Bypass giới hạn mảng với bracket key khi `comma: true`, có thể gây cạn bộ nhớ. Express mặc định parser `simple` (`node_modules/express/lib/application.js:97`); app không override, không gọi qs.parse, không bật comma. `server.js:27`–`:53` chỉ nhận JSON/raw PNG/JPEG và từ chối form, không cài urlencoded middleware. Không tìm thấy đường HTTP hiện tại kích hoạt điều kiện này. | Không chặn deploy theo reachability hiện tại; vẫn vá ngay để loại dependency lỗi và tránh rủi ro khi đổi parser. |
| [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g), CVE-2026-82417; qs >=2.2.5 <6.16.0; moderate | Object do client điều khiển có constructor.isBuffer không callable làm qs.stringify ném TypeError; có thể lỗi request hoặc crash nếu gọi ngoài error boundary. Không thấy qs.stringify/luồng parse → stringify trong server/auth/routes/security; Express/body-parser chỉ tham chiếu qs.parse. JSON body được nhận không tự tạo đường tới stringify. | Không thấy sink khai thác trong app hiện tại; vá cùng nhóm qs. Không coi rate limit hoặc error handler là bằng chứng loại trừ lỗi này. |

Hai lỗi được vá ở 6.16.0 theo nguồn advisory liên kết. Phân loại trên dựa vào code/cấu hình, không chạy payload gây cạn tài nguyên. Sau cập nhật: **audit exit 0; vulnerabilities = {}; info/low/moderate/high/critical đều 0**. Metadata: prod 84, dev 3, optional 29, total 114 (không cộng các nhóm vì có giao nhau).

## Outdated và phạm vi giữ nguyên

Năm dependency trực tiếp production đều không outdated: better-sqlite3 13.0.3, dotenv 17.4.2, express 5.2.1, express-session 1.19.0, sharp 0.35.4. Playwright dev: current/wanted 1.62.1, latest 1.63.0; để đợt QA/browser riêng.

Kiểm tra `--all --omit=dev` sau vá cho các entry đã cài dưới đây có current = wanted; không ép vượt range parent chỉ để bằng dist-tag latest:

| Transitive | Current / latest registry | Xử lý |
|---|---|---|
| content-disposition | 1.1.0 / 3.0.0 | Chờ parent tương thích major |
| content-type | 1.0.5 và 2.1.0 / 3.0.0 | Chờ Express/body-parser/negotiator/type-is |
| cookie | 0.7.2 / 2.0.1 | Chờ Express/session; test cookie khi nâng |
| debug; ipaddr.js; media-typer; raw-body | 2.6.9 / 4.4.3; 1.9.1 / 2.5.0; 1.1.1 / 2.0.0; 3.0.2 / 4.0.0 | Không override major |
| cookie-signature; ms | 1.0.7 / 1.2.2; 2.0.0 / 2.1.3 | Parent pin/range đang giữ; không có advisory sau vá |
| accepts; fresh | 2.0.0 / 1.3.8; 2.0.0 / 0.5.2 | latest tag thấp hơn current; không tự downgrade |

Output còn liệt kê optional Sharp cho OS/CPU khác thiếu `current`: đây là package không cài trên Windows hiện tại, không chứng minh outdated runtime. Hầu hết wanted=latest (Sharp 0.35.4/libvips 1.3.3); sharp-win32-ia32 wanted 0.35.4/latest 0.34.5 cũng không tự downgrade. fsevents wanted 2.3.2/latest 2.3.3 thuộc Playwright optional/dev, không phải runtime app. Native binaries cho Linux phải được clean-install/xác minh trên staging đích.

## Validation và giới hạn

Sau nhóm qs: `npm run test:p09` exit 0: **22 request-security/session + 50 Master HTTP smoke = 72 PASS, 0 FAIL, 0 skip**. Bao gồm JSON/form/body limits, auth/CSRF/cookie, proxy/rate limit, HTTP mutations/public reads và upload PNG. `npm ls --omit=dev` exit 0. Không chạy full suite vì đây không phải ngày checkpoint; lỗi fixture/visual P15 không được tuyên bố đã sửa.

Log local: `tmp/p19/audit-before.json`, `audit-after.json`, `outdated.json`, `outdated-production-after.json`, `tests.log`. Kết quả quan trọng đã ghi ở đây để không phụ thuộc file ignored. Chưa clean-install trên Linux/CI, chưa audit OS/container hoặc toàn bộ thư viện C nhúng trong native binaries; npm audit là snapshot advisory npm, không chứng minh không có lỗ hổng chưa công bố. Không thao tác DB thật hoặc deploy.

## Runtime production và lịch duy trì

- Baseline được dự án hỗ trợ/kiểm thử hiện tại: **Node 24.19.0 + npm 11.17.0**, dùng đúng cặp này để build/install. `.node-version` pin 24.19.0; engines hiện `>=24.7.0 <25` là khoảng tương thích kỹ thuật (crypto.argon2), không phải cam kết mọi patch cũ đủ an toàn. Không dùng Node 20/22/25/26 hoặc npm 12 cho release này khi chưa kiểm thử riêng.
- [Node release policy](https://nodejs.org/en/about/previous-releases) ưu tiên nhánh LTS cho production. `npm view npm@11.17.0 engines` trả `^20.17.0 || >=22.9.0`, bao gồm Node 24.19.0. npm báo latest 12.0.2; không tự nâng global major. Cặp baseline không được diễn giải là bản mới nhất mãi mãi.
- Mỗi thứ Hai: người duy trì release chạy audit production + outdated từ registry chính thức, đánh giá đường input/sink và lưu kết quả. Trước mỗi deploy: chạy lại audit trên lock của artifact; chặn Critical/High chưa xử lý và mọi advisory có đường khai thác thực tế ảnh hưởng bí mật/toàn vẹn/khả dụng, kể cả moderate. Registry lỗi thì chưa đạt gate.
- Tuần đầu mỗi tháng: cập nhật patch/minor theo nhóm nhỏ (HTTP/session; SQLite; Sharp; dev/browser tách riêng), giữ lock và test liên quan sau từng nhóm. Node 24 security patch/npm 11 cập nhật cùng review runtime; đổi pin sau khi test. Major nâng trong task riêng, đọc changelog và full regression/restore trên staging.
- Advisory khẩn: triage trong 24 giờ; bản vá/mitigation cho lỗi chặn deploy trước release tiếp theo, mục tiêu trong 48 giờ nếu khả thi. Kiểm tra lịch hỗ trợ Node mỗi quý và lập kế hoạch chuyển LTS trước EOL ít nhất 3 tháng. Đây là lịch đề xuất, chưa tạo automation.
- CI/staging P21/P24 phải chạy `npm ci --omit=dev` từ lock được review trên OS/CPU đích, xác minh load better-sqlite3/Sharp và smoke trước release; môi trường test riêng cài cả dev và chạy checkpoint đủ suite. Không dùng ignore-scripts cho clean install native runtime. M-05 còn phần CI/staging này, dù gate advisory P19 đã PASS.

Dừng tại P19. Commit đề xuất: `chore(deps): patch qs and document P19 production audit`.
