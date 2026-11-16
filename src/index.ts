import { spawnSync } from "node:child_process";

export interface BranchInfo {
  /** Local branch name. */
  name: string;
  /** Upstream ref the branch tracks, e.g. "origin/feature-x". */
  upstream: string;
  /** Short commit hash of the branch tip. */
  sha: string;
  /**
   * Whether the branch's work is already in the base branch:
   * - "merged": the tip is an ancestor of the base (merge commit or fast-forward).
   * - "squashed": the branch's combined change exists in the base as one commit (squash merge).
   * - "rebased": every commit has an equivalent commit in the base (rebase merge).
   * - "unmerged": none of the above, or no base branch could be found.
   */
  status: BranchStatus;
}

export type BranchStatus = "merged" | "squashed" | "rebased" | "unmerged";

export interface FindOptions {
  /** Repository directory. Default: process.cwd(). */
  cwd?: string;
  /** Run `git fetch --prune` first so remote-tracking refs are current. Default: true. */
  fetch?: boolean;
  /** Only consider branches tracking this remote. Default: all remotes. */
  remote?: string;
  /** Branch names (or glob-like patterns using `*`) never to report. Default: ["main", "master", "develop"]. */
  protect?: string[];
  /**
   * Ref the branches are compared against to decide their `status`.
   * Default: the remote's default branch (e.g. "origin/HEAD"), then "<remote>/main", "<remote>/master", "main", "master".
   */
  base?: string;
  /** Detect squash-merged and rebase-merged branches. Default: true. */
  squashed?: boolean;
}

export interface PruneOptions extends FindOptions {
  /** Actually delete. When false (default) nothing is changed. */
  delete?: boolean;
  /**
   * Delete unmerged branches too. Default: false.
   * Branches whose status is "merged", "squashed" or "rebased" are always deleted, because their work is in the base.
   */
  force?: boolean;
}

export interface PruneResult {
  /** Branches whose upstream is gone (after protection filtering). */
  gone: BranchInfo[];
  /** Branches successfully deleted. Empty on a dry run. */
  deleted: string[];
  /** Branches git refused to delete (usually unmerged), with git's message. */
  failed: { name: string; reason: string }[];
  /** Branches skipped because they are protected or checked out. */
  skipped: { name: string; reason: string }[];
  /** True when nothing was deleted because `delete` was not set. */
  dryRun: boolean;
}

export const DEFAULT_PROTECTED = ["main", "master", "develop"];

export class GitError extends Error {
  constructor(message: string, public readonly args: string[]) {
    super(message);
    this.name = "GitError";
  }
}

export function git(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: env ? { ...process.env, ...env } : process.env });
  if (r.error) {
    throw new GitError(
      (r.error as NodeJS.ErrnoException).code === "ENOENT" ? "git is not installed or not on PATH" : r.error.message,
      args,
    );
  }
  if (r.status !== 0) {
    throw new GitError((r.stderr || r.stdout || `git exited with ${r.status}`).trim(), args);
  }
  return r.stdout;
}

function toMatcher(patterns: string[]): (name: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map((p) => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`);
  });
  return (name) => regexes.some((r) => r.test(name));
}

/** Name of the currently checked-out branch, or null when HEAD is detached. */
export function currentBranch(cwd: string): string | null {
  const r = spawnSync("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], { cwd, encoding: "utf8" });
  if (r.error) throw new GitError(r.error.message, ["symbolic-ref"]);
  if (r.status !== 0) return null; // detached HEAD
  const out = r.stdout.trim();
  return out === "" ? null : out;
}

function tryGit(args: string[], cwd: string, env?: NodeJS.ProcessEnv): string | null {
  try {
    return git(args, cwd, env).trim();
  } catch {
    return null;
  }
}

/** The ref gone branches are compared against: `base` if given, else the remote's default branch, else main/master. */
export function resolveBase(cwd: string, remote?: string, base?: string): string | null {
  const candidates = base
    ? [base]
    : [...(remote ? [`refs/remotes/${remote}/HEAD`, `refs/remotes/${remote}/main`, `refs/remotes/${remote}/master`] : []), "refs/heads/main", "refs/heads/master"];
  for (const ref of candidates) {
    if (tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd) !== null) return ref;
  }
  if (base) throw new GitError(`base "${base}" is not a valid ref`, ["rev-parse", base]);
  return null;
}

// commit-tree needs an identity even though the commit is never referenced.
const SCRATCH_IDENTITY = {
  GIT_AUTHOR_NAME: "prune-gone-branches", GIT_AUTHOR_EMAIL: "prune-gone-branches@localhost",
  GIT_COMMITTER_NAME: "prune-gone-branches", GIT_COMMITTER_EMAIL: "prune-gone-branches@localhost",
};

/**
 * Decide whether `branch`'s work is already in `base`.
 *
 * Squash detection builds one throwaway commit holding the branch's whole change on top of the
 * merge base and asks `git cherry` whether the base has a commit with the same patch. The
 * throwaway commit is unreferenced and is removed by git's normal garbage collection.
 */
export function branchStatus(branch: string, base: string, cwd: string, detectSquashed = true): BranchStatus {
  const ref = `refs/heads/${branch}`;
  const mergeBase = tryGit(["merge-base", base, ref], cwd);
  if (!mergeBase) return "unmerged";
  if (mergeBase === tryGit(["rev-parse", ref], cwd)) return "merged";
  if (!detectSquashed) return "unmerged";

  const tree = tryGit(["rev-parse", `${ref}^{tree}`], cwd);
  // A branch with no net change has nothing a squash commit could match; leave the call to git.
  if (!tree || tree === tryGit(["rev-parse", `${mergeBase}^{tree}`], cwd)) return "unmerged";

  const scratch = tryGit(["commit-tree", tree, "-p", mergeBase, "-m", "prune-gone-branches squash check"], cwd, SCRATCH_IDENTITY);
  if (scratch && tryGit(["cherry", base, scratch], cwd)?.startsWith("-")) return "squashed";

  const each = tryGit(["cherry", base, ref], cwd);
  if (each && each.split("\n").every((l) => l.startsWith("-"))) return "rebased";
  return "unmerged";
}

/**
 * List every local branch that tracks an upstream which no longer exists.
 * Protected branches and the checked-out branch are excluded.
 */
export function findGoneBranches(options: FindOptions = {}): { gone: BranchInfo[]; skipped: PruneResult["skipped"] } {
  const cwd = options.cwd ?? process.cwd();
  const protect = options.protect ?? DEFAULT_PROTECTED;
  const isProtected = toMatcher(protect);

  git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (options.fetch !== false) git(["fetch", "--prune", "--quiet"], cwd);

  const head = currentBranch(cwd);
  const out = git(
    ["for-each-ref", "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(objectname:short)\t%(upstream:remotename)", "refs/heads"],
    cwd,
  );

  const gone: BranchInfo[] = [];
  const skipped: PruneResult["skipped"] = [];
  const bases = new Map<string, string | null>();

  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, upstream, track, sha, remoteName] = line.split("\t");
    if (track !== "[gone]") continue;
    if (options.remote && !upstream.startsWith(`${options.remote}/`)) continue;
    if (name === head) {
      skipped.push({ name, reason: "currently checked out" });
      continue;
    }
    if (isProtected(name)) {
      skipped.push({ name, reason: "protected" });
      continue;
    }
    const remote = remoteName || upstream.split("/")[0];
    if (!bases.has(remote)) bases.set(remote, resolveBase(cwd, remote, options.base));
    const base = bases.get(remote);
    gone.push({ name, upstream, sha, status: base ? branchStatus(name, base, cwd, options.squashed !== false) : "unmerged" });
  }

  return { gone, skipped };
}

/**
 * Find gone branches and, when `delete` is true, delete them.
 * Defaults to a dry run that changes nothing.
 */
export function pruneGoneBranches(options: PruneOptions = {}): PruneResult {
  const cwd = options.cwd ?? process.cwd();
  const { gone, skipped } = findGoneBranches(options);
  const result: PruneResult = { gone, deleted: [], failed: [], skipped, dryRun: !options.delete };

  if (!options.delete) return result;

  for (const b of gone) {
    try {
      // `git branch -d` only accepts branches merged into HEAD, so it refuses squash- and rebase-merged
      // branches and anything merged while another branch is checked out. Their work is verified to be
      // in the base, so -D is safe for them.
      const verified = b.status !== "unmerged" && options.squashed !== false;
      git(["branch", options.force || verified ? "-D" : "-d", b.name], cwd);
      result.deleted.push(b.name);
    } catch (e) {
      result.failed.push({ name: b.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
