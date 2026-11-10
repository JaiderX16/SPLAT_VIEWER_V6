/**
 * npm entry: the full MemorIA splat viewer as one React component. It fills its
 * parent element; import '@memoria-labs/splat-viewer/style.css' once in the host app.
 */
import './index.css';

export { default as SplatViewer, type SplatViewerRef } from './pages/Home';
export type { CameraFraming, LodQuality } from './lib/viewerHandle';
