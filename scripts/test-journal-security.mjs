import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--import", "./tests/register.mjs", "--test", "tests/security.test.mjs"], {
  stdio: "inherit", windowsHide: true, env: { ...process.env, RIDEFLOW_TEST_JOURNAL: "true" },
});
process.exit(result.status ?? 1);
