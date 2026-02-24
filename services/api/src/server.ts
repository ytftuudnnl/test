import { createApp } from "./app";
import { closeDataRepository, getDataDriver, initDataRepository } from "./data";

async function start() {
  const port = Number(process.env.PORT || 3100);
  await initDataRepository();
  const app = createApp();

  const server = app.listen(port, () => {
    console.log(`[cbsp-api] listening on http://localhost:${port} (data=${getDataDriver()})`);
  });

  const shutdown = async () => {
    server.close();
    await closeDataRepository();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((err) => {
  console.error("[cbsp-api] failed to start", err);
  process.exit(1);
});
