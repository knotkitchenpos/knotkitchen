import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
const BE = (rel) => fs.readFileSync(path.join(__dirname, "..", "..", "pos-backend", rel), "utf8");

/**
 * Live updates without a page refresh.
 *
 * The failure was quiet and complete: every screen used a TanStack query with
 * a 30-second staleTime and no polling, and nothing subscribed them to the
 * socket the server was already broadcasting on. A till sits focused all day,
 * so a stale query is never re-fetched -- a new order simply did not appear
 * until somebody reloaded the page.
 *
 * Three separate things had to be true, and none of them were.
 */

test("REGRESSION: the app subscribes to the socket, once", () => {
  const app = SRC("src/App.jsx");
  assert.match(app, /useRealtimeSync\(\);/, "nothing was listening on the main screens");
  assert.match(app, /import useRealtimeSync/);

  // Mounted in the authenticated shell, so it is not re-created per route.
  const layoutAt = app.indexOf("function Layout()");
  const callAt = app.indexOf("useRealtimeSync();");
  assert.ok(layoutAt !== -1 && callAt > layoutAt, "it belongs in the shell, not a page");
});

test("REGRESSION: every status change is broadcast, not only 'Ready'", () => {
  // The emit sat inside `if (readyTransition)`, so completing, cancelling or
  // settling an order told the other tills nothing.
  const src = BE("controllers/orderController.js");
  const emitAt = src.indexOf("emitOrderStatusChanged({");
  const readyAt = src.indexOf("if (readyTransition) {");
  assert.ok(emitAt !== -1 && readyAt !== -1, "anchors moved; retarget this guard");
  assert.ok(emitAt < readyAt, "the broadcast must not be nested inside the Ready branch");
});

test("REGRESSION: a POS order announces itself", () => {
  // It emitted nothing at all, so a second till, the KDS and the Orders
  // screen only learned about it on their next manual refresh.
  const src = BE("controllers/orderController.js");
  assert.match(src, /emitOrderCreated\(\{/);
  assert.match(src, /const \{ emitOrderCreated, emitOrderStatusChanged \}/);
});

test("publishing the menu tells the other tills", () => {
  // One device changing what every other device should display is exactly
  // the case that needs a broadcast.
  const src = BE("controllers/menuController.js");
  assert.match(src, /emitToRestaurant\(req\.user\?\.restaurantId, "menu:updated"/);
});

test("each event invalidates the caches that event can change", () => {
  const hook = SRC("src/hooks/useRealtimeSync.js");
  for (const [event, key] of [
    ["newOrder", "orders"],
    ["onlineOrder:created", "kds-orders"],
    ["onlineOrder:status", "tables"],
    ["menu:updated", "menus"],
  ]) {
    const block = hook.slice(hook.indexOf(`"${event}"`) === -1 ? hook.indexOf(event) : hook.indexOf(`"${event}"`));
    assert.ok(block.includes(key), `${event} should refresh ${key}`);
  }
});

test("SOURCE: a reconnect re-joins its room and catches up", () => {
  // A dropped connection is normal on a tablet that sleeps. A reconnect that
  // does not re-join is a socket that looks healthy and receives nothing, and
  // one that does not catch up silently loses whatever happened meanwhile.
  const hook = SRC("src/hooks/useRealtimeSync.js");
  assert.match(hook, /socket\.on\("connect", onConnect\)/);
  const onConnect = hook.slice(hook.indexOf("const onConnect"), hook.indexOf("socket.on(\"connect\""));
  assert.match(onConnect, /invalidate\(\[/, "and refresh what was missed");
  // The shared socket owns the room join, on every connect.
  const shared = SRC("src/socket.js");
  assert.match(shared, /socket\.on\("connect", \(\) => socket\.emit\("joinRestaurant"/);
});

test("SOURCE: the socket is torn down when the shell unmounts", () => {
  // Without this, signing out and back in leaks a connection each time.
  const hook = SRC("src/hooks/useRealtimeSync.js");
  assert.match(hook, /releaseSocket\(\);/);
  assert.match(hook, /handlers\.forEach\(\(\[event, handler\]\) => socket\.off\(event, handler\)\)/);
  // ...and the shared socket closes when the last consumer lets go.
  const shared = SRC("src/socket.js");
  assert.match(shared, /holders === 0 && socket\) \{\n\s*socket\.disconnect\(\);/);
});

test("SOURCE: payloads are not merged into the cache by hand", () => {
  // A socket payload is a summary. Reconciling it with whatever shape each
  // screen expects is how two screens end up disagreeing; invalidating leaves
  // one source of truth.
  const hook = SRC("src/hooks/useRealtimeSync.js");
  assert.match(hook, /invalidateQueries/);
  assert.ok(!/setQueryData/.test(hook), "invalidate, do not hand-merge");
});

test("the fallbacks do not poll", () => {
  // They cover a socket that never connects at all -- a proxy blocking
  // websockets -- without costing an idle till a request a minute.
  const main = SRC("src/main.jsx");
  assert.match(main, /refetchOnWindowFocus: true/);
  assert.match(main, /refetchOnReconnect: true/);
  assert.ok(!/refetchInterval/.test(main), "a global poll would hit every query in the app");
});
