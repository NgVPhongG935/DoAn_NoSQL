import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
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

test("real Chrome: blocked primary map falls back to real FOSSGIS tiles", { timeout: 90000 }, async () => {
  const webPort = await port(), debugPort = await port();
  const secret = randomBytes(48).toString("base64url");
  const directory = path.resolve(".tmp", `p1-browser-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const server = spawn(process.execPath, ["--import", "./tests/ui-transport.mjs", "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(webPort)], {
    windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: {
      ...process.env, NODE_ENV: "production", JWT_SECRET: secret, RIDEFLOW_BUSINESS_JOURNAL_ENABLED: "true",
      ADMIN_EMAIL: "ui-admin@test.invalid", ADMIN_PASSWORD_HASH: "",
      ADMIN_PERMISSIONS: "customers:read,drivers:read,vehicles:read,vehicles:write,services:read,services:write,vouchers:read,vouchers:write,notifications:read,notifications:write,reports:read",
      CASSANDRA_KEYSPACE: "rideflow_p1_ui_memory_only", CASSANDRA_PORT: String(await port()),
    },
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk; }); server.stderr.on("data", (chunk) => { serverLog += chunk; });
  let chrome, socket;
  try {
    await poll(async () => (await fetch(`http://127.0.0.1:${webPort}/api/auth/me`)).status === 401);
    chrome = spawn(process.env.RIDEFLOW_TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-crash-reporter", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${directory}`, "about:blank"], { windowsHide: true, stdio: "ignore" });
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

    await command("Emulation.setDeviceMetricsOverride", {width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await command("Network.setBlockedURLs", {urls:["*://tile.openstreetmap.org/*"]});
    const user = {userId:"20000000-0000-4000-8000-000000000001",role:"CUSTOMER",name:"UI Test Customer",email:"ui-customer@test.invalid"};
    const token = await new SignJWT(user).setProtectedHeader({alg:"HS256"}).setIssuer("rideflow").setAudience("rideflow-session").setSubject(user.userId).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(secret));
    await command("Network.setCookie",{name:"rideflow_session",value:token,url:`http://127.0.0.1:${webPort}`,httpOnly:true,sameSite:"Lax"});
    await command("Page.addScriptToEvaluateOnNewDocument",{source:`
      const realFetch=window.fetch;
      window.fetch=async (url,opts)=>{
        if(String(url).startsWith('/api/maps/geocode')) {
          const end=String(url).includes('Destination');
          return Response.json({success:true,data:[{label:end?'Destination test':'Pickup test',lat:end?10.78:10.7769,lng:end?106.71:106.7009}]});
        }
        if(String(url)==='/api/maps/route') {const {pickup,destination}=JSON.parse(opts.body);return Response.json({success:true,data:{pickup,destination,distanceKm:1.2,durationMinutes:5,geometry:[[pickup.lat,pickup.lng],[destination.lat,destination.lng]]}});}
        return realFetch(url,opts);
      };
    `});
    await command("Page.navigate",{url:`http://127.0.0.1:${webPort}/customer/booking`});
    await poll(()=>evaluate("!!document.querySelector('.leaflet-map')"));
    await poll(()=>evaluate("[...document.querySelectorAll('img.leaflet-tile')].some(i=>i.src.includes('tile.openstreetmap.de') && i.complete && i.naturalWidth>0)"));
    for(const [kind,value] of [['pickup','Pickup'],['destination','Destination']]) {
      await evaluate(`(()=>{const i=document.querySelector('#address-${kind}');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'${value}');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await poll(()=>evaluate("!!document.querySelector('.address-suggestions button')"));
      await evaluate("document.querySelector('.address-suggestions button').click()");
    }
    await poll(()=>evaluate("document.querySelectorAll('.ride-map-marker').length===2 && !!document.querySelector('.leaflet-overlay-pane path')"));
    await poll(()=>evaluate("!document.querySelector('.map-error-message') && [...document.querySelectorAll('img.leaflet-tile')].some(i=>i.src.includes('tile.openstreetmap.de') && i.complete && i.naturalWidth>0)"));
    await evaluate("document.querySelector('.real-map').scrollIntoView({block:'center'})");
    await poll(()=>evaluate("[...document.querySelectorAll('img.leaflet-tile')].filter(i=>i.src.includes('tile.openstreetmap.de')).every(i=>i.complete && i.naturalWidth>0)"));
    const tiles=await evaluate("[...document.querySelectorAll('img.leaflet-tile')].filter(i=>i.complete && i.naturalWidth>0).length");
    assert.ok(tiles>0);
    assert.deepEqual(exceptions,[]);
    await command("Page.captureScreenshot",{format:"png"}).then(r=>writeFile('docs/evidence/MAP_FALLBACK_2026-10-21.png',Buffer.from(r.data,'base64')));
    await writeFile('docs/evidence/MAP_FALLBACK_2026-10-21.json',JSON.stringify({passed:true,realBrowser:true,realTileProvider:'tile.openstreetmap.de',primaryBlocked:true,loadedTiles:tiles,markers:2,routeRendered:true,cassandra:'mock, no live writes',geocodingAndRoute:'fixture',exceptions},null,2));
    console.log('Real Chrome: real fallback tiles loaded; two markers and route visible; no live Cassandra writes.');
  } catch(error) {await writeFile(path.join(directory,'server.log'),serverLog);throw error;}
  finally {socket?.close();if(chrome)await stop(chrome);await stop(server);}
});
