# P24.2e — Dashboard polling isolation

2026-09-10. Bounded experiment DONE; no commit or production/baseline/tolerance changes.

## Mechanism

public/dashboard.js:343-344 calls loadState immediately and registers setInterval(loadState, 15000). Baseline tmp/p06/dashboard-before.js:306 uses the same interval. No recursive timeout or websocket drives this refresh. loadState (line 64) requests /g/test/state, updates header and Dashboard data DOM, then awaits /g/test/overview (line 206). Map cards are replaced and score/ticket tables rebuilt even for identical data. The whole document and other tabs are not rebuilt. The async interval has no in-flight guard.

## Test-only intervention

An opt-in VISUAL_FREEZE_DASHBOARD_POLLING=1 switch in test/dashboard-xss-test.js installs an init script before navigation on both baseline and current pages. It intercepts only setInterval whose callback name is loadState and delay is 15000, records the blocked registration and does not schedule it. Other timers and initial loadState remain intact. Each capture asserts exactly one matching registration and exactly one state and one overview request. Logs confirm these assertions for all six captures. The probe callbacks field is an initialized constant, not independent callback instrumentation; evidence is the unscheduled registration and request counts.

P24.2d readiness waits, fixture, Date.now override, full-page screenshot options and Buffer equality assertion are unchanged. No endpoint failure response is introduced.

Command: node tmp/p24-2e/collect.cjs

The collector launches exactly three independent Node/browser runs, selecting only Dashboard 1440/dashboard and its visual leaf. No Gym or full regression executions. Parent/leaf TAP counts describe the same case, not two independent observations.

## Results

| Run | Result | Differing RGBA pixels | Inclusive bbox |
|---|---|---|---|
| 1 | PASS | 0 | none |
| 2 | FAIL | 58404 | [0,255,1439,935] |
| 3 | FAIL | 58404 | [0,255,1439,935] |

Both failures match P24.2c/d pixel count and bbox exactly. Fresh screenshot mtimes were checked by the collector; pixels count once when any RGBA channel differs. Logs and before/after PNGs: tmp/p24-2e/run-N/Dashboard/1440-dashboard/. Machine-readable results: tmp/p24-2e/results.json.

Polling is not necessary to reproduce this failure, so this experiment does not confirm polling as its cause. It does not establish the actual cause or rule out every possible polling effect in other circumstances.

## Gym 390/member-edit code inspection

The Gym test setup (test/admin-xss-test.js:33) serves public/dashboard.html, which includes dashboard.js and admin.js at lines 177-178. Thus the same 15-second Dashboard polling exists in the Gym page even with the admin tab selected; loadState does not check the active tab. Its DOM targets are Dashboard data, not member-list.

No setInterval, setTimeout, requestAnimationFrame, debounce or WebSocket is present in public/admin.js, admin-utils.js, auth-client.js, or the baseline tmp/p07/admin-before.js. The member-edit handler (public/admin.js:174; baseline:147) synchronously hides the view row, reveals the edit row, and focuses mem-avatar. No delayed rendering is scheduled by this click. loadMembers (line 141) is asynchronous and replaces member-list after the API response; loadAll (line 54) runs after authentication or successful mutations and also calls refreshGymOverview. This is request-completion-driven rendering, not periodic member polling. auth-client.js restores on persisted pageshow; it explicitly avoids session polling.

No Gym changes or additional measurements were made. Focus/browser scrolling or other causes remain untested; no causal conclusion is drawn from them.

## Scope checks

Only test/dashboard-xss-test.js was edited for the experiment, with this checkpoint and tmp artifacts added. Previously existing edits were preserved. git diff --check passed (LF/CRLF warnings only). No production edits, baseline updates, tolerance relaxation, permanent fix, or commit.
