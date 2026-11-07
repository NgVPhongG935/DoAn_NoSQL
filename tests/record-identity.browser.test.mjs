import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { SignJWT } from "jose";

async function port() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const value = server.address().port;
  await new Promise((resolve) => server.close(resolve)); return value;
}
async function poll(callback, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const value = await callback(); if (value) return value; } catch { /* Wait for the server or UI. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Browser test condition timed out");
}
async function stop(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill(); await exited;
}

test("Dashboards, payments and notifications retain distinct rows without React key errors", { timeout: 120000 }, async () => {
  const webPort = await port(), debugPort = await port();
  const secret = randomBytes(48).toString("base64url");
  const directory = path.resolve(".tmp", `p1-browser-${randomUUID()}`);
  const appDirectory=process.env.RIDEFLOW_TEST_APP_DIR || ".";
  const hasDotenv=[".env",".env.local",".env.production",".env.production.local"].some(name=>existsSync(path.join(appDirectory,name)));
  const adminHash=`scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
  await mkdir(directory, { recursive: true });
  const server = spawn(process.execPath, ["--import", new URL("./record-identity-ui-transport.mjs", import.meta.url).href, "node_modules/next/dist/bin/next", process.env.RIDEFLOW_TEST_DEV === "true" ? "dev" : "start", ...(process.env.RIDEFLOW_TEST_DEV === "true" ? ["--webpack"] : []), process.env.RIDEFLOW_TEST_APP_DIR || ".", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, NODE_ENV: process.env.RIDEFLOW_TEST_DEV === "true" ? "development" : "production", JWT_SECRET: secret, RIDEFLOW_BUSINESS_JOURNAL_ENABLED: "false",
      ADMIN_EMAIL: "ui-admin@test.invalid", ADMIN_PASSWORD_HASH: hasDotenv ? adminHash.replaceAll("$", "\\$") : adminHash,
      ADMIN_PERMISSIONS: "customers:read,drivers:read,vehicles:read,vehicles:write,services:read,services:write,vouchers:read,vouchers:write,notifications:read,notifications:write,reports:read",
      CASSANDRA_KEYSPACE: "rideflow_p1_ui_memory_only", CASSANDRA_PORT: String(await port()),
      RIDEFLOW_AVATAR_DIR: path.join(directory, "avatars"),
    },
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk; }); server.stderr.on("data", (chunk) => { serverLog += chunk; });
  let chrome, socket;
  try {
    await poll(async () => (await fetch(`http://127.0.0.1:${webPort}/api/auth/me`)).status === 401);
    chrome = spawn(process.env.RIDEFLOW_TEST_CHROME || ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync), ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-crash-reporter", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${directory}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
    const targets = await poll(async () => { const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`); const result = await response.json(); return result.find((item) => item.type === "page"); });
    socket = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0; const pending = new Map(), exceptions = [], consoleErrors = [], protocolMessages = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      protocolMessages.push(message.method || message.id);
      if (message.id) {
        const entry = pending.get(message.id); if (!entry) return;
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
      }
      if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(message.params.args.map(arg => arg.value || arg.description || "").join(" "));
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    };
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}; received ${JSON.stringify(protocolMessages.slice(-3))}`)); }, method === "Page.navigate" ? 45000 : 10000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => {
      const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    await command("Page.enable"); await command("Runtime.enable"); await command("Network.enable");
    await command("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__p1Calls = []; window.__p1Alerts = [];
      window.confirm = () => true; window.alert = (text) => window.__p1Alerts.push(text);
      const original = window.fetch;
      window.fetch = async (url, options = {}) => {
        window.__p1Calls.push({url: String(url), method: options.method || 'GET'});
        return original(url, options);
      };
    ` });
    const setRole = async (role, actor) => {
      const user = actor || (role === "ADMIN" ? { userId: "admin-demo", role, name: "UI Admin", email: "ui-admin@test.invalid" }
        : { userId: "20000000-0000-4000-8000-000000000001", role, name: "UI Test Customer", email: "ui-customer@test.invalid" });
      const token = await new SignJWT(user).setProtectedHeader({ alg: "HS256" }).setIssuer("rideflow").setAudience("rideflow-session").setSubject(user.userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));
      await command("Network.setCookie", { name: "rideflow_session", value: token, url: `http://127.0.0.1:${webPort}`, httpOnly: true, sameSite: "Lax" });
    };
    const navigate = async (route, selector) => {
      await command("Page.navigate", { url: `http://127.0.0.1:${webPort}${route}` });
      try {
        await poll(() => evaluate(`location.pathname === ${JSON.stringify(route)} && !!document.querySelector(${JSON.stringify(selector)})`));
      } catch {
        throw new Error(`Navigation to ${route} failed: ${JSON.stringify(await evaluate("({path:location.pathname,text:document.body.innerText.slice(0,1200)})"))}`);
      }
    };

    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await setRole("ADMIN");
    await navigate("/admin/dashboard", "input[type=month]");
    await poll(()=>evaluate("!document.querySelector('.trips-panel .table-skeleton') && window.__p1Calls.some(call=>call.url.startsWith('/api/dashboard'))"));
    await evaluate("(() => { const input=document.querySelector('input[type=month]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-10'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()");
    try { await poll(()=>evaluate("document.querySelectorAll('.trips-panel tbody tr').length===2 && !document.querySelector('.loading-panel')")); } catch(error) { throw new Error(error.message+": "+JSON.stringify(await evaluate("({month:document.querySelector('input[type=month]')?.value,rows:document.querySelectorAll('.trips-panel tbody tr').length,error:document.querySelector('.data-error')?.textContent,calls:window.__p1Calls.filter(call=>call.url.startsWith('/api/dashboard'))})"))); }
    const dashboard = await evaluate("fetch('/api/dashboard?month=2026-10').then(response=>response.json()).then(body=>body.data)");
    assert.equal(dashboard.stats.tripCount, 2);
    assert.equal(dashboard.stats.completedTrips, 2);
    assert.equal(new Set(dashboard.trips.map(trip=>trip.trip_id)).size, 2);
    assert.deepEqual(dashboard.charts.status, [{ name: "COMPLETED", value: 2 }]);
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"admin-dashboard.png"),Buffer.from(result.data,"base64")));

    await navigate("/admin/trips", ".admin-trip-id");
    const tripId=await evaluate("document.querySelector('.admin-trip-id').textContent");
    assert.match(tripId,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
    await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedTripId=value;}}}); document.querySelector('.admin-trip-copy').click()");
    await poll(()=>evaluate("document.querySelector('.admin-trip-copy').textContent.includes('Đã chép ID')"));
    assert.equal(await evaluate("window.__copiedTripId"),tripId);
    await evaluate(`(() => {const input=document.querySelector('input[aria-label="Tìm chuyến đi"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(tripId)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await poll(()=>evaluate("document.querySelectorAll('.admin-trip-table tbody tr').length===1"));
    assert.equal(await evaluate("document.querySelector('.admin-trip-id').textContent"),tripId);
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"admin-trip-full-id.png"),Buffer.from(result.data,"base64")));
    await evaluate("navigator.clipboard.writeText=async()=>{throw new Error('Clipboard unavailable')};document.querySelector('.admin-trip-copy').click()");
    await poll(()=>evaluate("document.querySelector('.data-error')?.textContent.includes('Không thể tự sao chép')"));
    assert.equal(await evaluate("document.querySelector('.admin-trip-id').textContent"),tripId);

    await setRole("CUSTOMER");
    await navigate("/customer/payments", ".data-table tbody tr");
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===4"));
    const filter = async value => {
      await evaluate(`(() => { const input=document.querySelector('.table-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    };
    await filter("20000000-0000-4000-8000-000000000041");
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===2"));
    await filter("");
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===4"));
    // A browser in UTC must still display Vietnam time with seconds, retaining
    // the original milliseconds visibly and in machine-readable timestamps for CQL.
    await command("Emulation.setTimezoneOverride", { timezoneId: "UTC" });
    await navigate("/customer/trips/20000000-0000-4000-8000-000000000041", ".timeline time");
    const timeline=await evaluate("[...document.querySelectorAll('.timeline time')].map(node=>({text:node.textContent,iso:node.getAttribute('datetime'),title:node.title}))");
    assert.equal(timeline.length,5);
    for(const [index,time] of ["07:00:00.000","07:01:24.018","07:02:35.092","07:03:46.841","07:04:57.871"].entries()) assert.ok(timeline[index].text.includes(time));
    assert.equal(timeline[1].iso,"2026-10-10T00:01:24.018Z");
    assert.equal(timeline[1].title,timeline[1].iso);
    assert.equal(await evaluate("document.querySelector('.trip-booked-timestamp code').textContent"),"2026-10-10T00:00:00.000Z");
    assert.ok(await evaluate("document.querySelector('.detail-heading time').textContent.includes('07:00:00.000')"));
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"trip-seconds-desktop.png"),Buffer.from(result.data,"base64")));
    await command("Emulation.setDeviceMetricsOverride",{width:375,height:812,deviceScaleFactor:1,mobile:true});
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"trip-seconds-mobile.png"),Buffer.from(result.data,"base64")));
    await command("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await command("Emulation.setTimezoneOverride", { timezoneId: "Asia/Ho_Chi_Minh" });
    await navigate("/customer/notifications", ".data-table tbody tr");
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===2"));
    assert.equal(await evaluate("document.querySelector('.data-table').innerText.includes('Second notification')"), true);
    await filter("Second notification");
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===1"));
    await filter("");
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===2"));
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"customer-notifications.png"),Buffer.from(result.data,"base64")));
    await command("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
    await evaluate("document.querySelector('.mobile-menu').click()");
    await poll(()=>evaluate("(() => { const link=document.querySelector('.sidebar-link.active'); const rect=link.getBoundingClientRect(); return rect.left>=0 && document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2)?.closest('a')===link; })()"));
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"mobile-menu.png"),Buffer.from(result.data,"base64")));
    assert.deepEqual(exceptions, []);
    assert.deepEqual(consoleErrors, []);
    await writeFile(path.join(directory,"result.json"),JSON.stringify({passed:true,exceptions,consoleErrors,transport:"in-memory Cassandra; no live database"},null,2));
    console.log(`PASS: authoritative dashboard counts, distinct payments/notifications, filter stability, no console errors. Evidence: ${directory}`);
  } catch (error) {
    await writeFile(path.join(directory,"server.log"),serverLog);
    throw error;
  } finally {
    socket?.close(); if(chrome) await stop(chrome); await stop(server);
  }
});
