# Changelog

## 1.0.0 (2026-11-02)

- Initial release: CLI and library to delete local branches whose upstream is gone.
- Dry run by default. `--delete`, `--force`, `--no-fetch`, `--remote`, `--protect`, `--json`, `--quiet`.
- Protects main, master, develop, and the checked-out branch.
- ESM and CommonJS builds with TypeScript types. Node 18+.
