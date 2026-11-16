import { test } from "node:test";
import assert from "node:assert/strict";
import { findGoneBranches, pruneGoneBranches, currentBranch, resolveBase, GitError } from "../dist/index.js";
import { makeRepo, addSquashedBranches, branches, g } from "./helpers.mjs";

test("findGoneBranches lists only branches whose upstream is gone", () => {
  const { work } = makeRepo();
  const { gone, skipped } = findGoneBranches({ cwd: work });
  assert.deepEqual(gone.map((b) => b.name).sort(), ["gone-merged", "gone-unmerged"]);
  assert.equal(gone[0].upstream.startsWith("origin/"), true);
  assert.match(gone[0].sha, /^[0-9a-f]{7,}$/);
  assert.deepEqual(skipped, []);
});

test("dry run by default changes nothing", () => {
  const { work } = makeRepo();
  const before = branches(work);
  const r = pruneGoneBranches({ cwd: work });
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.deleted, []);
  assert.deepEqual(branches(work), before);
});

test("delete removes merged branches and reports unmerged failures", () => {
  const { work } = makeRepo();
  const r = pruneGoneBranches({ cwd: work, delete: true });
  assert.deepEqual(r.deleted, ["gone-merged"]);
  assert.equal(r.failed.length, 1);
  assert.equal(r.failed[0].name, "gone-unmerged");
  assert.match(r.failed[0].reason, /not fully merged/);
  assert.deepEqual(branches(work), ["gone-unmerged", "kept", "local-only", "main"]);
});

test("force deletes unmerged branches too", () => {
  const { work } = makeRepo();
  const r = pruneGoneBranches({ cwd: work, delete: true, force: true });
  assert.deepEqual(r.deleted.sort(), ["gone-merged", "gone-unmerged"]);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(branches(work), ["kept", "local-only", "main"]);
});

test("checked-out and protected branches are skipped", () => {
  const { work } = makeRepo();
  g(work, "checkout", "-q", "gone-unmerged");
  const r = pruneGoneBranches({ cwd: work, delete: true, force: true, protect: ["gone-*"] });
  assert.deepEqual(r.deleted, []);
  assert.deepEqual(r.skipped, [
    { name: "gone-merged", reason: "protected" },
    { name: "gone-unmerged", reason: "currently checked out" },
  ]);
});

test("protected defaults cover main/master/develop", () => {
  const { work } = makeRepo();
  g(work, "branch", "develop");
  g(work, "push", "-q", "-u", "origin", "develop");
  g(work, "push", "-q", "origin", "--delete", "develop");
  const r = findGoneBranches({ cwd: work });
  assert.ok(r.skipped.some((s) => s.name === "develop" && s.reason === "protected"));
  assert.ok(!r.gone.some((b) => b.name === "develop"));
});

test("remote filter only matches that remote", () => {
  const { work } = makeRepo();
  assert.equal(findGoneBranches({ cwd: work, remote: "upstream" }).gone.length, 0);
  assert.equal(findGoneBranches({ cwd: work, remote: "origin" }).gone.length, 2);
});

test("fetch:false still works on already-pruned refs", () => {
  const { work } = makeRepo();
  g(work, "fetch", "--prune", "-q");
  assert.equal(findGoneBranches({ cwd: work, fetch: false }).gone.length, 2);
});

test("currentBranch returns null when detached", () => {
  const { work } = makeRepo();
  assert.equal(currentBranch(work), "main");
  g(work, "checkout", "-q", "--detach");
  assert.equal(currentBranch(work), null);
});

test("throws GitError outside a repository", () => {
  const { root } = makeRepo();
  assert.throws(() => findGoneBranches({ cwd: root, fetch: false }), GitError);
});

const statuses = (gone) => Object.fromEntries(gone.map((b) => [b.name, b.status]));

test("status tells merged, squash-merged, rebase-merged and unmerged branches apart", () => {
  const { work } = makeRepo();
  addSquashedBranches(work);
  assert.deepEqual(statuses(findGoneBranches({ cwd: work }).gone), {
    "gone-merged": "merged",
    "gone-unmerged": "unmerged",
    "gone-squashed": "squashed",
    "gone-rebased": "rebased",
    "gone-diverged": "unmerged",
  });
});

test("delete without force removes squash- and rebase-merged branches, keeps unmerged ones", () => {
  const { work } = makeRepo();
  addSquashedBranches(work);
  const r = pruneGoneBranches({ cwd: work, delete: true });
  assert.deepEqual(r.deleted.sort(), ["gone-merged", "gone-rebased", "gone-squashed"]);
  assert.deepEqual(r.failed.map((f) => f.name).sort(), ["gone-diverged", "gone-unmerged"]);
  assert.deepEqual(branches(work), ["gone-diverged", "gone-unmerged", "kept", "local-only", "main"]);
});

test("squash detection compares against the remote base even when local main is stale", () => {
  const { work } = makeRepo();
  addSquashedBranches(work);
  g(work, "reset", "-q", "--hard", "HEAD~4"); // local main is now behind origin/main
  const r = pruneGoneBranches({ cwd: work, delete: true });
  assert.deepEqual(r.deleted.sort(), ["gone-merged", "gone-rebased", "gone-squashed"]);
});

test("squashed:false restores plain git branch -d behaviour", () => {
  const { work } = makeRepo();
  addSquashedBranches(work);
  const found = statuses(findGoneBranches({ cwd: work, squashed: false }).gone);
  assert.equal(found["gone-squashed"], "unmerged");
  assert.equal(found["gone-merged"], "merged");
  const r = pruneGoneBranches({ cwd: work, delete: true, squashed: false });
  assert.deepEqual(r.deleted, ["gone-merged"]);
});

test("base option and resolveBase", () => {
  const { work } = makeRepo();
  addSquashedBranches(work);
  assert.equal(resolveBase(work, "origin"), "refs/remotes/origin/main");
  assert.equal(resolveBase(work, "origin", "kept"), "kept");
  assert.throws(() => resolveBase(work, "origin", "no-such-ref"), GitError);
  // Against a base that never received the squash commit, nothing new counts as merged.
  const found = statuses(findGoneBranches({ cwd: work, base: "kept" }).gone);
  assert.equal(found["gone-squashed"], "unmerged");
  assert.equal(found["gone-merged"], "merged");
});
