const http = require("http");
const mongoose = require("mongoose");
const config = require("./config");
const { createApp } = require("./app");
const push = require("./lib/push");
const jobs = require("./jobs");
const { bootstrap } = require("./seed");

async function main() {
  await mongoose.connect(config.mongoUri, config.mongoDbName ? { dbName: config.mongoDbName } : {});
  await bootstrap();
  const server = http.createServer(createApp());
  // Node cuts every request off at 5 minutes; a 260 MB APK (Android System
  // WebView) over a restaurant or office uplink takes longer than that.
  server.requestTimeout = 30 * 60 * 1000;
  push.attach(server);
  jobs.start();
  server.listen(config.port, () => {
    console.log(`[kkmdm] listening on :${config.port} (${config.isProduction ? "production" : "development"}), public URL ${config.publicUrl}`);
  });
  const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[kkmdm] failed to start:", err);
  process.exit(1);
});
