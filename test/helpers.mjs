import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const CLI = resolve("dist/cli.js");

export function sh(cwd, cmd, ...args) {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr}${r.stdout}`);
  return r.stdout;
}

export const g = (cwd, ...args) => sh(cwd, "git", ...args);

/**
 * Create a bare "remote" and a clone with branches:
 *   main       pushed, still on remote
 *   kept       pushed, still on remote
 *   gone-merged   pushed then deleted on remote, merged into main
 *   gone-unmerged pushed then deleted on remote, has its own commit
 *   local-only no upstream at all
 */
export function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "pgb-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  g(root, "init", "--bare", "-q", "-b", "main", remote);
  g(root, "clone", "-q", remote, work);
  g(work, "commit", "-q", "--allow-empty", "-m", "init");
  g(work, "push", "-q", "-u", "origin", "main");

  for (const b of ["kept", "gone-merged"]) {
    g(work, "branch", b);
    g(work, "push", "-q", "-u", "origin", b);
  }
  g(work, "checkout", "-q", "-b", "gone-unmerged");
  g(work, "commit", "-q", "--allow-empty", "-m", "unmerged work");
  g(work, "push", "-q", "-u", "origin", "gone-unmerged");
  g(work, "checkout", "-q", "main");
  g(work, "branch", "local-only");

  g(work, "push", "-q", "origin", "--delete", "gone-merged", "gone-unmerged");
  return { root, remote, work };
}

export function branches(cwd) {
  return g(cwd, "for-each-ref", "--format=%(refname:short)", "refs/heads").trim().split("\n").sort();
}

export function runCli(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
