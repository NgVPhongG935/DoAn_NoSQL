import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const steps = [
  ["Typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]],
  ["P0 + P1 in-memory tests", ["--import", "./tests/register.mjs", "--test", "tests/security.test.mjs", "tests/business.test.mjs"]],
  ["P0 regression with journal enabled", ["scripts/test-journal-security.mjs"]],
  ["Production build", ["node_modules/next/dist/bin/next", "build"]],
  ["Production HTTP security", ["--test", "tests/production-security.test.mjs"]],
  ["Chrome UI with in-memory transport", ["--test", "tests/browser-business.test.mjs"]],
];
mkdirSync("docs/evidence", { recursive: true });
const results = [];
let log = `RideFlow P1 verification. Node ${process.version}. No live Cassandra writes or schema changes.\n`;
for (const [name, args] of steps) {
  console.log(`Running: ${name}`);
  const result = spawnSync(process.execPath, args, { windowsHide: true, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  log += `\n${name}\n${result.stdout || ""}${result.stderr || ""}\nExit: ${result.status}\n`;
  results.push({ name, exit: result.status });
  writeFileSync("docs/evidence/P1_CHECKS_2026-10-21.txt", log);
  if (result.status !== 0) {
    console.error((result.stdout || "") + (result.stderr || ""));
    console.error(`Failed: ${name}`); process.exit(result.status ?? 1);
  }
  console.log(`PASS: ${name}`);
}
writeFileSync("docs/evidence/P1_CHECKS_2026-10-21.json", JSON.stringify({ node: process.version, liveCassandraTested: false, results }, null, 2));
console.log("All checks passed. Live Cassandra integration remains pending migration approval.");
