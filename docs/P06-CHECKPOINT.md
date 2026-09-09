# P06 — Dashboard XSS checkpoint

Completed 2026-09-07. Runtime changes: public/dashboard.js and the directly used public/pokemon-types.js helper. Added test/dashboard-xss-test.js and updated the P06 status. No CSS, HTML, Admin, API or database changes. Initial source tree was entirely untracked; no commit made.

## Complete sink inventory (before changes)

13 innerHTML assignments; no insertAdjacentHTML. Database/user-controlled fields arrive through public APIs.

| # | Function / target | Source and mitigation |
|---|---|---|
| 1 | renderDashboard / empty map-grid | Constant empty message, retained |
| 2 | renderDashboard / maps | /state: name, image_url, type_weakness, progress, points; now DOM/textContent, URL allowlist, finite progress clamped 0–100 |
| 3 | renderScoreOverview / empty | Constant message, retained |
| 4 | renderScoreOverview / table | /overview: member/Map names, titles, avatars; escaped text/quoted attributes, DOM-built images; points converted with Number/fmt |
| 5 | renderTicketOverview / empty | Constant message, retained |
| 6 | renderTicketOverview / table | /overview: Map names, rounds, ticket strings and titles escaped; totals converted with Number |
| 7 | loadOverview / score error | API error.message now p + textContent |
| 8 | loadOverview / ticket error | Same as above |
| 9 | loadLeaderboard / list | /leaderboard: name escaped, avatar built with DOM; numeric fields Number/fmt; boolean-selected classes/badges are constants |
| 10 | setPublicLogFilterOptions / select | /log: member/map IDs/names and rounds; now option DOM nodes, value property and textContent; placeholder internal |
| 11 | renderPublicLog / empty | Constant message, retained |
| 12 | renderPublicLog / list | /log: member/Map names, avatars, rounds, tickets escaped or DOM-built; points/time numerically converted |
| 13 | loadSeasons / list | /seasons: season_name escaped, score converted to number, badge constant |

After changes: 9 innerHTML assignments (4 constant empty messages, 5 table/list templates). Templates retain existing nested markup/classes/whitespace for layout stability. Untrusted scalar values are escaped in text or quoted attributes; nested HTML fragments come only from internal templates and serialized DOM-built avatars. No user-supplied HTML fragments.

avatarHtml previously interpolated URL/fallback directly; now creates img/div through DOM and fallback through textContent. overviewMapHeaderHtml escapes Map names. scoreHeatStyle produces arithmetic numbers and fixed colors only. pokemonTypeIconHtml maps database type to internal asset/label with default constant class; normalizePokemonType now uses Object.hasOwn to reject prototype keys. admin-utils.js/filterAdminLogRows only filters data and has no sinks; unchanged. Gym/season headings, round-chip and loadState errors already use textContent.

## URL policy

Only valid HTTP(S) URLs and relative paths resolved against the page URL. Reject control/whitespace, quotes, angle brackets, backticks, backslashes, credentials, malformed URLs, javascript:, all data: (HTML/SVG/PNG included), blob: and file:. Rejected images use existing fallback. Internal Pokemon SVG icons remain img assets, never API-provided inline SVG.

## Verification

- node --test test/dashboard-xss-test.js: 5 PASS / 0 FAIL (4 subtests + parent).
- node test/frontend-ux-test.js: 41 PASS / 0 FAIL.
- node --test test/frontend-session-test.js: 5 PASS / 0 FAIL (4 subtests + parent), Gym/Master and cross-tenant regression.

Security coverage: escape roundtrips ampersand/brackets/quotes in text and attributes; URL allow/deny cases and prototype keys; malicious member/Map/season names through every public renderer; avatar URLs, fallback, filter IDs, rounds/tickets; API overview/state errors. Assert literal text, no injected nodes/event handlers, no payload execution.

Visual comparison: 12 before/after screenshot pairs, four public tabs at widths 390, 768, 1440 px. All pixel-identical (PNG bytes equal) with screenshot animations disabled. Visually inspected mobile Dashboard and desktop leaderboard. Source baseline and images are local in tmp/p06/ (ignored). Uses deterministic API fixtures, local images, Edge headless and blocked external fonts; not a full production-data/cross-browser QA. Without the local baseline, visual subtest explicitly skips while XSS tests still run. To compare another change, save pre-edit dashboard.js as tmp/p06/dashboard-before.js first.

## Scope and next step

P06 DONE; stop here. P07/P08 cover Admin XSS, P11 CSP, P13 upload content/MIME checks. Dashboard URL validation does not validate uploaded file contents. Full backend suite intentionally not run on this non-checkpoint day.

Suggested commit: fix(dashboard): prevent XSS in public rendering and image URLs
