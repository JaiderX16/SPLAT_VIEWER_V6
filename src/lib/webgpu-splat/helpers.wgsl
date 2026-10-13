// Procedural editor helpers (no vertex buffers): a ground grid on the XZ plane
// and RGB world axes, both drawn as line lists from `vertex_index`.

struct Helpers {
  viewProj: mat4x4f,
  // x: grid half-size (world units), y: divisions, z: axes length
  params: vec4f,
}

@group(0) @binding(0) var<uniform> helpers: Helpers;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
}

@vertex
fn vs_grid(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let half = helpers.params.x;
  let divisions = u32(helpers.params.y);
  let line = vertexIndex / 2u;
  let end = f32(vertexIndex % 2u) * 2.0 - 1.0;
  let linesPerAxis = divisions + 1u;
  let along = line >= linesPerAxis; // second family: lines parallel to X
  let i = line % linesPerAxis;
  let offset = (f32(i) / f32(divisions) * 2.0 - 1.0) * half;

  var p: vec3f;
  if (along) {
    p = vec3f(end * half, 0.0, offset);
  } else {
    p = vec3f(offset, 0.0, end * half);
  }
  let isCenter = i == divisions / 2u;

  var out: VertexOut;
  out.position = helpers.viewProj * vec4f(p, 1.0);
  out.color = select(vec4f(0.16, 0.16, 0.18, 0.55), vec4f(0.53, 0.53, 0.56, 0.7), isCenter);
  return out;
}

@vertex
fn vs_axes(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let axis = vertexIndex / 2u;
  let t = f32(vertexIndex % 2u) * helpers.params.z;
  var dir = vec3f(0.0);
  dir[axis] = 1.0;

  var out: VertexOut;
  out.position = helpers.viewProj * vec4f(dir * t, 1.0);
  out.color = vec4f(dir, 1.0);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  return vec4f(in.color.rgb * in.color.a, in.color.a);
}
