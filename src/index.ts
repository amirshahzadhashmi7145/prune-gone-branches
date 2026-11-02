import { spawnSync } from "node:child_process";

export interface BranchInfo {
  /** Local branch name. */
  name: string;
  /** Upstream ref the branch tracks, e.g. "origin/feature-x". */
  upstream: string;
  /** Short commit hash of the branch tip. */
  sha: string;
}

export interface FindOptions {
  /** Repository directory. Default: process.cwd(). */
  cwd?: string;
  /** Run `git fetch --prune` first so remote-tracking refs are current. Default: true. */
  fetch?: boolean;
  /** Only consider branches tracking this remote. Default: all remotes. */
  remote?: string;
  /** Branch names (or glob-like patterns using `*`) never to report. Default: ["main", "master", "develop"]. */
  protect?: string[];
}

export interface PruneOptions extends FindOptions {
  /** Actually delete. When false (default) nothing is changed. */
  delete?: boolean;
  /** Use `git branch -D` so unmerged branches are deleted too. Default: false. */
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

export function git(args: string[], cwd: string): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
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
    ["for-each-ref", "--format=%(refname:short)\t%(upstream:short)\t%(upstream:track)\t%(objectname:short)", "refs/heads"],
    cwd,
  );

  const gone: BranchInfo[] = [];
  const skipped: PruneResult["skipped"] = [];

  for (const line of out.split("\n")) {
    if (!line) continue;
    const [name, upstream, track, sha] = line.split("\t");
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
    gone.push({ name, upstream, sha });
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
      git(["branch", options.force ? "-D" : "-d", b.name], cwd);
      result.deleted.push(b.name);
    } catch (e) {
      result.failed.push({ name: b.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}
