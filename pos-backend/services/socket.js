const { Server } = require("socket.io");

let io = null;

const initSocket = (server, { corsOrigin = ["http://localhost:5173"] } = {}) => {
  io = new Server(server, {
    cors: { origin: corsOrigin, credentials: true },
  });

  io.on("connection", (socket) => {
    const { restaurantId, outletId } = socket.handshake.query || {};
    if (restaurantId) socket.join(`restaurant:${restaurantId}`);
    if (outletId) socket.join(`outlet:${outletId}`);
    socket.on("disconnect", () => {});
  });

  return io;
};

/**
 * Broadcast realtime events to POS + KDS clients.
 * - table:<tableId>        — item added / status change for a specific table
 * - restaurant:<id>        — session open/close, bill requested, payment completed
 * - outlet:<id>            — same as above but outlet-scoped
 * - kds:<restaurantId>     — new kitchen order / item status
 */
const emitEvent = (event, payload, rooms = []) => {
  if (!io) return;
  if (rooms && rooms.length) io.to(rooms).emit(event, payload);
  else io.emit(event, payload);
};

const emitToRestaurant = (restaurantId, event, payload) => {
  emitEvent(event, payload, [`restaurant:${restaurantId}`]);
};

const emitToOutlet = (outletId, event, payload) => {
  emitEvent(event, payload, [`outlet:${outletId}`]);
};

const emitToTable = (tableId, event, payload) => {
  emitEvent(event, payload, [`table:${tableId}`]);
};

module.exports = { initSocket, emitEvent, emitToRestaurant, emitToOutlet, emitToTable };