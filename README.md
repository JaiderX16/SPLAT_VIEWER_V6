# Gaussian Splats 3D Viewer (React)

A modern React + TypeScript wrapper for the [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) library by Mark Kellogg. Features progressive loading, drag & drop, URL loading, and real-time scene controls.

## Features

- **Progressive loading** — Stream large `.splat`, `.ksplat`, `.ply`, and `.spz` files without blocking the UI
- **Drag & drop** — Drop files directly into the viewer
- **URL loading** — Load scenes from any public URL
- **Point cloud / splat toggle** — Switch between point cloud and splat rendering modes
- **Splat scale control** — Adjust the scale multiplier in real-time
- **Camera focus** — Auto-center the camera on the loaded scene
- **Real-time info panel** — FPS, splat count, camera position, sort time, and more
- **Multi-scene support** — Load multiple splat scenes simultaneously
- **Advanced controls** — Camera view presets (front/back/top/…), orthographic/perspective toggle, FOV, spherical-harmonics quality, background color, grid & axes (SuperSplat-style)
- **Editor view** — Picture-in-picture debug viewport showing the camera gizmo, its frustum, and only the splats currently being rendered

## 2026 Web 3D Performance Benchmark

The in-app benchmark targets a realistic average 2026 mobile device: iPhone 13/14, Samsung Galaxy A54/A55, Pixel 7a, or Redmi Note 13 Pro with 6-8 GB RAM, WebGL 2.0, modern WebGPU availability, and a high native DPR.

The viewer intentionally renders internally at a lower device pixel ratio to avoid saturating mobile GPUs. The HUD classifies the current scene with these working limits:

| Metric | Target |
|---|---|
| FPS | 60 ideal, 30-45 acceptable, below 24 red line |
| Estimated VRAM | 150-350 MB safe, above 600 MB risk, above 1 GB crash risk |
| glTF triangles | Keep 500K-800K visible triangles as the practical mobile ceiling |
| Gaussian splats active | 1-2M target range with culling |
| Draw calls | Keep below 400-500 per frame |
| Render DPR | Keep internal DPR around 1-1.5 on high-DPR mobile screens |

## Runtime Performance Optimizations

The viewer ships with mobile-first optimizations that preserve full visual quality:

| Optimization | Mechanism |
|---|---|
| Tightened frustum culling | Only splats whose node center is inside the camera frustum are sorted and drawn (video-game style). The margin is reduced to 0 (exact frustum) and nodes behind the camera are culled unconditionally, via `patch-package` (`patches/@mkkellogg+gaussian-splats-3d+0.4.7.patch`). |
| Zero-copy worker sorting | `SharedArrayBuffer` sort buffers are used when the page is cross-origin isolated (COOP/COEP headers set in `vite.config.ts`), otherwise it falls back to copy-based sorting. No visual impact. |
| SH degree selector | Base color (degree 0) by default; selectable up to degree 3 from the advanced controls. |

Full-precision covariances (32-bit), uncompressed in-memory data, native device pixel ratio, and auto-rotation are preserved, matching the reference-quality April build. Lazy/partial sorting and Web-Worker sorting are provided by the underlying `GaussianSplats3D` library.

For browser-side validation in Chrome, open DevTools, press `Esc`, open the Rendering drawer and enable `Frame Rendering Stats`. Watch FPS and GPU memory while orbiting the scene; memory that rises continuously after replacing scenes indicates missing disposal or retained resources.

## Demo Scenes Included

| Scene | Source |
|---|---|
| APATA FUENTE | HuggingFace |
| Constitucion | HuggingFace |
| Huamanmarca | HuggingFace |
| Nike Shoe | HuggingFace |
| Train | HuggingFace |
| Plush Toy | HuggingFace |

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Usage

```tsx
import { useRef } from 'react';
import GaussianSplatViewer, { type GaussianSplatViewerHandle } from './components/GaussianSplatViewer';

function App() {
  const viewerRef = useRef<GaussianSplatViewerHandle>(null);

  const loadScene = async () => {
    await viewerRef.current?.addSplatScene('https://example.com/scene.splat', {
      progressiveLoad: true,
      splatAlphaRemovalThreshold: 1,
    });
    viewerRef.current?.start();
  };

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <GaussianSplatViewer ref={viewerRef} />
      <button onClick={loadScene}>Load Scene</button>
    </div>
  );
}
```

## Keyboard / Mouse Controls

| Action | Control |
|---|---|
| Orbit | Click + drag |
| Pan | Right-click + drag |
| Zoom | Scroll wheel |
| Focus scene | Click "Focus" button |

## Tech Stack

- React 19 + TypeScript
- Vite
- Tailwind CSS + shadcn/ui
- GaussianSplats3D (Mark Kellogg)
- Three.js

## Credits

- [GaussianSplats3D](https://github.com/mkkellogg/GaussianSplats3D) by Mark Kellogg
- Demo scenes from HuggingFace datasets by JaiderX16 and cakewalk

## License

MIT
