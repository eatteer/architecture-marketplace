// Replaces frontend-architecture's `shadcn` skill with the one shadcn publishes, as it is upstream.
//
// The skill is shadcn's own and owns the use of the catalog; nothing in it is edited here, so the
// next sync never has a local change to carry forward. What only another agent reads (`agents/` and
// the icons it names in `assets/`) and the skill-creator suite (`evals/`) are left out, and the
// repository's license travels with it.
//
// Usage: node tools/sync-shadcn-skill.mjs [ref]   (defaults to the default branch)
//
// It prints the upstream commit it copied. Review `git diff`, bump frontend-architecture's version,
// and name that commit in the message.

import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const UPSTREAM_REPOSITORY = "https://github.com/shadcn-ui/ui";
const UPSTREAM_SKILL = "skills/shadcn";
const UPSTREAM_LICENSE = "LICENSE.md";
const LEFT_OUT = ["agents", "assets", "evals"];
const DESTINATION = join(REPOSITORY_ROOT, "plugins", "frontend-architecture", "skills", "shadcn");

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

const ref = process.argv[2];
const checkout = mkdtempSync(join(tmpdir(), "shadcn-skill-"));

try {
  const branch = ref === undefined ? [] : ["--branch", ref];

  git(["clone", "--quiet", "--depth", "1", "--filter=blob:none", "--sparse", ...branch, UPSTREAM_REPOSITORY, checkout]);
  git(["sparse-checkout", "set", UPSTREAM_SKILL], checkout);

  const commit = git(["rev-parse", "HEAD"], checkout);
  const source = join(checkout, ...UPSTREAM_SKILL.split("/"));

  rmSync(DESTINATION, { recursive: true, force: true });
  cpSync(source, DESTINATION, {
    recursive: true,
    filter: (path) => !LEFT_OUT.some((folder) => path.startsWith(join(source, folder) + sep) || path === join(source, folder)),
  });
  cpSync(join(checkout, UPSTREAM_LICENSE), join(DESTINATION, "LICENSE.md"));

  console.log(`Copied ${UPSTREAM_SKILL} from shadcn-ui/ui@${commit}.`);
  console.log("Review git diff, bump frontend-architecture's version, and name that commit in the message.");
} finally {
  rmSync(checkout, { recursive: true, force: true });
}
