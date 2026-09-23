import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
//
// Cross-origin isolation headers enable `SharedArrayBuffer` (and therefore the
// zero-copy Web-Worker splat sorting path in GaussianSplats3D). We use the
// `credentialless` embedding policy so public cross-origin resources (e.g. the
// HuggingFace demo scenes) keep loading without CORP headers, while same-origin
// credentials still work.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Use our vendored, already-patched copy of GaussianSplats3D instead of the
      // npm package, so no postinstall patch step is needed at deploy time.
      "@mkkellogg/gaussian-splats-3d": path.resolve(
        __dirname,
        "./src/vendor/gaussian-splats-3d.module.js",
      ),
    },
  },
});
