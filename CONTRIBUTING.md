# Contributing to Pine Launcher

Thanks for improving Pine. Keep changes focused, preserve user data compatibility, and do not bump the version unless the maintainer explicitly requests it.

## Development

Use Node.js 22.12 or newer:

```bash
npm ci
npm test
npm run dev
```

Before submitting a change, run `npm test` and check that no credentials, user data, build output, or local settings were added. Changes to downloads, archives, paths, authentication, IPC, updates, deletion, backup, or restore behavior should include a regression test.

## Pull requests

Describe the user-visible result, platforms tested, risks, and rollback behavior. Keep unrelated formatting churn out of the change. UI changes should remain usable by keyboard and with reduced motion enabled.

Report security problems according to [SECURITY.md](SECURITY.md), not through a public issue.
