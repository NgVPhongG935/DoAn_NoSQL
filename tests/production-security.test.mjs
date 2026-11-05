import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes, scryptSync } from "node:crypto";
import { SignJWT } from "jose";

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function start(secret, extraEnv = {}, waitForExit = false) {
  const port = await freePort();
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    windowsHide: true,
    env: {
      ...process.env, NODE_ENV: "production", JWT_SECRET: secret, AUTH_SECRET: randomBytes(48).toString("base64url"),
      ADMIN_EMAIL: "", ADMIN_PASSWORD_HASH: "", ADMIN_PERMISSIONS: "",
      // This suite never sends authenticated database requests. Even if changed,
      // it must not connect to the application's current keyspace or transport.
      CASSANDRA_KEYSPACE: "rideflow_p0_security_test_only", CASSANDRA_CONTACT_POINTS: "127.0.0.1", CASSANDRA_PORT: String(await freePort()),
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let timer;
  const result = new Promise((resolve, reject) => {
    const capture = (chunk) => {
      output += chunk.toString();
      // Next 16.3.6 logs "Ready" before loading configuration/instrumentation.
      // For invalid configuration, wait for the actual process exit instead.
      if (!waitForExit && /Ready in/.test(output)) { clearTimeout(timer); resolve({ ready: true }); }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timer); resolve({ ready: false, code }); });
    timer = setTimeout(() => { child.kill(); reject(new Error("Production startup timed out")); }, 30000);
  });
  return { child, result, output: () => output, url: `http://127.0.0.1:${port}` };
}

async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill();
  await exited;
}

for (const [label, secret] of [["missing", ""], ["too short", "short"], ["placeholder", "replace-with-a-long-random-secret"], ["low diversity", "a".repeat(64)], ["former fallback", "local-demo-only-change-this-secret-rideflow"]]) {
  test(`actual next start refuses ${label} JWT_SECRET`, { timeout: 40000 }, async () => {
    const server = await start(secret, {}, true);
    try {
      const result = await server.result;
      assert.equal(result.ready, false, "Must not reach Ready");
      assert.notEqual(result.code, 0);
      assert.match(server.output(), /JWT_SECRET/);
    } finally { await stop(server.child); }
  });
}

test("actual production HTTP rejects forged tokens and enforces Admin role", { timeout: 40000 }, async () => {
  const secret = randomBytes(48).toString("base64url");
  const password = randomBytes(24).toString("base64url") + "aA1!";
  const salt = randomBytes(16).toString("hex");
  const server = await start(secret, {
    ADMIN_EMAIL: "admin@test.invalid", ADMIN_PASSWORD_HASH: `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`.replaceAll("$", "\\$"),
    ADMIN_PERMISSIONS: "services:write",
  });
  try {
    assert.equal((await server.result).ready, true, server.output());
    const request = async (path, method = "GET", token, body) => {
      const response = await fetch(server.url + path, {
        method, signal: AbortSignal.timeout(10000),
        headers: { ...(token ? { cookie: `rideflow_session=${token}` } : {}), "content-type": "application/json" },
        ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}),
      });
      return response;
    };
    const id = "00000000-0000-4000-8000-000000000001";
    const routes = [
      ["/api/auth/me", "GET"], ["/api/dashboard", "GET"], ["/api/drivers", "GET"], ["/api/services", "GET"],
      ["/api/trips", "POST"], [`/api/trips/${id}`, "GET"], [`/api/trips/${id}/review`, "POST"], [`/api/trips/${id}/status`, "PATCH"],
      ["/api/admin/customers", "GET"], ["/api/admin/services", "POST"], [`/api/admin/customers/${id}`, "PATCH"],
      [`/api/admin/complaints/${id}/2026-10-10T00%3A00%3A00.000Z/${id}`, "PATCH"],
      [`/api/customers/${id}`, "GET"], [`/api/customers/${id}`, "PATCH"],
      ...["trips", "payments", "reviews", "vouchers", "complaints"].map((resource) => [`/api/customers/${id}/${resource}`, "GET"]),
      [`/api/customers/${id}/complaints`, "POST"], [`/api/drivers/${id}`, "GET"], [`/api/drivers/${id}`, "PATCH"],
      ...["trips", "reviews", "vehicle", "revenue/2026-10"].map((resource) => [`/api/drivers/${id}/${resource}`, "GET"]),
      [`/api/drivers/${id}/status`, "PATCH"], [`/api/users/${id}/notifications`, "GET"],
      [`/api/users/${id}/notifications/2026-10-10T00%3A00%3A00.000Z/${id}`, "PATCH"],
      ["/api/maps/geocode?q=Test", "GET"], ["/api/maps/reverse-geocode?lat=10&lng=106", "GET"], ["/api/maps/route", "POST"],
    ];
    const payload = { userId: "admin-demo", role: "ADMIN", name: "Admin", email: "admin@test.invalid" };
    const oldToken = await new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuer("rideflow").setAudience("rideflow-session")
      .setSubject(payload.userId).setIssuedAt().setExpirationTime("5m").sign(new TextEncoder().encode("local-demo-only-change-this-secret-rideflow"));
    for (const [path, method] of routes) {
      assert.equal((await request(path, method)).status, 401, `Anonymous ${method} ${path}`);
      assert.equal((await request(path, method, oldToken)).status, 401, `Old key ${method} ${path}`);
    }
    const login = await request("/api/auth/login", "POST", undefined, { email: payload.email, password, role: "CUSTOMER" });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=lax/i);
    const token = cookie.match(/rideflow_session=([^;]+)/)[1];
    assert.equal((await request("/api/auth/me", "GET", token)).status, 200);
    assert.equal((await request("/api/admin/services", "POST", token, {})).status, 400, "Authorized method reaches input validation without touching Cassandra");
    assert.equal((await request("/api/auth/logout", "POST", token)).status, 200);
    assert.doesNotMatch(server.output(), /NoHostAvailableError|ECONNREFUSED|RideFlow API error/);
    console.log(`Production HTTP: ${routes.length} protected API methods rejected both anonymous and old-key requests; valid Admin login/cookie and role verified.`);
  } finally { await stop(server.child); }
});
