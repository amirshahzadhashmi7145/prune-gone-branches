import { readFileSync } from "node:fs";
import { pruneGoneBranches, GitError, DEFAULT_PROTECTED } from "./index.js";

const HELP = `prune-gone-branches: delete local git branches whose remote branch is gone.

Runs "git fetch --prune", then finds local branches whose upstream no longer
exists. By default it only lists them. Pass --delete to remove them.

Usage:
  prune-gone-branches [options]

Options:
  -d, --delete           Delete the branches (default is a dry run)
  -f, --force            Use "git branch -D" so unmerged branches are deleted too
      --no-fetch         Skip "git fetch --prune"
  -r, --remote <name>    Only consider branches tracking this remote
  -p, --protect <names>  Comma-separated names or patterns never to delete
                         (default: ${DEFAULT_PROTECTED.join(",")}; pass "" to disable)
      --json             Print the result as JSON
  -q, --quiet            Print nothing; rely on the exit code
  -h, --help             Show this help
  -v, --version          Show version

Exit codes:
  0  nothing to do, or all deletions succeeded
  1  dry run found branches, or some deletions failed
  2  usage or git error
`;

interface Args {
  delete: boolean;
  force: boolean;
  fetch: boolean;
  remote?: string;
  protect: string[];
  json: boolean;
  quiet: boolean;
}

function fail(message: string): never {
  process.stderr.write(`prune-gone-branches: ${message}\n`);
  process.exit(2);
}

function readVersion(): string {
  try {
    return JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version as string;
  } catch {
    return "unknown";
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = { delete: false, force: false, fetch: true, protect: DEFAULT_PROTECTED, json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "-h": case "--help": process.stdout.write(HELP); process.exit(0);
      case "-v": case "--version": process.stdout.write(`${readVersion()}\n`); process.exit(0);
      case "-d": case "--delete": args.delete = true; break;
      case "-f": case "--force": args.force = true; break;
      case "--no-fetch": args.fetch = false; break;
      case "-r": case "--remote": args.remote = next(); break;
      case "-p": case "--protect": args.protect = next().split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--json": args.json = true; break;
      case "-q": case "--quiet": args.quiet = true; break;
      default: fail(`Unknown option: ${a}\n\n${HELP}`);
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  let result;
  try {
    result = pruneGoneBranches(args);
  } catch (e) {
    fail(e instanceof GitError ? e.message : String(e));
  }

  const failed = result.failed.length > 0;
  const code = result.dryRun ? (result.gone.length > 0 ? 1 : 0) : failed ? 1 : 0;

  if (args.quiet) process.exit(code);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(code);
  }

  const w = (s: string) => process.stdout.write(`${s}\n`);
  if (result.gone.length === 0) {
    w("No local branches with a gone upstream.");
  } else if (result.dryRun) {
    w(`Branches whose upstream is gone (${result.gone.length}):`);
    for (const b of result.gone) w(`  ${b.name}  (${b.sha}, was ${b.upstream})`);
    w("");
    w("Dry run. Re-run with --delete to remove them, add --force for unmerged branches.");
  } else {
    for (const name of result.deleted) w(`Deleted ${name}`);
    for (const f of result.failed) w(`Failed  ${f.name}: ${f.reason.split("\n")[0]}`);
    if (failed && !args.force) w("\nSome branches are not fully merged. Re-run with --force to delete them anyway.");
  }
  for (const s of result.skipped) w(`Skipped ${s.name} (${s.reason})`);
  process.exit(code);
}

main();
