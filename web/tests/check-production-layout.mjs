// Requires a task-local Chromium with --remote-debugging-port; no browser dependency.
import assert from "node:assert/strict";
const [base, debugging = "http://127.0.0.1:9228"] = process.argv.slice(2);
if (!base) throw Error("Usage: node web/tests/check-production-layout.mjs <production URL> [Chromium debugging URL]");
assert((await fetch(new URL("/api/health", base))).ok, "Production server must be ready before browser QA");
const pages = await fetch(debugging + "/json/list").then(r => r.json());
const socket = new WebSocket(pages.find(p => p.type === "page").webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
let id = 0;
const pending = new Map(), exceptions = [], failedAssets = [];
socket.addEventListener("message", ({ data }) => {
  const m = JSON.parse(data);
  if (m.id) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails);
  else if (m.method === "Network.responseReceived" && m.params.response.url.includes("/_next/") && m.params.response.status >= 400) failedAssets.push(m.params.response);
  else if (m.method === "Network.loadingFailed" && !m.params.canceled) failedAssets.push(m.params);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const requestId = ++id, timer = setTimeout(() => { pending.delete(requestId); reject(Error("CDP timeout: " + method)); }, 15000);
  pending.set(requestId, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } });
  socket.send(JSON.stringify({ id: requestId, method, params }));
});
const evaluate = async expression => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
  return r.result.value;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wait = async expression => {
  for (let i = 0; i < 150; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw Error("Renderer did not become ready: " + expression);
};
try {
  await Promise.all(["Runtime.enable", "Network.enable", "Page.enable"].map(m => send(m)));
  await send("Page.navigate", { url: base });
  await wait("!!document.querySelector('button.justify-start.border-border')");
  for (const [name, width, height, mobile] of [["desktop", 1920, 1080, false], ["portrait", 390, 844, true], ["landscape", 844, 390, true]]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
    await evaluate("localStorage.setItem('showOnboarding','false');localStorage.setItem('showInformationCard','true');localStorage.setItem('imageBatchMode','false');localStorage.setItem('showSidebar','true')");
    await send("Page.reload", { ignoreCache: true }); await sleep(800);
    await wait("!!document.querySelector('button.justify-start.border-border')");
    const metrics = await evaluate(`(() => {
      const sidebar=[...document.querySelectorAll('div')].find(e=>e.classList.contains('min-w-[350px]'));
      const shell=sidebar.parentElement, main=shell.lastElementChild;
      const rect=e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,x:r.x,y:r.y}};
      const logos=[...document.querySelectorAll('svg')].filter(s=>s.querySelector('path') && s.getBoundingClientRect().width>50);
      const background=getComputedStyle(document.body).backgroundColor;
      const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle=background;ctx.fillRect(0,0,1,1);
      return {background,backgroundRGBA:[...ctx.getImageData(0,0,1,1).data],display:getComputedStyle(shell).display,sidebar:rect(sidebar),main:rect(main),logos:logos.map(rect),theme:document.documentElement.getAttribute('data-theme')};
    })()`);
    assert(metrics.backgroundRGBA[3] === 255 && metrics.backgroundRGBA.slice(0,3).every(channel=>channel<80), `${name}: unstyled body ${metrics.background}`);
    assert.equal(metrics.display, "flex", name);
    assert.equal(metrics.sidebar.width, 350, name);
    assert(metrics.main.width > 0 && metrics.main.height >= height - 5, `${name}: missing main/drop region`);
    assert(metrics.logos.length && metrics.logos.every(r => r.width <= 220 && r.height <= 220), `${name}: unbounded logo`);
    // On narrow screens use the existing sidebar toggle to expose the full drop area.
    if (mobile) {
      await evaluate("([...document.querySelectorAll('div')].find(e=>e.classList.contains('min-w-[350px]'))).querySelector(':scope > button').click()");
      await wait("([...document.querySelectorAll('div')].find(e=>e.classList.contains('min-w-[350px]'))).getBoundingClientRect().width===0");
      assert(await evaluate("[...document.querySelectorAll('div')].some(e=>e.classList.contains('justify-center') && e.classList.contains('h-screen') && e.getBoundingClientRect().width >= innerWidth-5)"), `${name}: drop area not usable after hiding sidebar`);
      assert(await evaluate("(()=>{const p=[...document.querySelectorAll('p')].find(e=>e.textContent.includes('drag and drop'));if(!p)return false;const r=p.getBoundingClientRect();return r.width>0&&r.height>0&&r.x<innerWidth&&r.y<innerHeight&&r.right>0&&r.bottom>0})()"), `${name}: drop instructions not visible`);
      await evaluate("localStorage.setItem('showSidebar','true')"); await send("Page.reload", { ignoreCache: true }); await sleep(800);
    }
    await evaluate("([...document.querySelectorAll('label')].find(e=>e.innerText.trim()==='Batch images')).querySelector('input').click()");
    await wait("!!document.querySelector('main') && document.body.innerText.includes('Add images')");
    if (mobile) {
      await evaluate("([...document.querySelectorAll('div')].find(e=>e.classList.contains('min-w-[350px]'))).querySelector(':scope > button').click()");
      await wait("document.querySelector('main').getBoundingClientRect().width>=innerWidth-5");
    }
    const batch = await evaluate("(()=>{const m=document.querySelector('main'),r=m.getBoundingClientRect();return {padding:getComputedStyle(m).paddingTop,width:r.width,height:r.height}})()");
    assert(parseFloat(batch.padding) >= 16); assert(batch.width > 0 && batch.height > 100);
    console.log(name, JSON.stringify({ ...metrics, batch }));
  }
  assert.equal(exceptions.length, 0, JSON.stringify(exceptions));
  assert.equal(failedAssets.length, 0, JSON.stringify(failedAssets));
  console.log("Production browser layout OK: desktop, portrait, landscape; no failed assets or JS exceptions");
} finally { socket.close(); }
