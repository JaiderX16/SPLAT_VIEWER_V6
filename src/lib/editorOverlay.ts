import * as THREE from 'three';

/**
 * "Editor view" picture-in-picture overlay, like the scene view in game engines.
 *
 * It renders a small secondary viewport (bottom-right corner) that shows the main
 * camera from a fixed isometric vantage point: a ground grid, a wireframe
 * frustum (the exact volume being rendered), and a camera gizmo. It also draws
 * the splat mesh in that viewport — since the mesh's render indexes are already
 * frustum-culled for the main camera, the overview literally shows *only* the
 * splats the main camera is currently rendering, demonstrating the culling.
 *
 * The overlay is implemented with three.js scissor/viewport rendering on the
 * same WebGL context (a second renderer would not share the splat textures).
 */

const DEG2RAD = Math.PI / 180;

// 12 frustum edges (24 indices) between the 8 corners.
const FRUSTUM_EDGES = [
  0, 1, 1, 2, 2, 3, 3, 0, // near plane
  4, 5, 5, 6, 6, 7, 7, 4, // far plane
  0, 4, 1, 5, 2, 6, 3, 7, // near -> far connectors
];

export interface OverlayViewerHost {
  render: () => void;
  renderer?: THREE.WebGLRenderer;
  camera?: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  splatMesh?: THREE.Object3D;
  rootElement?: HTMLElement;
  forceRenderNextFrame?: () => void;
}

export class EditorOverlay {
  private readonly viewer: OverlayViewerHost;
  private readonly originalRender: () => void;
  private readonly overviewScene = new THREE.Scene();
  private readonly overviewCamera: THREE.PerspectiveCamera;
  private readonly frustumLines: THREE.LineSegments;
  private readonly cameraGizmo: THREE.Group;
  private enabled = false;
  private visible = false;

  constructor(viewer: OverlayViewerHost) {
    this.viewer = viewer;
    this.originalRender = viewer.render.bind(viewer);

    // Fixed isometric vantage point framing the scene.
    this.overviewCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    this.overviewCamera.position.set(7, 7, 7);
    this.overviewCamera.lookAt(0, 0, 0);

    const grid = new THREE.GridHelper(14, 14, 0x8899aa, 0x23262e);
    this.overviewScene.add(grid);

    const frustumGeometry = new THREE.BufferGeometry();
    frustumGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    const frustumMaterial = new THREE.LineBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    this.frustumLines = new THREE.LineSegments(frustumGeometry, frustumMaterial);
    this.frustumLines.frustumCulled = false;
    this.overviewScene.add(this.frustumLines);

    this.cameraGizmo = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.24, 0.75, 12),
      new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false, depthWrite: false }),
    );
    // Cone's tip points along +Y; we reorient the group toward the view dir.
    cone.position.y = 0.35;
    this.cameraGizmo.add(cone);
    this.cameraGizmo.frustumCulled = false;
    this.overviewScene.add(this.cameraGizmo);
  }

  /** Show/hide the overlay. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.viewer.forceRenderNextFrame?.();
  }

  /** Hook into the viewer render loop. */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.viewer.render = () => {
      this.originalRender();
      if (this.visible) this.renderOverlay();
    };
  }

  /** Restore the original render loop. */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.viewer.render = this.originalRender;
  }

  dispose(): void {
    this.disable();
    this.frustumLines.geometry.dispose();
    (this.frustumLines.material as THREE.Material).dispose();
    this.cameraGizmo.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | undefined;
      material?.dispose?.();
    });
  }

  private updateGizmos(): void {
    const camera = this.viewer.camera as (THREE.PerspectiveCamera | THREE.OrthographicCamera) | null;
    if (!camera) return;
    camera.updateMatrixWorld();

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    this.cameraGizmo.position.copy(camera.position);
    this.cameraGizmo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);

    const farDist = Math.min(camera.far || 1000, 14);
    const corners = getFrustumCorners(camera, farDist);

    const position = this.frustumLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < FRUSTUM_EDGES.length; i++) {
      const corner = corners[FRUSTUM_EDGES[i]];
      position.setXYZ(i, corner.x, corner.y, corner.z);
    }
    position.needsUpdate = true;
    this.frustumLines.geometry.computeBoundingSphere();
  }

  private renderOverlay(): void {
    const renderer = this.viewer.renderer as THREE.WebGLRenderer | null;
    const rootElement = this.viewer.rootElement as HTMLElement | null;
    if (!renderer || !rootElement) return;

    const cssW = rootElement.offsetWidth;
    const cssH = rootElement.offsetHeight;
    if (cssW <= 0 || cssH <= 0) return;

    // three.js setViewport/setScissor take LOGICAL (CSS) pixels and multiply by
    // the pixel ratio internally — pass CSS pixels, not device pixels.
    const pipW = Math.max(96, Math.round(cssW * 0.3));
    const pipH = Math.max(96, Math.round(cssH * 0.3));
    const margin = 12;
    const pipX = cssW - pipW - margin; // right edge
    const pipY = margin; // bottom edge (bottom-right corner)

    this.overviewCamera.aspect = pipW / pipH;
    this.overviewCamera.updateProjectionMatrix();
    this.updateGizmos();

    const prevAutoClear = renderer.autoClear;
    const prevScissorTest = renderer.getScissorTest();
    const viewport = new THREE.Vector4();
    const scissor = new THREE.Vector4();
    renderer.getViewport(viewport);
    renderer.getScissor(scissor);
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setViewport(pipX, pipY, pipW, pipH);
    renderer.setScissor(pipX, pipY, pipW, pipH);
    renderer.setScissorTest(true);
    renderer.autoClear = false;
    renderer.setClearColor(0x0c0d12, 1);
    renderer.clear(true, true, true);

    const splatMesh = this.viewer.splatMesh as THREE.Object3D | null;
    if (splatMesh) {
      try {
        renderer.render(splatMesh, this.overviewCamera);
      } catch (error) {
        console.error('EditorOverlay: splat render failed', error);
      }
    }
    renderer.render(this.overviewScene, this.overviewCamera);

    renderer.autoClear = prevAutoClear;
    renderer.setScissorTest(prevScissorTest);
    renderer.setViewport(viewport.x, viewport.y, viewport.z, viewport.w);
    renderer.setScissor(scissor.x, scissor.y, scissor.z, scissor.w);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }
}

function getFrustumCorners(camera: THREE.Camera, farDist: number): THREE.Vector3[] {
  const m = camera.matrixWorld;
  const corners: THREE.Vector3[] = [];
  const push = (x: number, y: number, z: number) =>
    corners.push(new THREE.Vector3(x, y, z).applyMatrix4(m));

  if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
    const ortho = camera as THREE.OrthographicCamera;
    const halfW = (ortho.right - ortho.left) / 2;
    const halfH = (ortho.top - ortho.bottom) / 2;
    const nearD = ortho.near;
    push(-halfW, -halfH, -nearD); push(halfW, -halfH, -nearD);
    push(halfW, halfH, -nearD); push(-halfW, halfH, -nearD);
    push(-halfW, -halfH, -farDist); push(halfW, -halfH, -farDist);
    push(halfW, halfH, -farDist); push(-halfW, halfH, -farDist);
  } else {
    const persp = camera as THREE.PerspectiveCamera;
    const fov = persp.fov * DEG2RAD;
    const aspect = persp.aspect;
    const hN = Math.tan(fov / 2) * persp.near;
    const wN = hN * aspect;
    const hF = Math.tan(fov / 2) * farDist;
    const wF = hF * aspect;
    push(-wN, -hN, -persp.near); push(wN, -hN, -persp.near);
    push(wN, hN, -persp.near); push(-wN, hN, -persp.near);
    push(-wF, -hF, -farDist); push(wF, -hF, -farDist);
    push(wF, hF, -farDist); push(-wF, hF, -farDist);
  }

  return corners;
}
