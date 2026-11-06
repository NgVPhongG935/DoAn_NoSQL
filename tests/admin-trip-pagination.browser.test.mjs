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

test("Admin trip pagination covers all records and resets correctly with filters", { timeout: 120000 }, async () => {
  const webPort = await port(), debugPort = await port();
  const secret = randomBytes(48).toString("base64url");
  const directory = path.resolve(".tmp", `p1-browser-${randomUUID()}`);
  const appDirectory=process.env.RIDEFLOW_TEST_APP_DIR || ".";
  const hasDotenv=[".env",".env.local",".env.production",".env.production.local"].some(name=>existsSync(path.join(appDirectory,name)));
  const adminHash=`scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
  await mkdir(directory, { recursive: true });
  const server = spawn(process.execPath, ["--import", new URL("./admin-trip-pagination-ui-transport.mjs", import.meta.url).href, "node_modules/next/dist/bin/next", process.env.RIDEFLOW_TEST_DEV === "true" ? "dev" : "start", ...(process.env.RIDEFLOW_TEST_DEV === "true" ? ["--webpack"] : []), process.env.RIDEFLOW_TEST_APP_DIR || ".", "--hostname", "127.0.0.1", "--port", String(webPort)], {
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

    await command("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await setRole("ADMIN");
    await navigate("/admin/trips", ".admin-trip-id");
    const allIds=await evaluate("fetch('/api/admin/trips').then(response=>response.json()).then(body=>body.data.map(row=>row.trip_id))");
    assert.equal(allIds.length,62);
    const ids=()=>evaluate("[...document.querySelectorAll('.admin-trip-id')].map(node=>node.textContent)");
    const go=async page=>{
      await evaluate(`document.querySelector('.trip-pagination button[aria-label="Trang ${page}"]').click()`);
      await poll(()=>evaluate(`document.querySelector('.trip-pagination [aria-current=page]')?.textContent==='${page}'`));
    };
    const select=async(label,value)=>{
      await evaluate(`(() => {const input=document.querySelector('select[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    };
    const search=async value=>{
      await evaluate(`(() => {const input=document.querySelector('input[aria-label="Tìm chuyến đi"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    };
    assert.deepEqual(await ids(),allIds.slice(0,10));
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Trang trước\"]').disabled"),true);
    await go(2);assert.deepEqual(await ids(),allIds.slice(10,20));
    await go(7);assert.deepEqual(await ids(),allIds.slice(60));
    assert.equal(await evaluate("document.querySelector('button[aria-label=\"Trang sau\"]').disabled"),true);
    assert.match(await evaluate("document.querySelector('.trip-pagination-summary').textContent"),/61–62 \/ 62/);
    await select("Số chuyến mỗi trang","20");
    await poll(()=>evaluate("document.querySelectorAll('.admin-trip-id').length===20"));
    assert.deepEqual(await ids(),allIds.slice(0,20));
    await go(4);assert.deepEqual(await ids(),allIds.slice(60));
    await select("Số chuyến mỗi trang","50");
    await poll(()=>evaluate("document.querySelectorAll('.admin-trip-id').length===50"));
    await go(2);assert.deepEqual(await ids(),allIds.slice(50));
    await search(allIds[61]);
    await poll(()=>evaluate("document.querySelectorAll('.admin-trip-id').length===1"));
    assert.deepEqual(await ids(),[allIds[61]]);
    assert.equal(await evaluate("document.querySelector('.trip-pagination [aria-current=page]').textContent"),"1");
    await search("");await select("Số chuyến mỗi trang","10");
    await poll(()=>evaluate("document.querySelectorAll('.admin-trip-id').length===10"));
    await go(7);
    await evaluate("[...document.querySelectorAll('.admin-filter-tabs button')].find(button=>button.textContent==='Hoàn thành').click()");
    await poll(()=>evaluate("document.querySelector('.trip-pagination-summary').textContent.includes('/ 21')"));
    assert.equal(await evaluate("document.querySelector('.trip-pagination [aria-current=page]').textContent"),"1");
    await go(3);assert.equal((await ids()).length,1);
    await select("Lọc tháng đặt chuyến","2026-10");
    await poll(()=>evaluate("document.querySelector('.trip-pagination-summary').textContent.includes('/ 10')"));
    assert.equal(await evaluate("document.querySelector('.trip-pagination [aria-current=page]').textContent"),"1");
    await search("no-such-trip");
    await poll(()=>evaluate("!!document.querySelector('.empty-state') && !document.querySelector('.trip-pagination')"));
    assert.match(await evaluate("document.querySelector('.trip-pagination-summary').textContent"),/0–0 \/ 0/);
    await evaluate("document.querySelector('.empty-state button').click()");
    await poll(()=>evaluate("document.querySelector('.trip-pagination-summary').textContent.includes('/ 62')"));
    assert.deepEqual(await ids(),allIds.slice(0,10));
    await evaluate("document.querySelector('.trip-pagination-footer').scrollIntoView({block:'center'})");
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"admin-trips-pagination-desktop.png"),Buffer.from(result.data,"base64")));
    await command("Emulation.setDeviceMetricsOverride",{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await evaluate("document.querySelector('.trip-pagination-footer').scrollIntoView({block:'center'})");
    assert.equal(await evaluate("document.documentElement.scrollWidth<=innerWidth"),true);
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"admin-trips-pagination-mobile.png"),Buffer.from(result.data,"base64")));
    assert.deepEqual(exceptions,[]);assert.deepEqual(consoleErrors,[]);
    await writeFile(path.join(directory,"result.json"),JSON.stringify({passed:true,records:62,pageSizes:[10,20,50],filters:["search","status","month"],exceptions,consoleErrors,transport:"in-memory Cassandra; no live database"},null,2));
    console.log(`PASS: 62 trips, first/last pages, 10/20/50 page sizes, all-record search, filter resets, empty results and mobile layout. Evidence: ${directory}`);
  }catch(error){await writeFile(path.join(directory,"server.log"),serverLog);throw error;}
  finally{socket?.close();if(chrome)await stop(chrome);await stop(server);}
});
