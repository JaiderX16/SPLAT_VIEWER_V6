// Editor-view overlay primitives: a flat-colored point list (frustum lines,
// camera gizmo) and a fullscreen triangle used as the picture-in-picture
// background. Everything comes from the uniform, no vertex buffers.

struct Overlay {
  viewProj: mat4x4f,
  color: vec4f,
  points: array<vec4f, 24>,
}

@group(0) @binding(0) var<uniform> overlay: Overlay;

@vertex
fn vs_points(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  return overlay.viewProj * vec4f(overlay.points[vertexIndex].xyz, 1.0);
}

@vertex
fn vs_fullscreen(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
  var corners = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(corners[vertexIndex], 0.5, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4f {
  return vec4f(overlay.color.rgb * overlay.color.a, overlay.color.a);
}
