# Security Policy

## Release Token Safety

AI Model Workbench releases should use GitHub Actions with the repository `GITHUB_TOKEN`.
Do not paste personal access tokens into issues, pull requests, chats, release notes, or
local scripts. The release workflow only needs repository-scoped automation permissions
from GitHub Actions.

Before publishing a release:

- Confirm the tag has no `v` prefix, for example `0.3.1`.
- Run `npm run verify:release` and review asset sizes plus SHA-256 hashes.
- Run `rg -n 'gh[p]_|github_[p]at_' . --glob '!node_modules/**' --glob '!.git/**' --glob '!.tmp/**' --glob '!main.js'`.
- Prefer `gh auth status` or the GitHub web UI for credential checks; never print token values.

If a token is exposed:

- Revoke it immediately in GitHub settings.
- Rotate any automation or local credential that used the same token.
- Audit recent repository actions, releases, and workflow runs.
- Re-run the token scan before the next commit or release.

## Reporting

For private vulnerability reports, use GitHub private vulnerability reporting if enabled
on the repository, or contact the maintainer through the repository profile.
