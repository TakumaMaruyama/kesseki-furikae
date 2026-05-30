import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer, createLogger, type ConfigEnv, type UserConfig } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

export async function setupVite(app: Express, server: Server) {
  const configEnv: ConfigEnv = {
    command: "serve",
    mode: app.get("env") === "development" ? "development" : "production",
  };
  const resolvedConfig: UserConfig =
    typeof viteConfig === "function"
      ? await (viteConfig as (env: ConfigEnv) => UserConfig | Promise<UserConfig>)(configEnv)
      : (viteConfig as UserConfig);

  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...resolvedConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(404).type("text/plain").send(`Not Found: ${req.method} ${req.path}`);
      return;
    }

    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // Only client-side navigation routes should fall through to index.html.
  app.use("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.path}` });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.status(404).type("text/plain").send(`Not Found: ${req.method} ${req.path}`);
      return;
    }

    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
