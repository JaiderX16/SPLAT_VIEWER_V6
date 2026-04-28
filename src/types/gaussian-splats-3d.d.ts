declare module '@mkkellogg/gaussian-splats-3d' {
  export enum SplatRenderMode {
    ThreeD = 0,
    TwoD = 1,
  }

  export enum SceneRevealMode {
    Default = 0,
    Gradual = 1,
    Instant = 2,
  }

  export enum RenderMode {
    Always = 0,
    OnChange = 1,
    Never = 2,
  }

  export enum LogLevel {
    None = 0,
    Debug = 1,
    Info = 2,
  }

  export enum WebXRMode {
    None = 0,
    VR = 1,
    AR = 2,
  }

  export enum SceneFormat {
    Ply = 0,
    Splat = 1,
    KSplat = 2,
    Spz = 3,
  }

  export interface ViewerOptions {
    cameraUp?: [number, number, number];
    initialCameraPosition?: [number, number, number];
    initialCameraLookAt?: [number, number, number];
    dropInMode?: boolean;
    selfDrivenMode?: boolean;
    useBuiltInControls?: boolean;
    rootElement?: HTMLElement | null;
    ignoreDevicePixelRatio?: boolean;
    halfPrecisionCovariancesOnGPU?: boolean;
    threeScene?: any;
    renderer?: any;
    camera?: any;
    gpuAcceleratedSort?: boolean;
    integerBasedSort?: boolean;
    sharedMemoryForWorkers?: boolean;
    dynamicScene?: boolean;
    antialiased?: boolean;
    kernel2DSize?: number;
    webXRMode?: WebXRMode;
    webXRSessionInit?: any;
    renderMode?: RenderMode;
    sceneRevealMode?: SceneRevealMode;
    focalAdjustment?: number;
    maxScreenSpaceSplatSize?: number;
    logLevel?: LogLevel;
    sphericalHarmonicsDegree?: number;
    enableOptionalEffects?: boolean;
    enableSIMDInSort?: boolean;
    inMemoryCompressionLevel?: number;
    optimizeSplatData?: boolean;
    freeIntermediateSplatData?: boolean;
    splatRenderMode?: SplatRenderMode;
    sceneFadeInRateMultiplier?: number;
    splatSortDistanceMapPrecision?: number;
  }

  export interface AddSplatSceneOptions {
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    onProgress?: (percent: number, percentLabel: string, loaderStatus: number) => void;
    headers?: Record<string, string>;
    format?: SceneFormat;
    progressiveLoad?: boolean;
  }

  export interface SceneOptions {
    path: string;
    splatAlphaRemovalThreshold?: number;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    headers?: Record<string, string>;
    format?: SceneFormat;
  }

  export class Viewer {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: AddSplatSceneOptions): Promise<any>;
    addSplatScenes(sceneOptions: SceneOptions[], showLoadingUI?: boolean, onProgress?: (percent: number, percentLabel: string, loaderStatus: number) => void): Promise<any>;
    removeSplatScene(indexToRemove: number, showLoadingUI?: boolean): Promise<any>;
    removeSplatScenes(indexesToRemove: number[], showLoadingUI?: boolean): Promise<any>;
    start(): void;
    stop(): void;
    dispose(): Promise<any>;
    setRenderMode(renderMode: RenderMode): void;
    setActiveSphericalHarmonicsDegrees(degree: number): void;
    getSplatScene(sceneIndex: number): any;
    getSceneCount(): number;
    splatMesh: any;
    camera: any;
    controls: any;
    currentFPS: number | null;
    lastSortTime: number;
    splatRenderCount: number;
  }

  export class DropInViewer {
    constructor(options?: ViewerOptions);
    addSplatScene(path: string, options?: AddSplatSceneOptions): Promise<any>;
    addSplatScenes(sceneOptions: SceneOptions[], showLoadingUI?: boolean): Promise<any>;
    removeSplatScene(index: number, showLoadingUI?: boolean): Promise<any>;
    removeSplatScenes(indexes: number[], showLoadingUI?: boolean): Promise<any>;
    getSplatScene(sceneIndex: number): any;
    getSceneCount(): number;
    setActiveSphericalHarmonicsDegrees(degree: number): void;
    dispose(): Promise<any>;
    viewer: Viewer;
  }

  export class OrbitControls {
    constructor(object: any, domElement?: HTMLElement);
    update(): void;
    dispose(): void;
  }

  export class AbortablePromise<T = any> {
    constructor(promiseFunc: (resolve: (value: T) => void, reject: (reason?: any) => void) => void, abortHandler?: (reason?: any) => void);
    then<U>(onResolve: (value: T) => U | PromiseLike<U>): AbortablePromise<U>;
    catch(onFail: (reason: any) => any): AbortablePromise<T>;
    abort(reason?: any): void;
    promise: Promise<T>;
    id: number;
  }

  export class AbortedPromiseError extends Error {
    constructor(msg: string);
  }

  export class SplatBuffer {
    constructor(bufferData: ArrayBuffer, copyBufferData?: boolean);
    static CurrentMajorVersion: number;
    static CurrentMinorVersion: number;
    static HeaderSizeBytes: number;
    static SectionHeaderSizeBytes: number;
    static CompressionLevels: any[];
    static parseHeader(buffer: ArrayBuffer): any;
    static parseSectionHeaders(header: any, sectionHeadersBuffer: ArrayBuffer, startSection: number, maxSectionsToRead?: number): any[];
    static writeHeaderToBuffer(header: any, buffer: ArrayBuffer): void;
    static writeSectionHeaderToBuffer(sectionHeader: any, sectionIndex: number, buffer: ArrayBuffer, offset: number): void;
    static generateFromUncompressedSplatArrays(splatArrays: any[], minimumAlpha: number, compressionLevel: number, sceneCenter: any): SplatBuffer;
    updateLoadedCounts(sectionCount: number, splatCount: number): void;
    updateSectionLoadedCounts(sectionIndex: number, loadedSplatCount: number): void;
    getSplatCount(): number;
    getMaxSplatCount(): number;
    getSectionCount(): number;
    bufferData: ArrayBuffer;
  }

  export class SplatBufferGenerator {
    static getStandardGenerator(minimumAlpha: number, compressionLevel: number, sectionSize: number, sceneCenter: any, blockSize: number, bucketSize: number): SplatBufferGenerator;
    generateFromUncompressedSplatArray(splatArray: any): SplatBuffer;
  }

  export class SplatPartitioner {
    constructor(blockSize: number, bucketSize: number, minAlpha: number, sectionSize: number);
    partitionUncompressedSplatArray(splatArray: any): any;
  }

  export class SplatParser {
    static RowSizeBytes: number;
    static parseStandardSplatToUncompressedSplatArray(splatFileData: ArrayBuffer): any;
    static parseToUncompressedSplatArraySection(startSplat: number, endSplat: number, splatBuffer: ArrayBuffer, section: number, outSplatArray: any): void;
    static parseToUncompressedSplatBufferSection(startSplat: number, endSplat: number, splatBuffer: ArrayBuffer, section: number, outBuffer: ArrayBuffer, outOffset: number): void;
  }

  export class PlyLoader {
    static loadFromURL(fileName: string, onProgress?: (percent: number, percentLabel: string, chunk?: Uint8Array, fileSize?: number) => void, progressiveLoad?: boolean, onSectionProgress?: (splatBuffer: SplatBuffer, finalBuild: boolean) => void, splatAlphaRemovalThreshold?: number, compressionLevel?: number, optimizeSplatData?: boolean, sphericalHarmonicsDegree?: number, headers?: Record<string, string>): AbortablePromise<SplatBuffer>;
    static loadFromFileData(plyFileData: ArrayBuffer, splatAlphaRemovalThreshold?: number, compressionLevel?: number, optimizeSplatData?: boolean, sectionSize?: number, sceneCenter?: any, blockSize?: number, bucketSize?: number, sphericalHarmonicsDegree?: number): Promise<SplatBuffer>;
  }

  export class SplatLoader {
    static loadFromURL(fileName: string, onProgress?: (percent: number, percentLabel: string, chunk?: Uint8Array, fileSize?: number) => void, progressiveLoadToSplatBuffer?: boolean, onProgressiveLoadSectionProgress?: (splatBuffer: SplatBuffer, finalBuild: boolean) => void, minimumAlpha?: number, compressionLevel?: number, optimizeSplatData?: boolean, headers?: Record<string, string>, sectionSize?: number, sceneCenter?: any, blockSize?: number, bucketSize?: number): AbortablePromise<SplatBuffer>;
    static loadFromFileData(splatFileData: ArrayBuffer, minimumAlpha?: number, compressionLevel?: number, optimizeSplatData?: boolean, sectionSize?: number, sceneCenter?: any, blockSize?: number, bucketSize?: number): Promise<SplatBuffer>;
  }

  export class KSplatLoader {
    static loadFromURL(fileName: string, externalOnProgress?: (percent: number, percentLabel: string, chunk?: Uint8Array, fileSize?: number) => void, progressiveLoadToSplatBuffer?: boolean, onSectionBuilt?: (splatBuffer: SplatBuffer, finalBuild: boolean) => void, headers?: Record<string, string>): AbortablePromise<SplatBuffer>;
    static loadFromFileData(fileData: ArrayBuffer): Promise<SplatBuffer>;
    static downloadFile(splatBuffer: SplatBuffer, fileName: string): void;
  }

  export class SpzLoader {
    static loadFromURL(fileName: string, onProgress?: (percent: number, percentLabel: string) => void, splatAlphaRemovalThreshold?: number, compressionLevel?: number, optimizeSplatData?: boolean, sphericalHarmonicsDegree?: number, headers?: Record<string, string>): AbortablePromise<SplatBuffer>;
  }

  export class PlyParser {
    static parseToUncompressedSplatArray(plyFileData: ArrayBuffer): any;
  }

  export class PlayCanvasCompressedPlyParser {
    static parseToUncompressedSplatArray(plyFileData: ArrayBuffer): any;
  }

  export namespace LoaderUtils {
    function sceneFormatFromPath(path: string): SceneFormat;
  }

  export class SplatMesh {
    constructor(splatRenderMode: SplatRenderMode, dynamicScene?: boolean, enableOptionalEffects?: boolean, halfPrecisionCovariancesOnGPU?: boolean, devicePixelRatio?: number, gpuAcceleratedSort?: boolean, integerBasedSort?: boolean, antialiased?: boolean, maxScreenSpaceSplatSize?: number, logLevel?: LogLevel, sphericalHarmonicsDegree?: number, sceneFadeInRateMultiplier?: number, kernel2DSize?: number);
    build(splatBuffers: SplatBuffer[], splatBufferOptions?: any[], addToExisting?: boolean, finalBuild?: boolean, onSplatTreeIndexesUpload?: (finished: boolean) => void, onSplatTreeReady?: (finished: boolean) => void, preserveVisibleRegion?: boolean): any;
    updateTransforms(): void;
    updateUniforms(renderDimensions: any, focalLengthX: number, focalLengthY: number, isOrthographic: boolean, zoom: number, inverseFocalAdjustment: number): void;
    updateVisibleRegionFadeDistance(sceneRevealMode: SceneRevealMode): void;
    updateRenderIndexes(sortedIndexes: Uint32Array, splatRenderCount: number): void;
    getSplatCount(): number;
    getMaxSplatCount(): number;
    getSplatTree(): any;
    setRenderer(renderer: any): void;
    setSplatScale(scale: number): void;
    getSplatScale(): number;
    setPointCloudModeEnabled(enabled: boolean): void;
    getPointCloudModeEnabled(): boolean;
    dispose(): void;
    scenes: any[];
    visibleRegionChanging: boolean;
    material: any;
  }

  export class Raycaster {
    constructor();
    setFromCameraAndScreenPosition(camera: any, screenPosition: any, renderDimensions: any): void;
    intersectSplatMesh(splatMesh: SplatMesh, outHits?: any[]): any[];
  }

  export class SceneHelper {
    constructor(threeScene: any);
    setupMeshCursor(): void;
    setupFocusMarker(): void;
    setupControlPlane(): void;
    setMeshCursorVisibility(visible: boolean): void;
    getMeschCursorVisibility(): boolean;
    positionAndOrientMeshCursor(position: any, camera: any): void;
    setFocusMarkerVisibility(visible: boolean): void;
    getFocusMarkerOpacity(): number;
    setFocusMarkerOpacity(opacity: number): void;
    updateFocusMarker(target: any, camera: any, renderDimensions: any): void;
    setControlPlaneVisibility(visible: boolean): void;
    positionAndOrientControlPlane(target: any, up: any): void;
    dispose(): void;
    meshCursor: any;
    focusMarker: any;
    controlPlane: any;
  }

  export class Hit {
    constructor(origin?: any, normal?: any);
    origin: any;
    normal: any;
  }

  export class SplatScene {
    constructor(splatBuffer: SplatBuffer, splatBufferOptions?: any, onSplatTreeIndexesUpload?: (finished: boolean) => void, onSplatTreeReady?: (finished: boolean) => void, preserveVisibleRegion?: boolean);
    splatBuffer: SplatBuffer;
    position: any;
    quaternion: any;
    scale: any;
  }

  export function fetchWithProgress(path: string, onProgress?: (percent: number, percentLabel: string, chunk?: Uint8Array, fileSize?: number) => void, saveChunks?: boolean, headers?: Record<string, string>): AbortablePromise<ArrayBuffer>;
  export function delayedExecute(func?: () => any, fast?: boolean): Promise<any>;
  export function clamp(val: number, min: number, max: number): number;
  export function getCurrentTime(): number;
  export function disposeAllMeshes(object3D: any): void;
  export function getSphericalHarmonicsComponentCountForDegree(sphericalHarmonicsDegree?: number): number;
  export function nativePromiseWithExtractedComponents(): { promise: Promise<any>; resolve: (value?: any) => void; reject: (reason?: any) => void };
  export function abortablePromiseWithExtractedComponents(abortHandler?: (reason?: any) => void): { promise: AbortablePromise<any>; resolve: (value?: any) => void; reject: (reason?: any) => void; abortHandler: (reason?: any) => void };
  export function isIOS(): boolean;
  export function getIOSSemever(): { major: number; minor: number; patch: number };
  export function uintEncodedFloat(f: number): number;
  export function floatToHalf(val: number): number;
  export function rgbaToInteger(r: number, g: number, b: number, a: number): number;
  export function rgbaArrayToInteger(arr: Uint8Array | number[], offset: number): number;
}
