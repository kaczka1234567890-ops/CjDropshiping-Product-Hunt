import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname } from "node:path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9333;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r; } catch {}
    await sleep(250);
  }
  throw new Error("timeout waiting for " + url);
}

export async function shoot({ url, out, width = 1280, height = 800, scrollTo = 0, waitMs = 4000, settleMs = 1200, action = null, actionWaitMs = 0, check = null }) {
  let actionResult, checkResult;
  const udd = `${process.env.TEMP}\\cdpshoot-${Date.now()}`;
  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--no-default-browser-check", "--remote-allow-origins=*",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`,
    `--window-size=${width},${height}`, "about:blank"
  ], { stdio: "ignore" });

  const kill = () => { try { chrome.kill(); } catch {} try { rmSync(udd, { recursive: true, force: true }); } catch {} };
  let ws;
  try {
    await waitFor(`http://127.0.0.1:${PORT}/json/version`);
    const res = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    const target = await res.json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });

    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (m) => m.error ? reject(new Error(method + ": " + JSON.stringify(m.error))) : resolve(m.result));
      ws.send(JSON.stringify({ id: i, method, params }));
    });

    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url });
    await sleep(waitMs);
    if (scrollTo) {
      await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollTo});` });
      await sleep(settleMs);
    }
    if (action) {
      const r = await send("Runtime.evaluate", { expression: action, awaitPromise: true });
      actionResult = r.result && r.result.value;
      await sleep(actionWaitMs || settleMs);
    }
    if (typeof check === "string") {
      const c = await send("Runtime.evaluate", { expression: check });
      checkResult = c.result && c.result.value;
    }
    const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, Buffer.from(shot.data, "base64"));
    ws.close();
    kill();
    return { out, actionResult, checkResult };
  } catch (e) {
    kill();
    throw e;
  }
}
