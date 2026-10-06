import express from "express";
import { registerRoutes } from "../../server/routes";
import { createJsonErrorHandler } from "../../server/errorHandler";
import { deliveries } from "./email-sink";
import { createServer as createViteServer } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { mock } from "node:test";

const app = express();
app.use(express.json());
const server = await registerRoutes(app);
app.use(createJsonErrorHandler());
if (process.env.REGRESSION_UI === "1") {
  const vite = await createViteServer({
    configFile: false, envFile: false, root: path.resolve("client"),
    plugins: [react()],
    resolve: { alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") } },
    server: { middlewareMode: true, hmr: false, watch: null, fs: { strict: true } },
  });
  app.use(vite.middlewares);
}
server.listen(0, "127.0.0.1", () => {
  process.send?.({ type: "ready", port: (server.address() as { port: number }).port });
});
// IPC is private to this child process; no test controls are exposed over HTTP.
process.on("message", (message: any) => {
  if (message?.type === "clock") {
    mock.timers.reset();
    if (message.iso) mock.timers.enable({ apis: ["Date"], now: new Date(message.iso) });
    process.send?.({ type: "clock-ready", id: message.id });
  }
  if (message?.type === "deliveries") process.send?.({ type: "deliveries", value: deliveries });
  if (message?.type === "clear-deliveries") deliveries.length = 0;
});
process.once("disconnect", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
