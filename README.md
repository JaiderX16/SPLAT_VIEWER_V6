# MemorIA Splat Viewer

A React + TypeScript viewer for 3D Gaussian Splatting scenes. `.splat` files render through a custom **WebGPU** renderer built on [vgpu](https://github.com/vercel-labs/vgpu); other formats, and browsers without WebGPU, fall back to [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) (WebGL), loaded on demand.

## Install

```bash
npm i @memoria-labs/splat-viewer
```

Requires React 18+ and a browser with WebGPU for `.splat` files.

```jsx
import { SplatViewer } from '@memoria-labs/splat-viewer';
import '@memoria-labs/splat-viewer/style.css';

// Fills its parent: give the container a size.
<div style={{ height: '100dvh' }}>
  <SplatViewer />
</div>

// Just the scene, no sidebar / dock / panels (keyboard shortcuts still work):
<SplatViewer showUI={false} src="https://example.com/scene.splat" />
```

| Prop | Default | |
|---|---|---|
| `showUI` | `true` | Sidebar, dock and panels. |
| `src` | — | Scene URL to load on mount. |
| `initialNavigation` | `'orbit'` | Mode once `src` loads: `'orbit'` (circle an exterior) or `'interior'` (walk inside at eye height). |

All styles are scoped to the viewer's root (`.msv`), so they don't leak into the host page. With Vite, keep the package out of dependency pre-bundling (its worker is loaded with `new URL(..., import.meta.url)`):

```js
// vite.config.js
optimizeDeps: {
  exclude: ['@memoria-labs/splat-viewer'],
  include: [
    '@memoria-labs/splat-viewer > react',
    '@memoria-labs/splat-viewer > react/jsx-runtime',
    '@memoria-labs/splat-viewer > react-dom',
  ],
},
```

## Features

- **WebGPU renderer** — one instanced draw per frame, 20-byte packed splats (positions quantized per 256-splat block, half-float scales), on-demand rendering (an idle scene costs ~0 GPU).
- **Progressive loading in a Web Worker** — the `.splat` file is streamed, parsed, and packed off the main thread; the first splats render while the rest downloads.
- **Worker depth sort** — 16-bit counting sort; the order buffer ping-pongs between threads, so steady-state sorting allocates nothing.
- **Hierarchical LOD** — an octree over the scene merges far splats smaller than 1–2 px into one splat that keeps their mass, center, color, and shape (presets: Alta / Media / Rápida, plus an optional splat budget per view).
- **Hide what the camera can't see** — splats off screen or behind walls (a voxel occlusion grid) are skipped, per splat and per LOD node; scan noise (giant and needle splats) and what lies under the floor are hidden too (on by default, switchable).
- **Fluid camera** — damped orbit, pan, dolly, and pinch; cinematic intro with auto-orbit that stops on interaction.
- **Interior navigation** — walk through the place at eye height, over furniture and never through walls; WASD, touch gestures, tap-to-go and gyroscope look (key `V` switches between orbit and interior).
- **Cinematic reveal** — splats stream in as points and a wave grows them into the full scene, outward from the origin.
- **Click to navigate** — click a surface to fly toward it; in the editor view (minimap) click to glide the orbit pivot there.
- **Editor view** — picture-in-picture overview with grid, the camera frustum, and the splats currently being drawn.
- **Advanced controls** — view presets (keys `0`–`6`), orthographic/perspective, FOV, grid and axes, scene background.
- **Light / dark theme** — frosted pearl-gray light mode and smoke-glass dark mode; follows the OS until the user picks one (`localStorage` key `memoria-theme`).
- **Performance pill** — FPS, and the active splats inside a ring that fills with the share of the scene on screen; it expands to the full benchmark (exact GPU buffer memory, draw calls, render DPR) scored against a 2026 mid-range mobile target.

## Architecture

```
src/
├── pages/Home.tsx                 App shell: backend selection, theme, panels, dock
├── components/
│   ├── WebGPUSplatViewer.tsx      React shell around the WebGPU renderer
│   ├── GaussianSplatViewer.tsx    WebGL fallback (lazy-loaded with three.js)
│   └── …                          Sidebar, panels, uploader, loader, shadcn/ui primitives
├── hooks/useTheme.ts              Light/dark theme (class on <html>)
└── lib/
    ├── viewerHandle.ts            Backend-agnostic viewer contract shared by both renderers
    ├── performanceBenchmark.ts    Benchmark targets and scoring
    ├── editorOverlay.ts           Editor view for the WebGL backend
    └── webgpu-splat/
        ├── SplatRenderer.ts       vgpu device, buffers, frame loop, click navigation
        ├── splat.worker.ts        Streaming parser, packer, sorter, ray picking
        ├── splat.wgsl             EWA splat rasterizer
        ├── pack.ts                20-byte GPU splat format
        ├── lod.ts                 LOD octree and merged splats
        ├── frustum.ts, occlusion.ts  What the camera can't see
        ├── collision.ts           Voxel grid: floor, walls, walking
        ├── noise.ts               Giant and needle splats
        ├── EditorView.ts          Picture-in-picture minimap
        ├── orbitControls.ts       Damped orbit controls and camera travel
        ├── *.check.ts             Self-checks (npm test)
        └── protocol.ts, math.ts, helpers.wgsl, overlay.wgsl
```

Design notes and measurements: [docs/occlusion-culling-plan.md](docs/occlusion-culling-plan.md).

Both renderers implement `SplatViewerHandle` (`src/lib/viewerHandle.ts`), so the UI never touches renderer internals. Append `?renderer=webgl` to the URL to force the fallback for A/B comparisons.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5182
npm run build
npm run lint
npm test         # self-checks of the packing, LOD and culling math (Node 23.6+)
```

In development the library also lists `model/scene.splat`, a local scene kept out of git.

Shaders are prepared at build time by the `@vgpu/wgsl` Vite plugin. Validate them against a real WebGPU device with:

```bash
npx vgpu check src/lib/webgpu-splat/splat.wgsl --require-validation
```

## Controls

| Action | Control |
|---|---|
| Orbit | Drag |
| Pan | Right-drag, or Shift + drag |
| Zoom | Wheel or pinch |
| Fly to a point | Click the scene |
| Move the pivot | Click inside the editor view |
| View presets | Keys `1`–`6`, `0` to reset |

## Demo scenes

APATA FUENTE (and HD), Constitucion, Huamanmarca, Lago Azul, Taza, Torre, parque-constitucion, and Oficina (HuggingFace, JaiderX16); Nike Shoe, Train, and Plush Toy (HuggingFace, cakewalk).

## Credits

- [vgpu](https://github.com/vercel-labs/vgpu) — WebGPU rendering toolkit
- [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) by Mark Kellogg — vendored (with patches) in `src/vendor/`
- [three.js](https://threejs.org/)

## License

MIT
