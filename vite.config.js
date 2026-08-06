import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Workbox requires a revision for any precache entry whose URL never changes
// (these icon filenames aren't content-hashed like the JS/CSS bundles) —
// otherwise it can't tell a stale cached copy from a fresh one. Hashing the
// actual file content means this self-updates if an icon is ever replaced,
// instead of relying on someone remembering to bump a version string by hand.
function iconManifestEntry(relPath) {
  const abs = fileURLToPath(new URL(`./public${relPath}`, import.meta.url));
  const revision = createHash("md5").update(readFileSync(abs)).digest("hex");
  return { url: relPath, revision };
}

// Shared by both the dev server and `vite preview` so the two can't drift.
const BACKEND_PROXY = {
  "/api": "http://localhost:4000",
  "/socket.io": { target: "http://localhost:4000", ws: true },
};

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

      // ── Manifest: intentionally disabled here — public/manifest.json (linked
      // manually in index.html) is the single source of truth. Leaving this
      // `manifest: {...}` block enabled made vite-plugin-pwa ALSO generate its
      // own dist/manifest.webmanifest and auto-inject a second
      // <link rel="manifest"> tag into the built index.html, alongside the
      // manual one — two different manifests (different theme_color, one
      // missing `categories`) both linked from the same document. That's a
      // real Web App Manifest / installability bug: which one a given browser
      // engine/version actually reads is not something this app controls, and
      // an Android WebAPK that resolves inconsistent manifest content across
      // visits is a documented cause of "installed PWA gets treated as a new
      // app on update" instead of updating in place. `manifest: false`
      // disables generation/injection entirely so index.html's own
      // <link rel="manifest" href="/manifest.json"> is unambiguously the only one.
      //
      // Side effect discovered while verifying this: with `manifest` disabled,
      // vite-plugin-pwa's injectManifest glob scan no longer picks up
      // public/icons/*.png for precaching (it only reliably globs those when
      // a `manifest.icons` array is present to walk) — confirmed by comparing
      // the built sw.js's precache list with manifest enabled vs disabled.
      // additionalManifestEntries below restores offline availability for the
      // icons explicitly, independent of that glob-timing quirk.
      manifest: false,

      // ── Workbox config (applies to the injectManifest build step) ────────────
      // Note: `strategies:"injectManifest"` reads its workbox-build options from
      // the `injectManifest` key (types: Partial<InjectManifestOptions>) — NOT
      // `workbox` (that one's Partial<GenerateSWOptions>, for the other
      // strategy). globPatterns/globIgnores happen to still apply either way in
      // this plugin version, but additionalManifestEntries only took effect
      // once moved to the correct key — verified by rebuilding and diffing the
      // actual precache list embedded in dist/sw.js both ways.
      workbox: {
        // Glob patterns of assets to precache (relative to build output dir)
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Don't precache the offline page itself via glob — it's referenced directly
        globIgnores: ["**/node_modules/**/*", "sw.js"],
      },
      injectManifest: {
        // Explicit, since the glob scan doesn't reliably pick these up now
        // that `manifest` is disabled — see the comment on `manifest` above.
        additionalManifestEntries: [
          iconManifestEntry("/icons/icon-192.png"),
          iconManifestEntry("/icons/icon-512.png"),
          iconManifestEntry("/icons/icon-maskable.png"),
        ],
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
    host: "0.0.0.0",
    port: 5173,
    proxy: BACKEND_PROXY,
  },

  // `vite preview` does NOT inherit server.proxy — it's a separate config key,
  // and without it a preview build loads but every /api call 404s against the
  // static server. Preview is the only way to exercise the real production
  // service worker (dev serves a different one), so it has to be able to reach
  // the backend. host:0.0.0.0 lets a phone on the LAN hit it too; an Android
  // emulator should use `adb reverse tcp:4173 tcp:4173` instead, so the origin
  // stays localhost and therefore counts as secure for service workers.
  preview: {
    host: "0.0.0.0",
    port: 4173,
    proxy: BACKEND_PROXY,
  },
});
