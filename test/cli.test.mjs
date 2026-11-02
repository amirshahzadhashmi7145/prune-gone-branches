import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, branches, runCli } from "./helpers.mjs";

test("dry run lists branches and exits 1", () => {
  const { work } = makeRepo();
  const before = branches(work);
  const r = runCli(work);
  assert.equal(r.code, 1);
  assert.match(r.out, /Branches whose upstream is gone \(2\):/);
  assert.match(r.out, /gone-merged/);
  assert.match(r.out, /Dry run/);
  assert.deepEqual(branches(work), before);
});

test("exits 0 when nothing is gone", () => {
  const { work } = makeRepo();
  runCli(work, "-d", "-f");
  const r = runCli(work);
  assert.equal(r.code, 0);
  assert.match(r.out, /No local branches/);
});

test("--delete removes merged, reports unmerged, exits 1", () => {
  const { work } = makeRepo();
  const r = runCli(work, "--delete");
  assert.equal(r.code, 1);
  assert.match(r.out, /Deleted gone-merged/);
  assert.match(r.out, /Failed  gone-unmerged/);
  assert.match(r.out, /--force/);
});

test("--delete --force removes all and exits 0", () => {
  const { work } = makeRepo();
  const r = runCli(work, "-d", "-f");
  assert.equal(r.code, 0);
  assert.deepEqual(branches(work), ["kept", "local-only", "main"]);
});

test("--json output", () => {
  const { work } = makeRepo();
  const r = runCli(work, "--json", "--no-fetch");
  const j = JSON.parse(r.out);
  assert.equal(j.dryRun, true);
  assert.equal(j.gone.length, 2);
});

test("--protect pattern and --quiet", () => {
  const { work } = makeRepo();
  const r = runCli(work, "-d", "-f", "-p", "gone-*", "-q");
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
  assert.deepEqual(branches(work), ["gone-merged", "gone-unmerged", "kept", "local-only", "main"]);
});

test("exit 2 outside a git repo and on unknown option", () => {
  const { root, work } = makeRepo();
  const r = runCli(root, "--no-fetch");
  assert.equal(r.code, 2);
  assert.match(r.err, /not a git repository/i);
  assert.equal(runCli(work, "--bogus").code, 2);
});

test("--help and --version", () => {
  const { work } = makeRepo();
  assert.equal(runCli(work, "--help").code, 0);
  const v = runCli(work, "-v");
  assert.equal(v.code, 0);
  assert.match(v.out, /^\d+\.\d+\.\d+\n$/);
});
