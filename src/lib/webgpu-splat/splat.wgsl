// Gaussian splat rasterizer (EWA splatting, back-to-front, premultiplied alpha).
//
// One instance per visible splat; `order` holds the worker's depth-sorted
// indices, so instance 0 is the farthest splat. Each instance expands into a
// screen-aligned quad (two triangles) covering ±2√2 σ of the projected 2D
// Gaussian; the fragment stage evaluates the falloff.

struct Camera {
  view: mat4x4f,
  proj: mat4x4f,
  // Render target size in physical pixels.
  viewport: vec2f,
  // Focal length in pixels (perspective) or pixels per world unit (orthographic).
  focal: vec2f,
  // x: splat scale, y: point-cloud mode (0/1), z: orthographic (0/1), w: tan(fov/2) clamp
  params: vec4f,
  // x: order entries are LOD-packed (0/1), y: LOD_MAX_SCALE
  lod: vec4f,
}

@group(0) @binding(0) var<uniform> camera: Camera;
// 2 × vec4u per splat — layout documented in protocol.ts.
// `order` entries: splat index (low 24 bits) | LOD footprint scale (top 8 bits).
@group(0) @binding(1) var<storage, read> splats: array<vec4u>;
@group(0) @binding(2) var<storage, read> order: array<u32>;

const COVARIANCE_UNPACK: f32 = 0.25; // 1 / COVARIANCE_PACK_SCALE
const MAX_AXIS_PX: f32 = 1024.0;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  // Quad-local coordinate in units of √2 σ; |uv|² = 4 is the cutoff.
  @location(1) uv: vec2f,
}

fn culled() -> VertexOut {
  var out: VertexOut;
  out.position = vec4f(0.0, 0.0, 2.0, 1.0); // outside the clip volume
  out.color = vec4f(0.0);
  out.uv = vec2f(0.0);
  return out;
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOut {
  let entry = order[instanceIndex];
  let packed = camera.lod.x > 0.5;
  let index = select(entry, entry & 0xFFFFFFu, packed);
  // Thinned far splats are drawn larger so the covered area is preserved.
  let lodScale = select(1.0, 1.0 + f32(entry >> 24u) / 255.0 * (camera.lod.y - 1.0), packed);
  let a = splats[index * 2u];
  let b = splats[index * 2u + 1u];

  let center = vec3f(bitcast<f32>(a.x), bitcast<f32>(a.y), bitcast<f32>(a.z));
  let viewPos = camera.view * vec4f(center, 1.0);
  let clip = camera.proj * viewPos;
  let ortho = camera.params.z > 0.5;

  // Behind the eye: also applies to orthographic, whose volume would
  // otherwise include everything between the orbit pivot and the camera.
  if (viewPos.z > -0.05) {
    return culled();
  }
  let ndc = clip.xy / clip.w;
  if (any(abs(ndc) > vec2f(1.5))) {
    return culled();
  }

  let rgba = unpack4x8unorm(a.w);
  var major: vec2f;
  var minor: vec2f;

  if (camera.params.y > 0.5) {
    // Point-cloud mode: fixed-size round dots.
    major = vec2f(1.5, 0.0);
    minor = vec2f(0.0, 1.5);
  } else {
    let c0 = unpack2x16float(b.x); // c00, c01
    let c1 = unpack2x16float(b.y); // c02, c11
    let c2 = unpack2x16float(b.z); // c12, c22
    let s = COVARIANCE_UNPACK * camera.params.x * camera.params.x;
    let vrk = mat3x3f(
      vec3f(c0.x, c0.y, c1.x),
      vec3f(c0.y, c1.y, c2.x),
      vec3f(c1.x, c2.x, c2.y),
    ) * s;

    // Jacobian of the projection, in camera space (camera looks down −Z).
    var jac: mat3x3f;
    if (ortho) {
      jac = mat3x3f(
        vec3f(camera.focal.x, 0.0, 0.0),
        vec3f(0.0, camera.focal.y, 0.0),
        vec3f(0.0, 0.0, 0.0),
      );
    } else {
      let depth = -viewPos.z;
      // Clamp the lateral offset like the reference 3DGS rasterizer so splats
      // near the frustum edge do not explode.
      let lim = 1.3 * camera.params.w;
      let tx = clamp(viewPos.x / depth, -lim, lim) * depth;
      let ty = clamp(viewPos.y / depth, -lim, lim) * depth;
      jac = mat3x3f(
        vec3f(camera.focal.x / depth, 0.0, 0.0),
        vec3f(0.0, camera.focal.y / depth, 0.0),
        vec3f(camera.focal.x * tx / (depth * depth), camera.focal.y * ty / (depth * depth), 0.0),
      );
    }
    let rot = mat3x3f(camera.view[0].xyz, camera.view[1].xyz, camera.view[2].xyz);
    let t = jac * rot;
    let cov2d = t * vrk * transpose(t);

    // Low-pass filter (≈ one pixel) keeps sub-pixel splats from aliasing.
    let ca = cov2d[0][0] + 0.3;
    let cb = cov2d[0][1];
    let cc = cov2d[1][1] + 0.3;

    let mid = 0.5 * (ca + cc);
    let radius = length(vec2f(0.5 * (ca - cc), cb));
    let lambda1 = mid + radius;
    let lambda2 = mid - radius;
    if (lambda2 < 0.0) {
      return culled();
    }
    let dv = vec2f(cb, lambda1 - ca);
    let dl = length(dv);
    let diag = select(vec2f(1.0, 0.0), dv / dl, dl > 1e-8);
    major = min(sqrt(2.0 * lambda1) * lodScale, MAX_AXIS_PX) * diag;
    minor = min(sqrt(2.0 * lambda2) * lodScale, MAX_AXIS_PX) * vec2f(diag.y, -diag.x);
  }

  // Two triangles: (-2,-2) (2,-2) (2,2) | (-2,-2) (2,2) (-2,2)
  var corners = array<vec2f, 6>(
    vec2f(-2.0, -2.0), vec2f(2.0, -2.0), vec2f(2.0, 2.0),
    vec2f(-2.0, -2.0), vec2f(2.0, 2.0), vec2f(-2.0, 2.0),
  );
  let corner = corners[vertexIndex];
  let offsetPx = corner.x * major + corner.y * minor;

  var out: VertexOut;
  out.position = vec4f(ndc + offsetPx * 2.0 / camera.viewport, 0.5, 1.0);
  out.color = rgba;
  out.uv = corner;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4f {
  let r2 = dot(in.uv, in.uv);
  if (r2 > 4.0) {
    discard;
  }
  var alpha: f32;
  if (camera.params.y > 0.5) {
    alpha = 1.0;
  } else {
    alpha = exp(-r2) * in.color.a;
  }
  if (alpha < 1.0 / 255.0) {
    discard;
  }
  return vec4f(in.color.rgb * alpha, alpha);
}
