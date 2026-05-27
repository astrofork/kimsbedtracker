import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      // ── Strategy: we own the SW source; plugin injects the precache manifest ─
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",

      // ── SW registration: auto-register, prompt user for updates ─────────────
      registerType: "prompt",
      injectRegister: null, // we handle registration in main.jsx ourselves

      // ── Manifest (mirrors public/manifest.json) ──────────────────────────────
      manifest: {
        name: "BedFlow — Smart Bed Management",
        short_name: "BedFlow",
        description: "Live hospital bed tracking for KIMS Hospitals Seethammadhara",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#0EA5E9",
        background_color: "#F0F4F8",
        lang: "en",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },

      // ── Workbox config (applies to the injectManifest build step) ────────────
      workbox: {
        // Glob patterns of assets to precache (relative to build output dir)
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Don't precache the offline page itself via glob — it's referenced directly
        globIgnores: ["**/node_modules/**/*", "sw.js"],
      },

      // ── Dev: enable SW in dev mode so you can test offline/install locally ───
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
    }),
  ],

  server: {
    proxy: { "/api": "http://localhost:4000" },
  },
});
