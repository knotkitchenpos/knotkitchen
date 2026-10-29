import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

// The real public/sw.js, run against a pretend browser: its cache, and a
// network that answers, fails (offline) or hangs ("Wi-Fi but no internet").

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ORIGIN = "https://business.knotkitchen.com";
const FILES = ["/assets/index-a1.js", "/assets/Orders-b2.js", "/assets/Tables-c3.js", "/assets/index-d4.css"];

const keyOf = (req) => new URL(typeof req === "string" ? req : req.url, ORIGIN).pathname;

/** A worker with its own caches and a network `net` (url, request) => Promise<Response>. */
const worker = (net) => {
  const stores = new Map();
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    return {
      put: async (req, res) => void m.set(keyOf(req), res),
      match: async (req) => m.get(keyOf(req))?.clone(),
      keys: async () => [...m.keys()],
    };
  };
  const caches = {
    open: async (name) => cacheFor(name),
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    match: async (req) => {
      for (const m of stores.values()) if (m.has(keyOf(req))) return m.get(keyOf(req)).clone();
      return undefined;
    },
  };
  const handlers = {};
  const self = {
    location: new URL(ORIGIN),
    addEventListener: (type, fn) => void (handlers[type] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const source = fs
    .readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8")
    .replace('"__KK_BUILD_ID__"', '"test1"')
    .replace('["__KK_PRECACHE__"]', JSON.stringify(FILES))
    .replace("const NAV_TIMEOUT_MS = 4000;", "const NAV_TIMEOUT_MS = 50;");
  const fetch = (input) => {
    const url = keyOf(input);
    return net(url, input);
  };
  vm.runInNewContext(source, { self, caches, fetch, Request, Response, URL, setTimeout, Promise, console });

  const run = async (type, request) => {
    let waited;
    let answer;
    handlers[type]({
      request,
      waitUntil: (p) => void (waited = p),
      respondWith: (p) => void (answer = p),
    });
    if (waited) await waited;
    return answer;
  };
  const navigate = (p) => run("fetch", { method: "GET", url: ORIGIN + p, mode: "navigate" });
  return { run, navigate, stores, caches };
};

const page = (text) => new Response(text, { status: 200, headers: { "content-type": "text/html" } });
const online = (url) => Promise.resolve(url === "/" ? page("<html>shell</html>") : new Response("file " + url));
const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const hanging = () => new Promise(() => {});

test("install stores every file of the build and the shell", async () => {
  const sw = worker(online);
  await sw.run("install", {});
  const stored = await (await sw.caches.open("knotkitchen-shell-test1")).keys();
  for (const f of [...FILES, "/"]) assert.ok(stored.includes(f), f + " stored");
});

test("offline: opening any page gives the stored shell", async () => {
  let net = online;
  const sw = worker((url, req) => net(url, req));
  await sw.run("install", {});
  net = offline;
  const res = await sw.navigate("/orders");
  assert.equal(await res.text(), "<html>shell</html>");
});

test("Wi-Fi but no internet: after the time limit the stored shell, not an endless wait", async () => {
  let net = online;
  const sw = worker((url, req) => net(url, req));
  await sw.run("install", {});
  net = hanging;
  const res = await sw.navigate("/");
  assert.equal(await res.text(), "<html>shell</html>");
});

test("online: the fresh page, and it becomes the stored shell", async () => {
  let net = online;
  const sw = worker((url, req) => net(url, req));
  await sw.run("install", {});
  net = (url) => Promise.resolve(url.startsWith("/") ? page("<html>new build</html>") : new Response(""));
  const res = await sw.navigate("/");
  assert.equal(await res.text(), "<html>new build</html>");
  await new Promise((r) => setTimeout(r, 10));
  net = offline;
  assert.equal(await (await sw.navigate("/")).text(), "<html>new build</html>");
});

test("a page's code is served from the store offline, even if it was never opened", async () => {
  let net = online;
  const sw = worker((url, req) => net(url, req));
  await sw.run("install", {});
  net = offline;
  const res = await sw.run("fetch", { method: "GET", url: ORIGIN + "/assets/Tables-c3.js", mode: "no-cors" });
  assert.equal(await res.text(), "file /assets/Tables-c3.js");
});

test("API calls are never answered from the store", async () => {
  const sw = worker(online);
  await sw.run("install", {});
  const res = await sw.run("fetch", { method: "GET", url: ORIGIN + "/api/order", mode: "cors" });
  assert.equal(res, undefined, "left to the network (the offline queue and saved copies handle data)");
});
