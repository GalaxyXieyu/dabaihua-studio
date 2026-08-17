import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const runtime = path.join(os.homedir(), ".moore", "wechat-article-downloader");
const profile = path.join(runtime, `sites-chrome-profile-${process.pid}`);
const CDP_COMMAND_TIMEOUT_MS = 30_000;
const BROWSER_FETCH_TIMEOUT_MS = 90_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForFile(file, timeout = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { return await readFile(file, "utf8"); }
    catch { await delay(100); }
  }
  throw new Error("浏览器采集桥启动超时");
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
    const rejectPending = () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("浏览器采集桥连接已关闭"));
      }
      this.pending.clear();
    };
    socket.addEventListener("close", rejectPending);
    socket.addEventListener("error", rejectPending);
  }

  send(method, params = {}, sessionId, timeout = CDP_COMMAND_TIMEOUT_MS) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`浏览器采集桥请求超时：${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
}

let browserPromise;

async function startBrowser() {
  await mkdir(profile, { recursive: true });
  const activePort = path.join(profile, "DevToolsActivePort");
  await rm(activePort, { force: true });
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-features=Translate",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore" });
  const [port, browserPath] = (await waitForFile(activePort)).trim().split("\n");
  const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  const client = new CdpClient(socket);
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Network.enable", {}, sessionId);
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  const close = () => {
    socket.close();
    child.kill("SIGTERM");
  };
  process.once("exit", close);
  return { client, sessionId, origins: new Set(), close };
}

function browser() {
  browserPromise ||= startBrowser();
  return browserPromise;
}

export async function sitesBrowserFetch(url, options = {}) {
  const active = await browser();
  const { client, sessionId } = active;
  const headers = Object.fromEntries(Object.entries(options.headers || {}).map(([key, value]) => [key, String(value)]));
  await client.send("Network.setExtraHTTPHeaders", { headers }, sessionId);
  const origin = new URL(url).origin;
  if (!active.origins.has(origin)) {
    await client.send("Page.navigate", { url: origin }, sessionId);
    await delay(2_500);
    active.origins.add(origin);
  }
  const body = options.body == null
    ? null
    : Buffer.isBuffer(options.body) || options.body instanceof Uint8Array
      ? Buffer.from(options.body).toString("base64")
      : Buffer.from(String(options.body)).toString("base64");
  const expression = `(async () => {
    const binary = ${JSON.stringify(body)};
    const response = await fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(options.method || "GET")},
      headers: ${JSON.stringify(headers)},
      body: binary === null ? undefined : Uint8Array.from(atob(binary), character => character.charCodeAt(0)),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    let raw = "";
    for (let index = 0; index < bytes.length; index += 0x8000) raw += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    return { status: response.status, ok: response.ok, body: btoa(raw), contentType: response.headers.get("content-type") || "" };
  })()`;
  const result = await client.send(
    "Runtime.evaluate",
    { expression, awaitPromise: true, returnByValue: true },
    sessionId,
    BROWSER_FETCH_TIMEOUT_MS,
  );
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "浏览器采集桥请求失败");
  const value = result.result?.value;
  if (!value || typeof value.status !== "number") throw new Error("浏览器采集桥没有返回结果");
  return {
    ok: value.ok,
    status: value.status,
    contentType: value.contentType,
    body: Buffer.from(value.body, "base64"),
    async json() { return JSON.parse(this.body.toString("utf8")); },
    async text() { return this.body.toString("utf8"); },
  };
}

export async function closeSitesBrowser() {
  if (!browserPromise) return;
  const active = await browserPromise.catch(() => null);
  active?.close();
  await rm(profile, { force: true, recursive: true }).catch(() => undefined);
  browserPromise = undefined;
}
