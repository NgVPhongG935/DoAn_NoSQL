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

test("real Chrome: async forms, account CRUD, avatars, retry, month filter and vehicle key", { timeout: 120000 }, async () => {
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
    await command("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__p1Calls = []; window.__p1Alerts = [];
      window.confirm = () => true; window.alert = (text) => window.__p1Alerts.push(text);
      const original = window.fetch;
      window.fetch = async (url, options = {}) => {
        window.__p1Calls.push({url: String(url), method: options.method || 'GET'});
        if (location.pathname.endsWith('/dashboard') && String(url).startsWith('/api/dashboard') && window.__p1Calls.filter(call => call.url.startsWith('/api/dashboard')).length === 1)
          return new Response(JSON.stringify({success:false,message:'Test dashboard temporarily unavailable'}), {status:503,headers:{'Content-Type':'application/json'}});
        const fakeError = (message) => new Response(JSON.stringify({success:false,message}), {status:500,headers:{'Content-Type':'application/json'}});
        if(String(url).startsWith('/api/customers/') && String(url).endsWith('/payments') && sessionStorage.getItem('paymentHistoryMalformed')==='1')
          return new Response(JSON.stringify({success:true,data:{payments:[]}}),{headers:{'Content-Type':'application/json'}});
        if(String(url)==='/api/admin/complaints' && sessionStorage.getItem('supportEmpty')==='1')
          return new Response(JSON.stringify({success:true,data:[]}), {headers:{'Content-Type':'application/json'}});
        if(String(url)==='/api/admin/notifications?recipients=true' && sessionStorage.getItem('supportRecipientsFail')==='1') return fakeError('Test recipient request failed');
        if(String(url)==='/api/admin/notifications' && !options.method && sessionStorage.getItem('supportListFail')==='1') return fakeError('Test list request failed');
        if(String(url).startsWith('/api/admin/notifications/') && options.method==='PATCH' && sessionStorage.getItem('supportMarkFail')==='1'){
          sessionStorage.removeItem('supportMarkFail');return fakeError('Test mark-read request failed');
        }
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
    const fillForm = (values) => evaluate(`(() => { const form = document.querySelector('form'); for (const [name,value] of Object.entries(${JSON.stringify(values)})) form.elements.namedItem(name).value=value; form.requestSubmit(); })()`);

    await setRole("CUSTOMER");
    await navigate("/customer/dashboard", ".data-error button");
    await evaluate("document.querySelector('.data-error button').click()");
    await poll(() => evaluate("!document.querySelector('.data-error') && window.__p1Calls.filter(call => call.url.startsWith('/api/dashboard')).length >= 2"));
    assert.equal(await evaluate("!!document.querySelector('input[type=month]')"), true);
    await evaluate("(() => { const input=document.querySelector('input[type=month]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-09'); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); })()");
    await poll(() => evaluate("window.__p1Calls.some(call => call.url === '/api/dashboard?month=2026-09')"));
    console.log("PASS Chrome dashboard retry issues a second request; Customer month selector changes the API query.");

    await navigate("/customer/complaints", "input[name=subject]");
    await fillForm({ subject: "UI complaint", content: "UI async complaint details", tripId: "20000000-0000-4000-8000-000000000041" });
    await poll(() => evaluate("!!document.querySelector('.inline-success') && !!document.querySelector('input[name=subject]') && document.querySelector('input[name=subject]').value === '' && document.body.innerText.includes('UI complaint')"));
    assert.equal(await evaluate("!!document.querySelector('.data-error')"), false);
    console.log("PASS Chrome complaint form resets after await and reloads the saved record.");

    await navigate("/customer/trips/20000000-0000-4000-8000-000000000041", ".detail-fare");
    assert.equal(await evaluate("document.querySelector('.detail-fare').textContent"), "0 ₫");
    await poll(()=>evaluate("document.querySelector('.payment-panel').innerText.includes('Tiền mặt')"));
    console.log("PASS Chrome trip detail displays fare zero and the Vietnamese cash payment label.");
    await evaluate("document.querySelector('.review-start button').click()");
    await evaluate("document.querySelector('button[aria-label=\"4 sao\"]').click()");
    await evaluate("(() => {const input=document.querySelector('.review-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'UI review persisted');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await evaluate("new Promise(resolve=>setTimeout(resolve,20))");
    await evaluate("document.querySelector('.review-form').requestSubmit()");
    await poll(()=>evaluate("document.querySelector('.existing-review')?.innerText.includes('UI review persisted') && document.querySelector('.existing-review').innerText.includes('4/5')"));
    assert.equal(await evaluate("!!document.querySelector('.existing-review button')"),false);
    await navigate("/customer/booking",".payment-select select");
    assert.deepEqual(await evaluate("[...document.querySelectorAll('select option')].filter(option=>['CASH','BANK_TRANSFER','CARD','WALLET'].includes(option.value)).map(option=>({value:option.value,label:option.textContent}))"),[{value:"CASH",label:"Tiền mặt"},{value:"BANK_TRANSFER",label:"Chuyển khoản"}]);
    assert.equal(await evaluate("document.querySelector('option[value=CASH]').parentElement.value"),"CASH");
    await evaluate("(() => {const select=document.querySelector('option[value=BANK_TRANSFER]').parentElement;select.value='BANK_TRANSFER';select.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await poll(()=>evaluate("document.querySelector('.payment-instructions').innerText.includes('gửi yêu cầu xác nhận thanh toán')"));
    await navigate("/customer/trips/20000000-0000-4000-8000-000000000042",".payment-panel");
    await poll(()=>evaluate("document.querySelector('.payment-panel').innerText.includes('Chờ thanh toán')"));
    assert.equal(await evaluate("!document.querySelector('.payment-demo-notice') && !document.querySelector('.bank-details') && !document.querySelector('.payment-panel').innerText.includes('demo')"),true);
    assert.equal(await evaluate("document.querySelector('.payment-transfer-details').innerText.includes('RIDEFLOW 20000000-0000-4000-8000-000000000042') && document.querySelector('.payment-transfer-details').innerText.includes('Mã chuyến đi') && document.querySelector('.payment-transfer-details').innerText.includes('Nội dung chuyển khoản')"),true);
    await evaluate("document.querySelector('.payment-panel .button').click()");
    await poll(()=>evaluate("document.querySelector('.payment-panel').innerText.includes('Đang chờ tài xế xác nhận đã nhận tiền')"));
    await navigate("/customer/payments",".data-table tbody tr");
    assert.equal(await evaluate("[...document.querySelectorAll('.data-table tbody tr')].some(row=>row.innerText.includes('#2BE76152')&&row.innerText.includes('58.350')&&row.innerText.includes('Tiền mặt')&&row.innerText.includes('Đã thanh toán'))"),true);
    await evaluate("sessionStorage.setItem('paymentHistoryMalformed','1')");
    await navigate("/customer/payments",".data-error");
    assert.equal(await evaluate("document.querySelector('.data-error').innerText.includes('sai định dạng') && !document.body.innerText.includes('Chưa có dữ liệu hiển thị')"),true);
    await evaluate("sessionStorage.removeItem('paymentHistoryMalformed');document.querySelector('.data-error button').click()");
    await poll(()=>evaluate("!!document.querySelector('.data-table tbody tr') && !document.querySelector('.data-error')"));
    assert.equal(await evaluate("document.querySelector('.data-table').innerText.includes('#2BE76152')"),true);
    assert.equal(await evaluate("document.querySelector('.data-table').innerText.includes('Tiền mặt') && document.querySelector('.data-table').innerText.includes('Chuyển khoản') && !document.querySelector('.data-table').innerText.includes('BANK_TRANSFER') && !document.querySelector('.data-table').innerText.includes('demo')"),true);
    assert.equal(await evaluate("[...document.querySelectorAll('.data-table tbody tr')].find(row=>row.innerText.includes('Chuyển khoản')).innerText.includes('Chờ tài xế xác nhận')"),true);
    console.log("PASS Chrome Customer reports transfer without demo wording; request waits for Driver confirmation and old cash history remains.");

    await setRole("DRIVER",{userId:"20000000-0000-4000-8000-000000000011",role:"DRIVER",name:"UI Test Driver",email:"ui-driver@test.invalid"});
    await navigate("/driver/trips", ".data-table tbody tr");
    await evaluate("[...document.querySelectorAll('.data-table tbody tr')].find(row=>row.innerText.includes('20000000-0000-4000-8000-000000000042')).querySelector('.table-action').click()");
    await poll(()=>evaluate("document.querySelector('.payment-panel').innerText.includes('Xác nhận đã nhận tiền')"));
    await evaluate("[...document.querySelectorAll('.payment-panel button')].find(button=>button.textContent.includes('Xác nhận đã nhận tiền')).click()");
    await poll(()=>evaluate("document.querySelector('.payment-panel').innerText.includes('Đã xác nhận đã nhận tiền')"));
    assert.equal(await evaluate("!document.querySelector('.payment-panel').innerText.includes('demo')"),true);
    await setRole("ADMIN");
    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await navigate("/admin/payments",".data-table tbody tr");
    await evaluate("[...document.querySelectorAll('.data-table tbody tr')].find(row=>row.innerText.includes('Chuyển khoản')).querySelector('button').click()");
    await poll(()=>evaluate("document.querySelector('.payment-panel').innerText.includes('Đã thanh toán')"));
    assert.equal(await evaluate("document.querySelector('.payment-dialog-backdrop').parentElement === document.body"),true);
    assert.equal(await evaluate("(() => { const r=document.querySelector('.payment-dialog').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.left>=0 && r.right<=innerWidth; })()"),true);
    assert.equal(await evaluate("document.body.style.overflow === 'hidden' && document.activeElement === document.querySelector('.payment-close')"),true);
    assert.equal(await evaluate("!document.querySelector('.payment-panel').innerText.includes('Xác nhận đã nhận tiền') && !document.querySelector('.payment-panel').innerText.includes('demo')"),true);
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"payments-confirmed.png"),Buffer.from(result.data,"base64")));
    await navigate("/admin/reviews",".data-table tbody tr");
    assert.equal(await evaluate("document.querySelector('.data-table').innerText.includes('UI review persisted')"),true);
    await setRole("DRIVER",{userId:"20000000-0000-4000-8000-000000000011",role:"DRIVER",name:"UI Test Driver",email:"ui-driver@test.invalid"});
    await navigate("/driver/reviews",".data-table tbody tr");
    assert.equal(await evaluate("document.querySelector('.data-table').innerText.includes('UI review persisted')"),true);
    await setRole("CUSTOMER");
    await navigate("/customer/payments",".data-table tbody tr");
    assert.equal(await evaluate("document.querySelector('.data-table').innerText.includes('Đã thanh toán')"),true);
    await setRole("ADMIN");
    console.log("PASS Chrome assigned Driver confirms received transfer; Customer history and Admin read the resulting paid status.");
    await navigate("/admin/complaints", ".admin-support .complaint-card");
    await evaluate("document.querySelector('.support-details summary').click()");
    assert.equal(await evaluate("document.querySelector('.complaint-card').innerText.includes('UI async complaint details') && document.querySelector('.complaint-card').innerText.includes('20000000-0000-4000-8000-000000000041')"),true);
    await evaluate("[...document.querySelectorAll('.complaint-card button')].find(button=>button.textContent==='Bắt đầu xử lý').click()");
    await poll(()=>evaluate("document.querySelector('.complaint-card .status-pill').textContent==='Đang xử lý'"));
    await evaluate("[...document.querySelectorAll('.complaint-card button')].find(button=>button.textContent==='Đánh dấu đã giải quyết').click()");
    await poll(()=>evaluate("document.querySelector('.complaint-card .status-pill').textContent==='Đã giải quyết'"));
    await evaluate("sessionStorage.setItem('supportEmpty','1'); document.querySelector('.admin-support .page-heading button').click()");
    await poll(()=>evaluate("document.body.innerText.includes('Chưa có khiếu nại') && !document.querySelector('.complaint-card')"));
    await evaluate("sessionStorage.removeItem('supportEmpty'); document.querySelector('.admin-support .page-heading button').click()");
    await poll(()=>evaluate("!!document.querySelector('.complaint-card')"));
    await evaluate("document.querySelector('.support-details summary').click()");
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"admin-complaints.png"),Buffer.from(result.data,"base64")));
    console.log("PASS Chrome Admin complaint details, OPEN → PROCESSING → RESOLVED and the legitimate empty state.");

    await evaluate("sessionStorage.setItem('supportRecipientsFail','1')");
    await navigate("/admin/notifications", ".support-notifications tbody tr");
    await poll(()=>evaluate("document.querySelector('.support-compose .data-error')?.innerText.includes('Test recipient request failed')"));
    assert.equal(await evaluate("document.querySelectorAll('.support-notifications tbody tr').length"),1);
    await evaluate("sessionStorage.removeItem('supportRecipientsFail'); document.querySelector('.support-compose .data-error button').click()");
    await poll(()=>evaluate("!!document.querySelector('select[name=userId]') && !document.querySelector('.support-compose .data-error')"));
    await evaluate("sessionStorage.setItem('supportMarkFail','1'); document.querySelector('.support-notifications button').click()");
    await poll(()=>evaluate("document.querySelector('.admin-support > .data-error')?.innerText.includes('Test mark-read request failed')"));
    assert.equal(await evaluate("document.querySelectorAll('.support-notifications tbody tr').length"),1);
    await evaluate("document.querySelector('.support-notifications button').click()");
    await poll(()=>evaluate("!document.querySelector('.support-notifications button') && !document.querySelector('.admin-support > .data-error')"));
    const markUrl=await evaluate("window.__p1Calls.find(call=>call.method==='PATCH' && call.url.startsWith('/api/admin/notifications/')).url");
    assert.ok(markUrl.startsWith('/api/admin/notifications/20000000-0000-4000-8000-000000000001/'));
    assert.ok(!markUrl.includes('admin-demo'));
    await evaluate("sessionStorage.setItem('supportListFail','1'); document.querySelector('.admin-support .page-heading button').click()");
    await poll(()=>evaluate("document.querySelector('.admin-support > .data-error')?.innerText.includes('Test list request failed')"));
    assert.equal(await evaluate("document.querySelectorAll('.support-notifications tbody tr').length"),1);
    await evaluate("sessionStorage.removeItem('supportListFail'); document.querySelector('.admin-support > .data-error button').click()");
    await poll(()=>evaluate("!document.querySelector('.admin-support > .data-error') && document.querySelector('.support-list-panel h2').textContent==='1 / 1 bản ghi đã tải'"));
    assert.equal(await evaluate("document.querySelector('.support-list-panel h2').textContent"),'1 / 1 bản ghi đã tải');
    await evaluate("(() => {const input=document.querySelector('input[aria-label=\"Tìm trong danh sách\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'no-such-notification');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await poll(()=>evaluate("document.body.innerText.includes('Không có bản ghi phù hợp')"));
    await evaluate("(() => {const input=document.querySelector('input[aria-label=\"Tìm trong danh sách\"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await poll(()=>evaluate("!!document.querySelector('.support-notifications tbody tr')"));
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"admin-notifications.png"),Buffer.from(result.data,"base64")));
    console.log("PASS Chrome notifications isolate recipient/list/action failures, preserve loaded rows, use recipient UUIDs and retain search.");
    for (const [route, name, values, message] of [
      ["/admin/services", "serviceName", { serviceName: "UI_SERVICE", baseFare: "0", pricePerKm: "1000", description: "UI test" }, "Dịch vụ đã được thêm"],
      ["/admin/vouchers", "voucherCode", { voucherCode: "UI_TEST", voucherName: "UI Voucher", discountType: "PERCENT", discountValue: "100", maxDiscount: "50000", minTripAmount: "0", quantity: "1", startDate: "2026-10-01", endDate: "2099-01-01" }, "Voucher đã được ghi"],
      ["/admin/notifications", "title", { title: "UI notice", content: "UI notification details" }, "Thông báo đã được ghi"],
    ]) {
      await navigate(route, `[name=${name}]`); await fillForm(values);
      await poll(() => evaluate(`document.body.innerText.includes(${JSON.stringify(message)}) && !!document.querySelector('[name=${name}]') && document.querySelector('[name=${name}]').value === ''`));
      assert.equal(await evaluate("!!document.querySelector('.data-error')"), false);
      console.log(`PASS Chrome ${route} form resets and reports success after asynchronous save.`);
    }
    await navigate("/admin/vehicles", ".table-action");
    await evaluate("document.querySelector('.table-action').click()");
    await poll(() => evaluate("window.__p1Calls.some(call => call.method === 'PATCH')"));
    const update = await evaluate("window.__p1Calls.find(call => call.method === 'PATCH' && call.url.startsWith('/api/admin/vehicles/')).url");
    assert.equal(update, "/api/admin/vehicles/20000000-0000-4000-8000-000000000021");
    await poll(() => evaluate("document.body.innerText.includes('Tạm ngưng')"));
    assert.deepEqual(await evaluate("window.__p1Alerts"), []);
    assert.deepEqual(exceptions, []);
    console.log("PASS Chrome Admin vehicle action sends vehicle_id, preserves the row and updates its status.");

    const fillAccount = async (values) => {
      await evaluate(`(() => { const form=document.querySelector('.account-form'); for(const [name,value] of Object.entries(${JSON.stringify(values)})){ const input=form.elements.namedItem(name); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); } })()`);
      await evaluate("new Promise(resolve=>setTimeout(resolve,50))");
      await evaluate("document.querySelector('.account-form').requestSubmit()");
    };
    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    let createdDriver;
    const avatarFile=path.join(directory,"avatar.png");
    await writeFile(avatarFile,Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=","base64"));
    for(const resource of ["customers","drivers"]){
      const name=resource==="customers"?"UI New Customer":"UI New Driver",email=`new-${resource}@test.invalid`;
      await navigate(`/admin/${resource}`,".account-management .page-heading button");
      await evaluate("document.querySelector('.account-management .page-heading button').click()");
      await fillAccount({fullName:name,phone:"0901234567",email,password:"MockOnly@123",confirmPassword:"MockOnly@123",...(resource==="drivers"?{licenseNumber:"LICENSE-UI"}:{})});
      await poll(()=>evaluate(`!!document.querySelector('.inline-success') && document.querySelector('.data-table').innerText.includes(${JSON.stringify(email)}) && !document.querySelector('[name=password]')`));
      assert.equal(await evaluate("Object.keys(sessionStorage).some(key=>sessionStorage.getItem(key)?.includes('MockOnly@123'))"),false);
      const records=await evaluate(`fetch('/api/admin/${resource}').then(r=>r.json()).then(b=>b.data)`);
      const record=records.find(row=>row.email===email);
      assert.ok(record);assert.equal(record.password,undefined);
      if(resource==="drivers") createdDriver={userId:record.driver_id,name:record.full_name,email,role:"DRIVER"};
      await fillAccount({fullName:`${name} Edited`});
      await poll(()=>evaluate(`document.querySelector('.data-table').innerText.includes(${JSON.stringify(`${name} Edited`)})`));
      const document=await command("DOM.getDocument");
      const input=await command("DOM.querySelector",{nodeId:document.root.nodeId,selector:".account-form input[type=file]"});
      await command("DOM.setFileInputFiles",{nodeId:input.nodeId,files:[avatarFile]});
      await poll(()=>evaluate("document.querySelector('.avatar-editor-controls').innerText.includes('Đã cập nhật ảnh')"));
      await poll(()=>evaluate("[...document.querySelectorAll('.account-form img')].some(img=>img.complete && img.naturalWidth>0)"));
      await poll(()=>evaluate("!document.querySelector('.profile-trigger img')"));
      await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,`${resource}.png`),Buffer.from(result.data,"base64")));
      if(resource==="customers"){
        await evaluate(`(() => { const row=[...document.querySelectorAll('.data-table tbody tr')].find(row=>row.innerText.includes(${JSON.stringify(email)})); row.querySelector('.account-delete').click(); })()`);
        await poll(()=>evaluate(`document.querySelector('.inline-success')?.innerText.includes('Đã xóa') && !document.querySelector('.data-table').innerText.includes(${JSON.stringify(email)})`));
      }
    }
    console.log("PASS Chrome Admin creates and edits both account roles, uploads avatars, deletes an unused account and never caches passwords in sessionStorage.");

    // Existing completed-trip history must prevent deletion of the fixture account.
    await navigate("/admin/customers",".account-delete");
    await evaluate("document.querySelector('.account-delete').click()");
    await poll(()=>evaluate("document.querySelector('.data-error')?.innerText.includes('dữ liệu liên quan')"));
    assert.equal(await evaluate("document.querySelectorAll('.data-table tbody tr').length"),1);
    await setRole("DRIVER",createdDriver);
    await navigate("/driver/profile",".avatar-editor");
    await poll(()=>evaluate("[...document.querySelectorAll('.profile-hero img')].some(img=>img.complete && img.naturalWidth>0)"));
    assert.equal(await evaluate("document.body.innerText.includes('UI New Driver Edited')"),true);
    await evaluate("[...document.querySelectorAll('.avatar-editor button')].find(button=>button.textContent==='Ảnh mặc định').click()");
    await poll(()=>evaluate("document.querySelector('.avatar-editor-controls').innerText.includes('Đã dùng lại ảnh mặc định') && !document.querySelector('.profile-hero img')"));
    await poll(()=>evaluate("!document.querySelector('.profile-trigger img')"));
    await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await poll(()=>evaluate("document.querySelector('.portal-sidebar').getBoundingClientRect().right <= 1"));
    await evaluate("document.querySelector('.profile-trigger').click()");
    await poll(()=>evaluate("!!document.querySelector('.profile-dropdown .avatar-editor')"));
    assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"),true);
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"driver-avatar-mobile.png"),Buffer.from(result.data,"base64")));
    assert.deepEqual(exceptions,[]);
    console.log("PASS Chrome protects referenced accounts; Driver sees the Admin-uploaded avatar and can restore the default avatar.");
    await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await setRole("DRIVER",{userId:"20000000-0000-4000-8000-000000000011",role:"DRIVER",name:"UI Test Driver",email:"ui-driver@test.invalid"});
    await navigate("/driver/notifications",".notification-page");
    await poll(()=>evaluate("!document.querySelector('.loading-panel')"));
    const arrivalsBefore=await evaluate("window.__p1Calls.filter(call=>call.url==='/api/users/20000000-0000-4000-8000-000000000011/notifications').length");
    const newTrip=await evaluate("fetch('/__tests/driver-assignment',{method:'POST'}).then(r=>r.json())");
    try { await poll(()=>evaluate("!!document.querySelector('.driver-trip-alert') && document.querySelector('.notification-page').innerText.includes('Browser pickup')")); }
    catch { throw new Error(`Assignment poll failed: ${JSON.stringify(await evaluate("Promise.all([fetch('/api/users/20000000-0000-4000-8000-000000000011/notifications').then(r=>r.json()),fetch('/api/trips/20000000-0000-4000-8000-000000000043').then(r=>r.json())]).then(api=>({hidden:document.hidden,api,text:document.body.innerText.slice(-2200),calls:window.__p1Calls.slice(-15)}))"))}`); }
    assert.equal(await evaluate("document.querySelector('.notification-bell i')?.innerText"),"1");
    assert.ok(await evaluate("window.__p1Calls.filter(call=>call.url==='/api/users/20000000-0000-4000-8000-000000000011/notifications').length")>arrivalsBefore);
    assert.equal(await evaluate("document.querySelector('.notification-page').innerText.includes('Chuyến được phân công')"),true);
    await command("Page.captureScreenshot",{format:"png"}).then(result=>writeFile(path.join(directory,"driver-new-trip.png"),Buffer.from(result.data,"base64")));
    await evaluate("[...document.querySelectorAll('.notification-page button')].find(button=>button.textContent==='Đánh dấu đã đọc').click()");
    await poll(()=>evaluate("!document.querySelector('.notification-bell i')"));
    await evaluate("document.querySelector('.driver-trip-alert a').click()");
    await poll(()=>evaluate(`location.pathname==='/driver/trips' && document.querySelector('.table-search input')?.value===${JSON.stringify(newTrip.tripId)} && !!document.querySelector('.trip-actions button')`));
    assert.equal(await evaluate("document.querySelectorAll('.data-table tbody tr').length"),1);
    await evaluate("[...document.querySelectorAll('.trip-actions button')].find(button=>button.textContent==='Đã nhận').click()");
    await poll(()=>evaluate("document.querySelector('.data-table')?.innerText.includes('Đã nhận')"));
    assert.deepEqual(exceptions,[]);
    console.log("PASS Chrome Driver receives a new assignment without reload, sees the live unread badge/inbox, marks it read and opens the exact trip to accept it.");
    await writeFile(path.join(directory, "result.json"), JSON.stringify({ passed: true, transport: "in-memory Cassandra, not a live database", exceptions }, null, 2));
    await command("Page.captureScreenshot", { format: "png" }).then((result) => writeFile(path.join(directory, "vehicles.png"), Buffer.from(result.data, "base64")));
  } catch (error) {
    await writeFile(path.join(directory, "server.log"), serverLog);
    throw error;
  } finally {
    socket?.close(); if (chrome) await stop(chrome); await stop(server);
  }
});
