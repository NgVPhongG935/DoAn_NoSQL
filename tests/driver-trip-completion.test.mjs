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

test("Driver trip completion shows success, settles cash and prevents repeat completion", { timeout: 120000 }, async () => {
  const webPort = await port(), debugPort = await port();
  const secret = randomBytes(48).toString("base64url");
  const directory = path.resolve(".tmp", `p1-browser-${randomUUID()}`);
  const appDirectory=process.env.RIDEFLOW_TEST_APP_DIR || ".";
  const hasDotenv=[".env",".env.local",".env.production",".env.production.local"].some(name=>existsSync(path.join(appDirectory,name)));
  const adminHash=`scrypt$${"a".repeat(32)}$${"b".repeat(128)}`;
  await mkdir(directory, { recursive: true });
  const server = spawn(process.execPath, ["--import", "./tests/ui-transport.mjs", "node_modules/next/dist/bin/next", "start", process.env.RIDEFLOW_TEST_APP_DIR || ".", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, NODE_ENV: "production", JWT_SECRET: secret, RIDEFLOW_BUSINESS_JOURNAL_ENABLED: "false",
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
    let sequence = 0; const pending = new Map(), exceptions = [], protocolMessages = [];
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      protocolMessages.push(message);
      if (message.id) {
        const entry = pending.get(message.id); if (!entry) return;
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message)); else entry.resolve(message.result);
      }
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text);
    };
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}; received ${JSON.stringify(protocolMessages.slice(-3))}`)); }, 10000);
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

    await setRole("DRIVER",{userId:"20000000-0000-4000-8000-000000000011",role:"DRIVER",name:"UI Test Driver",email:"ui-driver@test.invalid"});
    await navigate("/driver/trips", ".data-table tbody tr");
    const completedActions = "[...document.querySelectorAll('.trip-actions')]";
    assert.equal(await evaluate(`${completedActions}.every(actions=>actions.innerText.includes('Đã hoàn thành chuyến') && [...actions.querySelectorAll('button')].every(button=>button.textContent==='Xem thanh toán'))`),true);
    const assignment = await evaluate("fetch('/__tests/driver-assignment',{method:'POST'}).then(response=>response.json())");
    const route = `/driver/trips?tripId=${assignment.tripId}`;
    // navigate() checks pathname, so open the filtered route directly.
    await command("Page.navigate", { url: `http://127.0.0.1:${webPort}${route}` });
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===1 && !!document.querySelector('.trip-actions button')"));
    await evaluate("window.confirm=()=>false; document.querySelector('.trip-actions button').click()");
    assert.equal(await evaluate("window.__p1Calls.some(call=>call.method==='PATCH' && call.url.endsWith('/status'))"),false);
    await evaluate("window.confirm=()=>true; window.__completionFetch=window.fetch; window.__failCompletion=true; window.fetch=async(url,options={})=>{if(window.__failCompletion && options.method==='PATCH' && String(url).endsWith('/status')){window.__failCompletion=false;return new Response(JSON.stringify({success:false,message:'Completion test: retry request'}),{status:503,headers:{'Content-Type':'application/json'}});}return window.__completionFetch(url,options);}; document.querySelector('.trip-actions button').click()");
    await poll(()=>evaluate("window.__p1Alerts.includes('Completion test: retry request') && !document.querySelector('.trip-actions button').disabled"));
    assert.equal(await evaluate("!!document.querySelector('.status-booked') && !document.querySelector('.inline-success')"),true);
    for (const [label,status] of [["Đã nhận","ACCEPTED"],["Đang đến","ARRIVING"],["Đang đi","IN_PROGRESS"],["Hoàn thành","COMPLETED"]]) {
      await evaluate(`(() => { const button=[...document.querySelectorAll('.trip-actions button')].find(button=>button.textContent===${JSON.stringify(label)}); if(!button) throw new Error('Missing action: '+${JSON.stringify(label)}); button.click(); })()`);
      await poll(()=>evaluate(`!!document.querySelector('.status-${status.toLowerCase()}') && !document.querySelector('.loading-panel')`));
    }
    assert.equal(await evaluate("document.querySelector('.inline-success[role=status]')?.innerText.includes('ghi nhận đã thu tiền mặt')"),true);
    assert.deepEqual(await evaluate("[...document.querySelectorAll('.trip-actions button')].map(button=>button.textContent)"),["Xem thanh toán"]);
    await evaluate("document.querySelector('.trip-actions button').click()");
    await poll(()=>evaluate("document.querySelector('.payment-panel')?.innerText.includes('Đã thanh toán')"));
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"driver-completion.png"),Buffer.from(result.data,"base64")));
    await evaluate("document.querySelector('.payment-close').click()");
    await command("Page.reload");
    await poll(()=>evaluate("document.querySelectorAll('.data-table tbody tr').length===1 && !!document.querySelector('.status-completed')"));
    assert.equal(await evaluate(`${completedActions}.every(actions=>actions.innerText.includes('Đã hoàn thành chuyến') && [...actions.querySelectorAll('button')].every(button=>button.textContent==='Xem thanh toán'))`),true);

    // Completed bank trips retain the separate receipt-confirmation workflow.
    const bankTrip = "20000000-0000-4000-8000-000000000042";
    await command("Page.navigate", { url: `http://127.0.0.1:${webPort}/driver/trips?tripId=${bankTrip}` });
    await poll(()=>evaluate(`document.querySelector('.table-search input')?.value===${JSON.stringify(bankTrip)} && document.querySelectorAll('.data-table tbody tr').length===1 && !!document.querySelector('.status-completed')`));
    await evaluate("document.querySelector('.trip-actions button').click()");
    await poll(()=>evaluate("document.querySelector('.payment-panel')?.innerText.includes('Chờ thanh toán')"));
    await evaluate("[...document.querySelectorAll('.payment-panel button')].find(button=>button.textContent==='Xác nhận đã nhận tiền').click()");
    await poll(()=>evaluate("document.querySelector('.payment-panel')?.innerText.includes('Đã xác nhận đã nhận tiền') && document.querySelector('.payment-summary')?.innerText.includes('Đã thanh toán')"));
    assert.deepEqual(exceptions,[]);
    await writeFile(path.join(directory,"result.json"),JSON.stringify({passed:true,transport:"in-memory Cassandra; no live database",exceptions},null,2));
    console.log(`PASS: cancel, retry, status progression, cash receipt, success feedback, reload and bank receipt. Evidence: ${directory}`);
  } catch (error) {
    await writeFile(path.join(directory,"server.log"),serverLog);
    throw error;
  } finally {
    socket?.close(); if(chrome) await stop(chrome); await stop(server);
  }
});
