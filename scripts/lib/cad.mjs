// Shared CAD toolkit for the procedural model generators.
//
// Every model follows the Nautilus model-library authoring contract:
// meters, +Y up, origin at the machine's floor center, named parts, the
// library's authored PBR materials, `extras.layer` / `extras.assembly` on
// every mesh, `extras.explode` on every movable node, rotation-only
// animation tracks. `exportPair` writes the Assembled/Exploded GLB pair and
// returns the manifest entry the viewer's model picker reads.

import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

// GLTFExporter reads its merged buffers back through FileReader, which Node
// does not ship. Blob exists; this shim covers the one method the binary
// path uses.
globalThis.FileReader ??= class FileReaderShim {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
};

// --- materials (library values: linear-space base color) -------------------

export function pbr(name, [r, g, b], metalness, roughness) {
  const material = new THREE.MeshStandardMaterial({ metalness, roughness });
  material.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  material.name = name;
  return material;
}

export const LIGHT_GRAY = pbr("CAD Light Gray", [0.5647, 0.5841, 0.6038], 0.55, 0.32);
export const MACHINED = pbr("Machined Metal", [0.3325, 0.3613, 0.3813], 0.82, 0.22);
export const DARK = pbr("Dark Metal", [0.0802, 0.0931, 0.1046], 0.7, 0.3);
export const COPPER = pbr("Copper Winding", [0.479, 0.171, 0.033], 0.9, 0.35);

// --- geometry helpers --------------------------------------------------------

export const SEGMENTS = 40;
export const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** Orient a geometry built along +Y (cylinders) onto `axis`. */
export function orientY(geometry, axis) {
  if (axis === "x") geometry.rotateZ(-Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Orient a geometry built along +Z (extrusions) onto `axis`. */
export function orientZ(geometry, axis) {
  if (axis === "x") geometry.rotateY(Math.PI / 2);
  if (axis === "y") geometry.rotateX(-Math.PI / 2);
  return geometry;
}

export function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

export function cyl(radius, height, axis = "y", segments = SEGMENTS) {
  return orientY(new THREE.CylinderGeometry(radius, radius, height, segments), axis);
}

/** ExtrudeGeometry is non-indexed; welding vertices roughly halves the GLB. */
export function indexed(geometry) {
  const merged = mergeVertices(geometry, 1e-5);
  merged.computeVertexNormals();
  return merged;
}

/** Hollow cylinder (races, housings, stator cores), centered on its axis. */
export function ring(rOuter, rInner, height, axis = "y") {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rInner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = indexed(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: SEGMENTS }));
  geometry.translate(0, 0, -height / 2);
  return orientZ(geometry, axis);
}

/**
 * Spur gear: trapezoidal teeth around a pitch radius, optional bore. With
 * `internal` the teeth face inward (a circular spline / ring gear).
 */
export function gear(rPitch, teeth, thickness, rBore = 0, axis = "y", internal = false) {
  const addendum = Math.max(rPitch * 0.08, 0.004);
  const profile = ([rLow, rHigh]) => {
    const points = [];
    const step = (Math.PI * 2) / teeth;
    for (let i = 0; i < teeth; i += 1) {
      const a0 = i * step;
      points.push([a0, rLow], [a0 + step * 0.2, rLow], [a0 + step * 0.32, rHigh], [a0 + step * 0.68, rHigh], [a0 + step * 0.8, rLow]);
    }
    return points.map(([a, r]) => new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  };
  const shape = new THREE.Shape();
  if (internal) {
    shape.absarc(0, 0, rPitch + addendum * 3, 0, Math.PI * 2, false);
    const hole = new THREE.Path(profile([rPitch + addendum, rPitch - addendum]).reverse());
    shape.holes.push(hole);
  } else {
    shape.setFromPoints(profile([rPitch - addendum, rPitch + addendum]));
    if (rBore > 0) {
      const bore = new THREE.Path();
      bore.absarc(0, 0, rBore, 0, Math.PI * 2, true);
      shape.holes.push(bore);
    }
  }
  const geometry = indexed(new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 16 }));
  geometry.translate(0, 0, -thickness / 2);
  return orientZ(geometry, axis);
}

export function torus(radius, tube, axis = "y", radial = 10, tubular = 32) {
  const geometry = new THREE.TorusGeometry(radius, tube, radial, tubular);
  // TorusGeometry lies in XY (axis Z).
  if (axis === "y") geometry.rotateX(Math.PI / 2);
  if (axis === "x") geometry.rotateY(Math.PI / 2);
  return geometry;
}

export function tube(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, 28, radius, 10, false);
}

/**
 * `count` copies of `geometry` arranged around `axis`, welded into one
 * mesh-worth of geometry — fins, fan blades, bolt circles.
 */
export function radialArray(geometry, count, axis = "y", phase = 0) {
  const copies = [];
  for (let i = 0; i < count; i += 1) {
    const copy = geometry.clone();
    const angle = phase + (i / count) * Math.PI * 2;
    if (axis === "x") copy.rotateX(angle);
    if (axis === "y") copy.rotateY(angle);
    if (axis === "z") copy.rotateZ(angle);
    copies.push(copy);
  }
  return mergeGeometries(copies, false);
}

// --- part factory -------------------------------------------------------------------

export function part(name, geometry, material, position, { layer = "internal", explode = [0, 0, 0], assembly = "Model" } = {}) {
  // No textures anywhere: drop UVs (a quarter of the vertex payload) and
  // keep normals unit-length so the exporter never has to renormalize.
  geometry.deleteAttribute("uv");
  fixNormals(geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.userData.explode = explode;
  mesh.userData.layer = layer;
  mesh.userData.assembly = assembly;
  return mesh;
}

/**
 * Unit-length normals everywhere. Extruded full circles close on a
 * duplicated point, which leaves a degenerate sliver whose vertices get a
 * zero normal; those vertices are invisible, so any unit vector will do.
 */
function fixNormals(geometry) {
  const normal = geometry.getAttribute("normal");
  if (!normal) return;
  for (let i = 0; i < normal.count; i += 1) {
    const x = normal.getX(i);
    const y = normal.getY(i);
    const z = normal.getZ(i);
    const length = Math.hypot(x, y, z);
    if (length < 1e-6 || !Number.isFinite(length)) normal.setXYZ(i, 0, 1, 0);
    else normal.setXYZ(i, x / length, y / length, z / length);
  }
  normal.needsUpdate = true;
}

export function joint(name, position, axis, explode) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  node.userData.explode = explode;
  node.userData.joint = { axis };
  return node;
}

export function group(name, position, explode = [0, 0, 0]) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  node.userData.explode = explode;
  return node;
}

export const scaled = (v, k) => v.map((c) => c * k);
export const add = (a, b) => a.map((c, i) => c + b[i]);
export const unit = (axis, sign = 1) => AXES[axis].toArray().map((c) => c * sign);

/**
 * Sensor chip: a nearly flat square, parented to a node that survives the
 * shell being switched off. `normal` is the housing surface normal the chip
 * lies flat against.
 */
export function sensorChip(id, label, position, normal, covers, assembly) {
  const mesh = part(`Sensor_Chip_${label}`, box(0.032, 0.0035, 0.032), DARK, position, { layer: "sensor", explode: [0, 0, 0], assembly });
  mesh.quaternion.setFromUnitVectors(AXES.y, new THREE.Vector3(...normal).normalize());
  mesh.userData.sensor = { id, label: label.toLowerCase().replace(/_/g, " "), covers };
  return mesh;
}

// --- animation helpers ---------------------------------------------------------------

export const smoothstep = (u) => u * u * (3 - 2 * u);

/** Quaternion track for `node` spinning about `axis` by `angleAt(t)` degrees. */
export function spinTrack(node, axis, angleAt, seconds, hz = 30) {
  const frames = Math.round(seconds * hz);
  const times = new Float32Array(frames + 1);
  const values = new Float32Array((frames + 1) * 4);
  const quaternion = new THREE.Quaternion();
  for (let frame = 0; frame <= frames; frame += 1) {
    const t = (frame / frames) * seconds;
    times[frame] = t;
    quaternion.setFromAxisAngle(AXES[axis], THREE.MathUtils.degToRad(angleAt(t)));
    quaternion.toArray(values, frame * 4);
  }
  return new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, values);
}

// --- export ---------------------------------------------------------------------

function applyExplode(root) {
  root.traverse((node) => {
    const offset = node.userData.explode;
    if (offset) node.position.add(new THREE.Vector3(...offset));
  });
}

/**
 * Export a model as its Assembled/Exploded pair. `model` provides
 * `{ id, file, label, description, build(rootName) → built, clip(built) }`
 * where `built.root` is the scene root. Returns the manifest entry.
 */
export async function exportPair(model, outDir) {
  const files = {};
  let counts = null;
  let tracks = 0;
  let seconds = 0;
  let clipName = "";
  for (const view of ["Assembled", "Exploded"]) {
    const built = model.build(`${model.file}_${view}`);
    if (view === "Exploded") applyExplode(built.root);
    const clip = model.clip(built);
    const exporter = new GLTFExporter();
    const glb = await exporter.parseAsync(built.root, { binary: true, animations: [clip], trs: true });
    const file = `${model.file}_${view}.glb`;
    await writeFile(path.join(outDir, file), Buffer.from(glb));
    files[view.toLowerCase()] = { file, bytes: glb.byteLength };
    counts = { shell: 0, internal: 0, sensor: 0 };
    built.root.traverse((node) => {
      if (node.isMesh) counts[node.userData.layer] += 1;
    });
    tracks = clip.tracks.length;
    seconds = clip.duration;
    clipName = clip.name;
  }
  return {
    id: model.id,
    label: model.label,
    description: model.description,
    files,
    parts: counts.shell + counts.internal + counts.sensor,
    layers: counts,
    clip: { name: clipName, seconds, tracks },
  };
}
