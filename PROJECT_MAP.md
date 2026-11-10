# PROJECT_MAP — auto-generated dependency index (do not edit by hand)
# 45 files (js:45). Auto-refreshed on source edits; or run /claude-dependency-mapper.
# format:  <file>  imp: <imports>  by: <dependents>   (paths relative to project root)

eslint.config
lib/assets/splat.worker-B14O4r_c
lib/GaussianSplatViewer-DYpR68J6  imp: lib/lib-BKb6mPGP  by: lib/lib-BKb6mPGP
lib/lib-BKb6mPGP  imp: lib/GaussianSplatViewer-DYpR68J6  by: lib/GaussianSplatViewer-DYpR68J6, lib/splat-viewer
lib/splat-viewer  imp: lib/lib-BKb6mPGP
postcss.config
src/App  imp: src/pages/Home  by: src/main
src/components/AdvancedControlsPanel  imp: src/components/LiquidGlass, src/components/ui/slider, src/lib/viewerHandle  by: src/pages/Home
src/components/GaussianSplatViewer  imp: src/lib/editorOverlay, src/lib/viewerHandle  by: src/pages/Home
src/components/InfoPanel  imp: src/components/LiquidGlass, src/components/ui/button  by: src/pages/Home
src/components/LiquidGlass  by: src/components/AdvancedControlsPanel, src/components/InfoPanel, src/components/NavigationPanel, src/components/PerformanceBenchmarkPanel, src/components/ProgressiveLoader, src/components/Sidebar, src/pages/Home
src/components/NavigationPanel  imp: src/components/LiquidGlass, src/lib/viewerHandle  by: src/pages/Home
src/components/PerformanceBenchmarkPanel  imp: src/components/LiquidGlass, src/lib/performanceBenchmark  by: src/pages/Home
src/components/ProgressiveLoader  imp: src/components/LiquidGlass, src/components/ui/progress  by: src/pages/Home
src/components/SceneUploader  imp: src/components/ui/button, src/components/ui/input, src/components/ui/label, src/components/ui/select, src/components/ui/switch  by: src/components/Sidebar, src/pages/Home
src/components/Sidebar  imp: src/components/LiquidGlass, src/components/SceneUploader  by: src/components/SidebarMobileSheet, src/pages/Home
src/components/SidebarMobileSheet  imp: src/components/Sidebar  by: src/pages/Home
src/components/ui/button  imp: src/lib/utils  by: src/components/InfoPanel, src/components/SceneUploader
src/components/ui/dialog  imp: src/lib/utils  by: src/pages/Home
src/components/ui/input  imp: src/lib/utils  by: src/components/SceneUploader
src/components/ui/label  imp: src/lib/utils  by: src/components/SceneUploader
src/components/ui/progress  imp: src/lib/utils  by: src/components/ProgressiveLoader
src/components/ui/select  imp: src/lib/utils  by: src/components/SceneUploader
src/components/ui/slider  imp: src/lib/utils  by: src/components/AdvancedControlsPanel
src/components/ui/switch  imp: src/lib/utils  by: src/components/SceneUploader
src/components/WebGPUSplatViewer  imp: src/lib/viewerHandle, src/lib/webgpu-splat/SplatRenderer  by: src/pages/Home
src/hooks/useTheme  by: src/pages/Home
src/lib  imp: src/lib/viewerHandle, src/pages/Home
src/lib/editorOverlay  by: src/components/GaussianSplatViewer
src/lib/performanceBenchmark  by: src/components/PerformanceBenchmarkPanel, src/pages/Home
src/lib/utils  by: src/components/ui/button, src/components/ui/dialog, src/components/ui/input, src/components/ui/label, src/components/ui/progress, src/components/ui/select, src/components/ui/slider, src/components/ui/switch
src/lib/viewerHandle  by: src/components/AdvancedControlsPanel, src/components/GaussianSplatViewer, src/components/NavigationPanel, src/components/WebGPUSplatViewer, src/lib, src/lib/webgpu-splat/SplatRenderer, src/lib/webgpu-splat/orbitControls, src/pages/Home
src/lib/webgpu-splat/collision  imp: src/lib/webgpu-splat/math  by: src/lib/webgpu-splat/SplatRenderer
src/lib/webgpu-splat/EditorView  imp: src/lib/webgpu-splat/math, src/lib/webgpu-splat/protocol  by: src/lib/webgpu-splat/SplatRenderer
src/lib/webgpu-splat/math  by: src/lib/webgpu-splat/EditorView, src/lib/webgpu-splat/SplatRenderer, src/lib/webgpu-splat/collision, src/lib/webgpu-splat/orbitControls
src/lib/webgpu-splat/orbitControls  imp: src/lib/viewerHandle, src/lib/webgpu-splat/math  by: src/lib/webgpu-splat/SplatRenderer
src/lib/webgpu-splat/protocol  by: src/lib/webgpu-splat/EditorView, src/lib/webgpu-splat/SplatRenderer, src/lib/webgpu-splat/splat.worker
src/lib/webgpu-splat/splat.worker  imp: src/lib/webgpu-splat/protocol
src/lib/webgpu-splat/SplatRenderer  imp: src/lib/viewerHandle, src/lib/webgpu-splat/EditorView, src/lib/webgpu-splat/collision, src/lib/webgpu-splat/math, src/lib/webgpu-splat/orbitControls, src/lib/webgpu-splat/protocol  by: src/components/WebGPUSplatViewer, src/pages/Home
src/main  imp: src/App
src/pages/Home  imp: src/components/AdvancedControlsPanel, src/components/GaussianSplatViewer, src/components/InfoPanel, src/components/LiquidGlass, src/components/NavigationPanel, src/components/PerformanceBenchmarkPanel, src/components/ProgressiveLoader, src/components/SceneUploader, src/components/Sidebar, src/components/SidebarMobileSheet, src/components/WebGPUSplatViewer, src/components/ui/dialog, src/hooks/useTheme, src/lib/performanceBenchmark, src/lib/viewerHandle, src/lib/webgpu-splat/SplatRenderer  by: src/App, src/lib
src/types/gaussian-splats-3d.d
src/wgsl-env.d
tailwind.config
vite.config
