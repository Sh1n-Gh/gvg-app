# P24.2f — DOM/computed-state bbox diagnostic

2026-09-10. One execution per requested case; no reruns, fixes or commits.

## Capture and result

Command: `node tmp/p24-2f/collect.cjs`. Gym 390/member-edit and Dashboard 1440/dashboard both PASS, exit 0, zero differing RGBA pixels. Fresh PNG modification times checked. Existing screenshot options, readiness, fixture, Date.now override and Buffer equality assertions unchanged. Polling uses default behavior (P24.2e freeze switch unset).

Temporary opt-in `test/bbox-diagnostic.js` is called immediately before each screenshot. It reads outerHTML, all enumerated computed properties (including ::before/::after), viewport rectangles, input values, image state, focus, scroll and nine coordinate hit stacks. No DOM writes or additional waits. Coverage: 22 Gym and 57 Dashboard elements intersecting historical document-coordinate bboxes [0,255,389,636] and [0,255,1439,935], including ancestors. Ancestor HTML also includes hidden/out-of-region descendants. Dashboard y=935 is outside the 900px viewport, so hit testing returns empty there; rectangle intersection still captures elements at that document coordinate without scrolling.

Artifacts: `tmp/p24-2f/results.json`; `tmp/p24-2f/run-1/{Gym/390-member-edit,Dashboard/1440-dashboard}/` contains test.log, before/after PNG, before/after.json, before/after.html and diff.json. `diff.cjs` compares captures by structural selector and reports exact field values; `html.cjs` extracts focused HTML text. Eight Gym and thirty Dashboard differences are all outerHTML fields, with ancestor duplication. Zero differences in other captured fields.

## Exact observed differences

- Gym: `#member-list .member-view-row.hidden .member-inline img`: `<img src="/assets/pokemon-types/fire.svg" class="avatar-sm" alt="">` becomes `<img class="avatar-sm" src="http://admin.test/assets/pokemon-types/fire.svg" alt="">`. This image is in the hidden view row, captured through its visible ancestor. The visible edit inputs and their state match. Coordinate (194,636) hits the second input in `.member-edit-row`; (194,255) hits `#change-password-btn`; (194,445) hits `#open-switch-wizard`.
- Dashboard: `#map-grid .map-card-avatar img` src changes from `/assets/pokemon-types/fire.svg` to `http://dashboard.test/assets/pokemon-types/fire.svg`; overview avatars show the same URL normalization and class/src attribute-order difference. `.type-icon` swaps alt/title attribute order. `.game-bar-fill` inline attribute changes `width:45%` to `width: 45%;`. Map-card inter-element whitespace disappears. Element order, computed styles (including colors, transform and z-index), geometry and resolved image state match.

## Code origin, without causal claim

- `public/admin.js:25-30` builds avatars with DOM nodes and imageUrl, compared with `tmp/p07/admin-before.js:8-9` string interpolation. `public/admin.js:12-17` imageUrl resolves relative URLs against window.location.href. `public/admin.js:147` inserts the avatar in the hidden member view row.
- `public/dashboard.js:12-17,25-30` normalizes URLs and builds avatars; `:91-112` constructs map cards with DOM nodes, sets attributes and assigns `fill.style.width`. Baseline `tmp/p06/dashboard-before.js:66-76` uses a whitespace-containing HTML template and literal inline style. These explain the observed serialization differences, not intermittent pixel failure.
- Searched relevant current/baseline admin and dashboard scripts plus admin-utils for Math.random, Date.now, crypto.randomUUID, Object.keys and new Map. No Math.random/randomUUID/Object.keys matches. Date.now is used for relative-time text, not keys/IDs, and is already fixed by the harness. Map usage is present for cell lookups/totals and filter data; no element-order difference was observed. No nondeterministic source established.

## Limits and disposition

No fix proposed: evidence is insufficient. Both captures pass, so these HTML differences coexist with exact pixel equality. This does not establish a rendering-engine defect or explain earlier failures. DOM capture and screenshot are adjacent asynchronous calls, not an atomic browser snapshot; observation adds execution time. No extra behavioral hypothesis or rerun was introduced.

DONE for the bounded capture/diff request; root cause remains undetermined. Only diagnostic hooks/helper and this report added during this session; prior edits preserved. No assertion, baseline, tolerance or production change. git diff --check passed (line-ending warnings only).

