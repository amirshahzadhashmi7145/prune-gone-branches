# Changelog

## 1.1.0 (2026-11-16)

- Detects squash-merged and rebase-merged branches. `--delete` now removes them without `--force`, which is only needed for work that is really unmerged.
- Each gone branch has a `status`: `merged`, `squashed`, `rebased` or `unmerged`. The dry run prints it.
- Branches are compared against the remote's default branch, so a stale local `main` or a different checked-out branch no longer makes merged branches look unmerged.
- New options: `--base <ref>` / `base`, `--no-squashed` / `squashed: false`. New exports: `branchStatus`, `resolveBase`, `BranchStatus`.

## 1.0.0 (2026-11-02)

- Initial release: CLI and library to delete local branches whose upstream is gone.
- Dry run by default. `--delete`, `--force`, `--no-fetch`, `--remote`, `--protect`, `--json`, `--quiet`.
- Protects main, master, develop, and the checked-out branch.
- ESM and CommonJS builds with TypeScript types. Node 18+.
