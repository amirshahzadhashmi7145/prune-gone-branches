# prune-gone-branches

[![npm version](https://img.shields.io/npm/v/prune-gone-branches.svg)](https://www.npmjs.com/package/prune-gone-branches)
[![CI](https://github.com/amirshahzadhashmi7145/prune-gone-branches/actions/workflows/ci.yml/badge.svg)](https://github.com/amirshahzadhashmi7145/prune-gone-branches/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/prune-gone-branches.svg)](./LICENSE)

Delete local git branches whose remote branch is gone. **Dry run by default**, never touches `main`, `master`, `develop`, or the branch you are on. Zero dependencies.

After a PR is merged and its branch deleted on GitHub, the local copy sticks around. A few weeks later you have forty of them. This tool finds every branch whose upstream reports `[gone]` and removes them in one go.

```
$ npx prune-gone-branches
Branches whose upstream is gone (3):
  feat/login-form   (a1b2c3d, was origin/feat/login-form)
  fix/typo          (e4f5a6b, was origin/fix/typo)
  chore/deps        (c7d8e9f, was origin/chore/deps)

Dry run. Re-run with --delete to remove them, add --force for unmerged branches.

$ npx prune-gone-branches --delete
Deleted feat/login-form
Deleted fix/typo
Deleted chore/deps
```

## Install

```sh
npm install -g prune-gone-branches
# or run without installing
npx prune-gone-branches
```

Requires Node 18 or newer and git on your PATH.

## CLI

```
prune-gone-branches [options]

  -d, --delete           Delete the branches (default is a dry run)
  -f, --force            Use "git branch -D" so unmerged branches are deleted too
      --no-fetch         Skip "git fetch --prune"
  -r, --remote <name>    Only consider branches tracking this remote
  -p, --protect <names>  Comma-separated names or patterns never to delete
                         (default: main,master,develop; pass "" to disable)
      --json             Print the result as JSON
  -q, --quiet            Print nothing; rely on the exit code
  -h, --help             Show help
  -v, --version          Show version
```

Exit codes: `0` nothing to do or every deletion succeeded, `1` dry run found branches or some deletions failed, `2` usage or git error.

### How it decides

1. Runs `git fetch --prune` so remote-tracking refs match the server. Skip with `--no-fetch`.
2. Lists local branches whose upstream tracking status is `[gone]`, meaning the branch was pushed and the remote branch has since been deleted.
3. Skips the checked-out branch and anything matching `--protect`.
4. With `--delete`, runs `git branch -d` on each. Git refuses unmerged branches, which the tool reports. Add `--force` to use `git branch -D`.

Branches that were never pushed are not touched. They have no upstream, so they cannot be "gone".

### Examples

```sh
# See what would be deleted
prune-gone-branches

# Delete merged ones, keep anything unmerged
prune-gone-branches -d

# Delete everything whose remote is gone, merged or not
prune-gone-branches -d -f

# Protect release branches too
prune-gone-branches -d -p "main,master,release/*"

# Only look at branches tracking a specific remote
prune-gone-branches -d -r origin
```

### Git alias

```sh
git config --global alias.gone '!npx prune-gone-branches'
# then
git gone        # dry run
git gone -d     # delete
```

## Programmatic API

```ts
import { findGoneBranches, pruneGoneBranches } from "prune-gone-branches";

const { gone, skipped } = findGoneBranches({ cwd: "/path/to/repo" });
// gone: [{ name, upstream, sha }], skipped: [{ name, reason }]

const result = pruneGoneBranches({ cwd: "/path/to/repo", delete: true, force: false });
// result.deleted, result.failed, result.skipped, result.dryRun
```

Options: `cwd`, `fetch` (default true), `remote`, `protect` (default `["main", "master", "develop"]`), `delete` (default false), `force` (default false). Git failures throw a `GitError` with the failing arguments attached.

Both ESM and CommonJS are supported, with TypeScript types included.

## License

MIT
