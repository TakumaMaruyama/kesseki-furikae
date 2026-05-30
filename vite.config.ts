import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig(async () => {
  const plugins = [react(), runtimeErrorOverlay()];

  try {
    const { VitePWA } = await import("vite-plugin-pwa");
    plugins.push(
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto",
        includeAssets: [
          "favicon.png",
          "apple-touch-icon.png",
          "pwa-192.png",
          "pwa-512.png",
        ],
        manifest: {
          name: "欠席・振替",
          short_name: "欠席・振替",
          description:
            "はまだ水泳教室の欠席連絡と振替希望受付システム。空き状況を確認して振替予約ができます。",
          start_url: "/",
          scope: "/",
          display: "standalone",
          lang: "ja",
          theme_color: "#0072e5",
          background_color: "#ffffff",
          icons: [
            {
              src: "/pwa-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "/pwa-512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
        },
      }),
    );
  } catch {
    console.warn(
      "[vite] vite-plugin-pwa が見つからないため、PWA設定をスキップします。",
    );
  }

  if (
    process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
  ) {
    plugins.push(
      await import("@replit/vite-plugin-cartographer").then((m) =>
        m.cartographer(),
      ),
      await import("@replit/vite-plugin-dev-banner").then((m) => m.devBanner()),
    );
  }

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },
    root: path.resolve(import.meta.dirname, "client"),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
  };
});
