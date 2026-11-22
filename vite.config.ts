import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite'

// https://vite.dev/config/
//
// Cross-origin isolation headers make `SharedArrayBuffer` available. Nothing uses it
// today (GaussianSplats3D runs with `sharedMemoryForWorkers: false`); they are here to
// try a multi-threaded sort in dev. Production (Vercel) does not send them: add them
// there before depending on them. `credentialless` keeps public cross-origin resources
// (e.g. the HuggingFace demo scenes) loading without CORP headers.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

// `vite build --mode lib` (npm run build:lib) packages the viewer as an npm library
// in lib/: one ES entry plus lazy chunks, React left to the host app.
export default defineConfig(({ command, mode }) => {
  // Read by tailwind.config.js: the host page brings its own preflight.
  if (mode === 'lib') process.env.SPLAT_LIB = '1';
  return {
  base: './',
  // wgslVitePlugin prepares every `.wgsl` import at build time (vgpu ShaderSource),
  // so the browser bundle never ships the WGSL parser.
  // inspectAttr tags every JSX element with its source line (code-path="…") for the
  // dev inspector: dev server only, never in a build.
  plugins: [command === 'serve' && inspectAttr(), react(), wgslVitePlugin()],
  worker: {
    format: 'es',
  },
  server: {
    port: 5182,
    allowedHosts: ['desktop-feocakm.tailb5cc9a.ts.net'],
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
  build: mode === 'lib' ? {
    outDir: 'lib',
    chunkSizeWarningLimit: 1500,
    lib: { entry: 'src/lib.ts', formats: ['es'], fileName: 'splat-viewer', cssFileName: 'style' },
    rollupOptions: { external: [/^react($|\/)/, /^react-dom($|\/)/] },
  } : {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('three/build')) {
            return 'three';
          }
          if (id.includes('gaussian-splats-3d')) {
            return 'gaussian-splats';
          }
          if (id.includes('node_modules/vgpu') || id.includes('node_modules/@vgpu')) {
            return 'vgpu';
          }
        },
      },
    },
  },
  };
});
