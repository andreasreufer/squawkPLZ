import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { csvContractPlugin } from "./scripts/csvContract";
import { inlineIndexPlugin } from "./scripts/inlineIndex";

const enablePwa = process.env.VITEST !== "true";

export default defineConfig({
  base: "./",
  build: {
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
  plugins: [
    csvContractPlugin(),
    enablePwa &&
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "icons/icon-192.png", "icons/icon-512.png"],
        manifest: {
          name: "Squawk PLZ",
          short_name: "Squawk PLZ",
          description: "Read a squawk from a segmented display and look up the Swiss PLZ.",
          theme_color: "#12160f",
          background_color: "#12160f",
          display: "standalone",
          start_url: "/",
          lang: "en",
          icons: [
            { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
            { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          ],
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
          navigateFallback: "index.html",
        },
      }),
    inlineIndexPlugin(),
  ],
});
