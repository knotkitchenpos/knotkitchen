/**
 * Persistent wake channel. Devices hold a WebSocket to /device/ws; the
 * server only ever sends a small "sync" nudge and the device fetches its
 * work over HTTPS (/device/sync), so WebSocket, FCM and the polling fallback
 * all share one delivery path.
 *
 * Single instance: sockets live in this process. Scaling out puts a pub/sub
 * (Redis) in front so a wake reaches whichever node holds the socket.
 */
const { WebSocketServer } = require("ws");
const { Device } = require("../models");
const { authenticateDeviceHeader } = require("./deviceAuth");
const { deviceEvent } = require("./audit");

const sockets = new Map(); // deviceId -> ws

function attach(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on("upgrade", async (req, socket, head) => {
    if (!req.url.startsWith("/device/ws")) return socket.destroy();
    const auth = await authenticateDeviceHeader(req.headers.authorization).catch(() => null);
    if (!auth) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, auth.device));
  });

  // Drops sockets that stop answering pings (NAT timeouts, dead Wi-Fi).
  setInterval(() => {
    for (const [id, ws] of sockets) {
      if (ws.isAlive === false) {
        ws.terminate();
        sockets.delete(id);
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000).unref();
}

function onConnect(ws, device) {
  const id = String(device._id);
  const existing = sockets.get(id);
  if (existing && existing !== ws) existing.terminate();
  sockets.set(id, ws);
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  ws.on("message", () => { ws.isAlive = true; });
  ws.on("close", () => {
    if (sockets.get(id) === ws) sockets.delete(id);
  });
  const wasOffline = !device.online;
  Device.updateOne({ _id: id }, { $set: { online: true, lastSeenAt: new Date() } }).catch(() => {});
  if (wasOffline) deviceEvent(id, "online", "Push channel connected");
  // Anything queued while it was away goes out now.
  send(id, { type: "sync" });
}

function send(deviceId, msg) {
  const ws = sockets.get(String(deviceId));
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

/** Nudges a device to sync. Falls back to FCM when it has a token. */
function wake(deviceId) {
  if (send(deviceId, { type: "sync" })) return "ws";
  // FCM wake-up goes here for GMS devices (needs a Firebase project and
  // service account; see docs/ARCHITECTURE.md §8). Otherwise the device
  // picks the command up on its next poll.
  return "poll";
}

function isConnected(deviceId) {
  return sockets.has(String(deviceId));
}

function connectedCount() {
  return sockets.size;
}

module.exports = { attach, wake, send, isConnected, connectedCount };
