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
