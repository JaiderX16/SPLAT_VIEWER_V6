# MemorIA Splat Viewer

A React + TypeScript viewer for 3D Gaussian Splatting scenes. `.splat` files render through a custom **WebGPU** renderer built on [vgpu](https://github.com/vercel-labs/vgpu); other formats, and browsers without WebGPU, fall back to [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) (WebGL), loaded on demand.

## Features

- **WebGPU renderer** — one instanced draw per frame, 32-byte packed splats, on-demand rendering (an idle scene costs ~0 GPU).
- **Progressive loading in a Web Worker** — the `.splat` file is streamed, parsed, and packed off the main thread; the first splats render while the rest downloads.
- **Worker depth sort with frustum culling** — 16-bit counting sort; the order buffer ping-pongs between threads, so steady-state sorting allocates nothing.
- **Distance LOD** — far splats covering a pixel or two are thinned to a stable fraction and enlarged to keep coverage (presets: Alta / Media / Rápida).
- **Fluid camera** — damped orbit, pan, dolly, and pinch; cinematic intro with auto-orbit that stops on interaction.
- **Click to navigate** — click a surface to fly toward it; in the editor view (minimap) click to glide the orbit pivot there.
- **Editor view** — picture-in-picture overview with grid, the camera frustum, and the splats currently being drawn.
- **Advanced controls** — view presets (keys `0`–`6`), orthographic/perspective, FOV, grid and axes, scene background.
- **Light / dark theme** — frosted pearl-gray light mode and smoke-glass dark mode; follows the OS until the user picks one (`localStorage` key `memoria-theme`).
- **Benchmark HUD** — FPS, exact GPU buffer memory, active splats, draw calls, and render DPR scored against a 2026 mid-range mobile target.

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
        ├── EditorView.ts          Picture-in-picture minimap
        ├── orbitControls.ts       Damped orbit controls and camera travel
        └── protocol.ts, math.ts, helpers.wgsl, overlay.wgsl
```

Both renderers implement `SplatViewerHandle` (`src/lib/viewerHandle.ts`), so the UI never touches renderer internals. Append `?renderer=webgl` to the URL to force the fallback for A/B comparisons.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run lint
```

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

APATA FUENTE, Constitucion, Huamanmarca, and parque-constitucion (HuggingFace, JaiderX16); Nike Shoe, Train, and Plush Toy (HuggingFace, cakewalk).

## Credits

- [vgpu](https://github.com/vercel-labs/vgpu) — WebGPU rendering toolkit
- [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) by Mark Kellogg — vendored (with patches) in `src/vendor/`
- [three.js](https://threejs.org/)

## License

MIT
