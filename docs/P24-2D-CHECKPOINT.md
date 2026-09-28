# P24.2d — Screenshot readiness

2026-09-10. Completed the requested experiment; visual stability remains unresolved. No commit.

## Harness changes

- `test/screenshot-stability.js`: test-only global CSS disables animations/transitions and smooth scrolling; waits for Playwright networkidle (500ms without network connections, 7000ms timeout), document.fonts.ready, existing image decode completion, and two animation frames. Runs before every before/after capture in the Gym and Dashboard visual harnesses.
- `test/admin-xss-test.js` and `test/dashboard-xss-test.js`: import/call helper; optional VISUAL_CAPTURE_CASE selector restricts the existing capture loop to one width/view. Unset means the original complete loop. Screenshot options, Buffer equality assertions, fixtures, baseline JS and tolerances unchanged.
- Existing Date.now override to 2026-09-07T00:00:00Z is retained. Both current and baseline timeAgo functions use Date.now minus a Date constructed from the fixture timestamp; no additional Date mock is needed for these relative-time displays.
- Existing changes to the Gym real-session test, Auth test and production-prompts document were preserved. Master and other tests/product files were not edited.

## Execution and results

Command: `node tmp/p24-2d/collect.cjs`. The collector runs exactly three rounds, each containing Gym 390/members, Gym 390/member-edit and Dashboard 1440/dashboard in that order. Each case runs in a separate Node process using the existing visual leaf and parent name filters, skipping nonvisual siblings. This ensures a failed members case cannot prevent member-edit from running. No preliminary or additional visual run occurred.

- Round 1: PASS / PASS / PASS.
- Round 2: PASS / FAIL / FAIL.
- Round 3: PASS / PASS / FAIL.
- Total: 6 PASS / 3 FAIL case observations. Each Node invocation reports one leaf plus its parent, no skipped or cancelled tests.
- Round 2 Gym 390/member-edit: 5002 differing RGBA pixels, inclusive bbox [0,255,389,636], identical count and bbox to P24.2c.
- Round 2 Dashboard 1440/dashboard: 58404 pixels, bbox [0,255,1439,935], identical count and bbox to P24.2c.
- Round 3 Dashboard 1440/dashboard: 58404 pixels, bbox [0,255,1439,935], identical count and bbox to P24.2c.

Full regression was not run because the all-nine-PASS condition was not met. There is no new full-suite result to compare with P24.2b's 256 PASS / 2 FAIL. All observed failing cases had failed previously; untested cases cannot be assessed for new regressions.

Logs and fresh before/after captures are retained under tmp/p24-2d/run-N; results.json contains the nine results. Metrics were computed offline with Sharp, counting a pixel once if any RGBA channel differs; screenshot modification times were checked against each invocation start to reject stale captures. These metrics do not replace the original Buffer equality assertion. No image masks or IoU were recalculated.

## Uncertainty and limits

- Repeated pixel counts/bboxes do not prove a race condition; root cause remains unconfirmed. Added readiness waits did not eliminate the failures.
- Network idle and two animation frames do not prove all application state remains stable afterwards; Dashboard still has its existing 15-second polling timer.
- Existing routing aborts external resources, including remote fonts. fonts.ready waits for available/fallback fonts; it does not cause blocked fonts to load. Existing image decode failures remain ignored as before.
- Each target uses a fresh browser process, so the run does not reproduce the preceding-view history or full-suite workload of P24.2c.
- Three observations per case are insufficient to establish long-term stability, including Gym members with three passes.
- No full regression means no assurance about side effects on untested cases. git diff --check passed; Git emitted only LF-to-CRLF normalization warnings.

Requested bounded experiment DONE; stabilization objective unresolved. No baseline, product, assertion or tolerance changes; no commit.
