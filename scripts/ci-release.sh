#!/usr/bin/env bash
# Run only in a disposable, trusted Linux runner matching the deployment platform.
set -euo pipefail
umask 077
test "$(node --version)" = v24.19.0
test "$(npm --version)" = 11.17.0
test -z "$(git status --porcelain)"
command -v gitleaks >/dev/null
# Runner supplies pinned Gitleaks; redacted output, no reports uploaded.
gitleaks git --redact --no-banner
npm ci --no-fund
npx --no-install playwright install --with-deps chromium
node scripts/test-ci.js
npm audit --audit-level=low
npm ls --omit=dev
node scripts/package-release.js
