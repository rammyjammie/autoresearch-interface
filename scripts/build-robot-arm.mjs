// Six-axis robot arm — procedural CAD model generator (internals edition).
//
// Builds the arm as a named kinematic hierarchy with three.js primitives and
// exports it twice through GLTFExporter, following the Nautilus model-library
// authoring contract:
//
// - Units are meters, +Y up, origin at the machine's floor center.
// - Every component is a named mesh and every joint a named empty
//   (`J1_Base_Rotation` ... `J6_Tool_Flange`).
// - Each mesh carries `extras.layer`: "shell" (the external metal skin —
//   housings, covers, caps, arm skins), "internal" (everything mechanical:
//   servo stacks, harmonic drives, bearings, shafts, gears, spars, harness),
//   or "sensor" (the three flat sensor chips). A parts view hides "shell"
//   and nothing else; chips are parented to joints, never to the shell, so
//   they stay put when the skin is switched off.
// - `extras.assembly` groups parts by station (Base, J1 ... J6, Gripper).
// - Materials are the library's authored PBR set ("CAD Light Gray",
//   "Machined Metal", "Dark Metal") plus "Copper Winding" — viewers keep
//   them verbatim.
// - One looping clip ("Pick_And_Place", 9.6 s) drives the six joints, the
//   gripper jaws, and each joint's rotor assembly (spinning at the reduction
//   ratio) with rotation tracks only, so node positions are free for the
//   exploded file and a live explode tween.
// - Every movable node carries `extras.explode: [x, y, z]` — its offset from
//   its parent, in the parent's frame, in the exploded view. Internals fan
//   out along their axis; shells lift sideways off the mechanism.
//
// Run: `npm run model` → public/models/Six_Axis_Robot_Arm_{Assembled,Exploded}.glb

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

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

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/models");
const MODEL = "Six_Axis_Robot_Arm";

// --- materials (library values: linear-space base color) -------------------

function pbr(name, [r, g, b], metalness, roughness) {
  const material = new THREE.MeshStandardMaterial({ metalness, roughness });
  material.color.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
  material.name = name;
  return material;
}

const LIGHT_GRAY = pbr("CAD Light Gray", [0.5647, 0.5841, 0.6038], 0.55, 0.32);
const MACHINED = pbr("Machined Metal", [0.3325, 0.3613, 0.3813], 0.82, 0.22);
const DARK = pbr("Dark Metal", [0.0802, 0.0931, 0.1046], 0.7, 0.3);
const COPPER = pbr("Copper Winding", [0.479, 0.171, 0.033], 0.9, 0.35);

// --- geometry helpers --------------------------------------------------------

const SEGMENTS = 40;
const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

/** Orient a geometry built along +Y (cylinders) onto `axis`. */
function orientY(geometry, axis) {
  if (axis === "x") geometry.rotateZ(-Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Orient a geometry built along +Z (extrusions) onto `axis`. */
function orientZ(geometry, axis) {
  if (axis === "x") geometry.rotateY(Math.PI / 2);
  if (axis === "y") geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

function cyl(radius, height, axis = "y") {
  return orientY(new THREE.CylinderGeometry(radius, radius, height, SEGMENTS), axis);
}

/** Hollow cylinder (races, housings, stator cores), centered on its axis. */
function ring(rOuter, rInner, height, axis = "y") {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, rOuter, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, rInner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = indexed(new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: SEGMENTS }));
  geometry.translate(0, 0, -height / 2);
  return orientZ(geometry, axis);
}

/** ExtrudeGeometry is non-indexed; welding vertices roughly halves the GLB. */
function indexed(geometry) {
  const merged = mergeVertices(geometry, 1e-5);
  merged.computeVertexNormals();
  return merged;
}

/**
 * Spur gear: trapezoidal teeth around a pitch radius, optional bore. With
 * `internal` the teeth face inward (a circular spline / ring gear).
 */
function gear(rPitch, teeth, thickness, rBore = 0, axis = "y", internal = false) {
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

function torus(radius, tube, axis = "y") {
  const geometry = new THREE.TorusGeometry(radius, tube, 10, 32);
  // TorusGeometry lies in XY (axis Z).
  if (axis === "y") geometry.rotateX(Math.PI / 2);
  if (axis === "x") geometry.rotateY(Math.PI / 2);
  return geometry;
}

function tube(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, 28, radius, 10, false);
}

// --- part factory -------------------------------------------------------------------

let currentAssembly = "Base";

function part(name, geometry, material, position, { layer = "internal", explode = [0, 0, 0], assembly = currentAssembly } = {}) {
  // No textures anywhere: drop UVs (a quarter of the vertex payload) and
  // keep normals unit-length so the exporter never has to renormalize.
  geometry.deleteAttribute("uv");
  geometry.normalizeNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.userData.explode = explode;
  mesh.userData.layer = layer;
  mesh.userData.assembly = assembly;
  return mesh;
}

const shell = (name, geometry, position, explode, material = LIGHT_GRAY) =>
  part(name, geometry, material, position, { layer: "shell", explode });

function joint(name, position, axis, explode) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  node.userData.explode = explode;
  node.userData.joint = { axis };
  return node;
}

function group(name, position, explode = [0, 0, 0]) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  node.userData.explode = explode;
  return node;
}

const scaled = (v, k) => v.map((c) => c * k);
const add = (a, b) => a.map((c, i) => c + b[i]);
const unit = (axis, sign = 1) => AXES[axis].toArray().map((c) => c * sign);

/**
 * Sensor chip: a nearly flat square, parented to the joint that carries the
 * housing it sits on, so hiding the shell never hides it. `normal` is the
 * housing surface normal the chip lies flat against.
 */
function sensorChip(id, label, position, normal, covers) {
  const mesh = part(`Sensor_Chip_${label}`, box(0.032, 0.0035, 0.032), DARK, position, { layer: "sensor", explode: [0, 0, 0] });
  mesh.quaternion.setFromUnitVectors(AXES.y, new THREE.Vector3(...normal).normalize());
  mesh.userData.sensor = { id, label: label.toLowerCase(), covers };
  return mesh;
}

/**
 * Servo stack along `axis` at `origin`: stator core with copper end
 * windings, and a rotor assembly (rotor, shaft, brake disc, encoder disc)
 * grouped under one node so the clip can spin it. `back` is the sign along
 * the axis where the encoder end sits. Returns { meshes, rotor }.
 */
function servoStack(prefix, axis, origin, { rStator, length, back = 1, ratio = 30 }) {
  const u = unit(axis, back);
  const meshes = [];
  const along = (k) => add(origin, scaled(u, k));
  const fan = (k) => scaled(u, k);
  meshes.push(part(`${prefix}_Stator_Core`, ring(rStator, rStator * 0.62, length, axis), DARK, origin, { explode: fan(0.12) }));
  meshes.push(part(`${prefix}_Winding_Front`, torus(rStator * 0.66, rStator * 0.16, axis), COPPER, along(-length / 2), { explode: fan(0.04) }));
  meshes.push(part(`${prefix}_Winding_Rear`, torus(rStator * 0.66, rStator * 0.16, axis), COPPER, along(length / 2), { explode: fan(0.2) }));
  meshes.push(part(`${prefix}_Encoder_Board`, orientY(box(rStator * 1.4, 0.004, rStator * 1.4), axis), DARK, along(length / 2 + 0.075), { explode: fan(0.42) }));

  const rotor = group(`${prefix}_Rotor_Assembly`, origin, fan(0.06));
  rotor.userData.spin = { axis, ratio };
  rotor.add(part(`${prefix}_Rotor`, cyl(rStator * 0.52, length * 0.94, axis), MACHINED, [0, 0, 0], { explode: [0, 0, 0] }));
  rotor.add(part(`${prefix}_Motor_Shaft`, cyl(rStator * 0.14, length * 2.2, axis), MACHINED, [0, 0, 0], { explode: fan(-0.02) }));
  rotor.add(part(`${prefix}_Brake_Disc`, cyl(rStator * 0.82, 0.014, axis), DARK, scaled(u, length / 2 + 0.03), { explode: fan(0.18) }));
  rotor.add(part(`${prefix}_Encoder_Disc`, cyl(rStator * 0.5, 0.006, axis), MACHINED, scaled(u, length / 2 + 0.06), { explode: fan(0.3) }));
  return { meshes, rotor };
}

/**
 * Harmonic drive on the output end of a servo: wave generator (on the
 * rotor assembly), flexspline cup + gear, circular spline ring gear, and a
 * crossed-roller output bearing. Meshes stay on the static side; the caller
 * places the output flange on the moving link. `front` is the sign along
 * the axis toward the output.
 */
function harmonicDrive(prefix, axis, origin, r, { front = 1, rotor, teeth = 48 }) {
  const u = unit(axis, front);
  const along = (k) => add(origin, scaled(u, k));
  const fan = (k) => scaled(u, k);
  const meshes = [];
  const wave = part(`${prefix}_Wave_Generator`, cyl(r * 0.42, r * 0.3, axis), MACHINED, [0, 0, 0], { explode: fan(0.0) });
  // Elliptical cam: squash across the axis.
  wave.geometry.scale(axis === "x" ? 1 : 0.82, axis === "y" ? 1 : 0.82, axis === "z" ? 1 : 0.82);
  wave.position.set(...new THREE.Vector3(...origin).sub(rotor.position).toArray());
  rotor.add(wave);
  meshes.push(part(`${prefix}_Flexspline_Cup`, ring(r * 0.62, r * 0.58, r * 0.6, axis), MACHINED, along(-r * 0.18), { explode: fan(0.12) }));
  meshes.push(part(`${prefix}_Flexspline_Gear`, gear(r * 0.66, teeth, r * 0.22, r * 0.58, axis), MACHINED, along(r * 0.12), { explode: fan(0.22) }));
  meshes.push(part(`${prefix}_Circular_Spline`, gear(r * 0.7, teeth + 2, r * 0.26, 0, axis, true), DARK, along(r * 0.12), { explode: fan(0.36) }));
  meshes.push(part(`${prefix}_Bearing_Inner_Race`, ring(r * 0.86, r * 0.76, r * 0.16, axis), MACHINED, along(r * 0.42), { explode: fan(0.5) }));
  meshes.push(part(`${prefix}_Bearing_Rollers`, torus(r * 0.9, r * 0.055, axis), MACHINED, along(r * 0.42), { explode: fan(0.58) }));
  meshes.push(part(`${prefix}_Bearing_Outer_Race`, ring(r * 1.02, r * 0.94, r * 0.16, axis), MACHINED, along(r * 0.42), { explode: fan(0.66) }));
  return meshes;
}

function outputFlange(prefix, axis, position, r, explode) {
  return part(`${prefix}_Output_Flange`, cyl(r, 0.024, axis), MACHINED, position, { explode });
}

// --- the arm --------------------------------------------------------------------

function buildArm(rootName) {
  const root = new THREE.Group();
  root.name = rootName;
  const rotors = [];

  // ---- Base: plate, hollow pedestal shell, J1 servo + harmonic drive inside.
  currentAssembly = "Base";
  const base = group("Robot_Base", [0, 0, 0]);
  root.add(base);
  base.add(part("Base_Plate", box(0.72, 0.05, 0.72), MACHINED, [0, 0.025, 0]));
  for (const [tag, x, z] of [["FL", -0.3, 0.3], ["FR", 0.3, 0.3], ["RL", -0.3, -0.3], ["RR", 0.3, -0.3]]) {
    base.add(part(`Anchor_Bolt_${tag}`, cyl(0.022, 0.05), DARK, [x, 0.075, z], { explode: [0, 0.16, 0] }));
  }
  base.add(shell("Base_Pedestal_Shell", ring(0.27, 0.245, 0.3), [0, 0.2, 0], [0.55, 0.1, 0]));
  base.add(shell("Base_Connector_Panel", box(0.22, 0.14, 0.05), [0, 0.19, -0.285], [0, 0.05, -0.3], DARK));
  base.add(part("Base_Harness", tube([[0, 0.19, -0.26], [0.06, 0.16, -0.18], [0.1, 0.1, -0.06], [0.1, 0.06, 0.08]], 0.012), DARK, [0, 0, 0], { explode: [0, 0, 0.3] }));
  currentAssembly = "J1";
  const j1Servo = servoStack("J1", "y", [0, 0.15, 0], { rStator: 0.1, length: 0.13, back: -1, ratio: 30 });
  base.add(...j1Servo.meshes, j1Servo.rotor);
  rotors.push(j1Servo.rotor);
  base.add(...harmonicDrive("J1", "y", [0, 0.275, 0], 0.2, { front: 1, rotor: j1Servo.rotor, teeth: 56 }));
  base.add(sensorChip("base", "Base", [0.27, 0.22, 0], [1, 0, 0], ["Base", "J1"]));

  // ---- J1: base rotation about +Y. Turntable shell over the output flange,
  // cast shoulder frame inside the bracket shell, J2 servo on the frame.
  const j1 = joint("J1_Base_Rotation", [0, 0.35, 0], "y", [0, 0.5, 0]);
  root.add(j1);
  j1.add(outputFlange("J1", "y", [0, 0.012, 0], 0.19, [0, -0.1, 0]));
  j1.add(shell("Turntable_Shell", ring(0.25, 0.228, 0.15, "y"), [0, 0.085, 0], [-0.5, 0.05, 0]));
  j1.add(shell("Turntable_Cover", cyl(0.25, 0.018), [0, 0.169, 0], [-0.5, 0.2, 0]));
  j1.add(part("Shoulder_Frame", box(0.2, 0.3, 0.16), LIGHT_GRAY, [0, 0.31, 0], { explode: [0, 0.05, 0] }));
  j1.add(part("Shoulder_Frame_Rib_Front", box(0.2, 0.26, 0.012), LIGHT_GRAY, [0, 0.31, 0.086], { explode: [0, 0.05, 0.12] }));
  j1.add(part("Shoulder_Frame_Rib_Rear", box(0.2, 0.26, 0.012), LIGHT_GRAY, [0, 0.31, -0.086], { explode: [0, 0.05, -0.12] }));
  j1.add(shell("Shoulder_Bracket_Shell", box(0.3, 0.3, 0.26), [0, 0.31, 0], [0, 0.32, -0.42]));
  currentAssembly = "J2";
  j1.add(shell("J2_Motor_Housing", ring(0.11, 0.095, 0.2, "x"), [0.27, 0.46, 0], [0.42, 0.24, 0]));
  j1.add(shell("J2_Motor_Cap", cyl(0.11, 0.018, "x"), [0.379, 0.46, 0], [0.62, 0.24, 0], MACHINED));
  const j2Servo = servoStack("J2", "x", [0.27, 0.46, 0], { rStator: 0.085, length: 0.14, back: 1, ratio: 36 });
  j1.add(...j2Servo.meshes, j2Servo.rotor);
  rotors.push(j2Servo.rotor);
  j1.add(...harmonicDrive("J2", "x", [0.1, 0.46, 0], 0.11, { front: -1, rotor: j2Servo.rotor, teeth: 50 }));
  j1.add(sensorChip("shoulder", "Shoulder", [0.27, 0.571, 0], [0, 1, 0], ["J2"]));

  // ---- J2: shoulder pitch about +X. Hub shell around the drive, upper arm
  // skin over a cast spar with the harness inside; J3 servo at the top.
  const j2 = joint("J2_Shoulder", [0, 0.46, 0], "x", [0, 0.6, 0]);
  j1.add(j2);
  j2.add(outputFlange("J2", "x", [0.012, 0, 0], 0.1, [-0.08, 0, 0]));
  j2.add(shell("Shoulder_Hub_Shell", ring(0.13, 0.115, 0.3, "x"), [0, 0, 0], [0, 0, 0.42]));
  j2.add(shell("Shoulder_Hub_Cap", cyl(0.13, 0.018, "x"), [-0.159, 0, 0], [-0.22, 0, 0.42], MACHINED));
  j2.add(shell("Upper_Arm_Shell", box(0.18, 0.62, 0.2), [0, 0.31, 0], [0, 0, 0.5]));
  j2.add(part("Upper_Arm_Spar", box(0.09, 0.6, 0.11), LIGHT_GRAY, [0, 0.31, 0], { explode: [0, 0, 0] }));
  for (const [i, y] of [0.12, 0.31, 0.5].entries()) {
    j2.add(part(`Upper_Arm_Rib_${i + 1}`, box(0.15, 0.012, 0.17), LIGHT_GRAY, [0, y, 0], { explode: [0, 0, -0.16 - i * 0.06] }));
  }
  j2.add(part("Upper_Arm_Harness", tube([[0.03, 0.02, -0.07], [0.055, 0.2, -0.07], [0.055, 0.42, -0.07], [-0.05, 0.6, -0.06]], 0.011), DARK, [0, 0, 0], { explode: [0, 0, -0.32] }));
  j2.add(part("Cable_Dress", tube([[-0.14, 0.02, -0.08], [-0.2, 0.25, -0.12], [-0.16, 0.5, -0.04], [-0.13, 0.62, 0.05]], 0.02), DARK, [0, 0, 0], { explode: [-0.28, 0, 0] }));
  currentAssembly = "J3";
  j2.add(shell("J3_Motor_Housing", ring(0.085, 0.072, 0.16, "x"), [-0.22, 0.62, 0], [-0.34, 0.26, 0]));
  j2.add(shell("J3_Motor_Cap", cyl(0.085, 0.016, "x"), [-0.308, 0.62, 0], [-0.5, 0.26, 0], MACHINED));
  const j3Servo = servoStack("J3", "x", [-0.22, 0.62, 0], { rStator: 0.065, length: 0.11, back: -1, ratio: 36 });
  j2.add(...j3Servo.meshes, j3Servo.rotor);
  rotors.push(j3Servo.rotor);
  j2.add(...harmonicDrive("J3", "x", [-0.08, 0.62, 0], 0.095, { front: 1, rotor: j3Servo.rotor, teeth: 44 }));
  j2.add(sensorChip("elbow", "Elbow", [-0.22, 0.706, 0], [0, 1, 0], ["J3", "J4", "J5", "J6", "Gripper"]));

  // ---- J3: elbow pitch about +X. Elbow shell, forearm skin over a spar with
  // the J4 servo coaxial at the front and the J5/J6 servos at the rear
  // driving the wrist through parallel shafts.
  const j3 = joint("J3_Elbow", [0, 0.62, 0], "x", [0, 0.95, 0]);
  j2.add(j3);
  j3.add(outputFlange("J3", "x", [0.012, 0, 0], 0.085, [0.1, 0, 0]));
  j3.add(shell("Elbow_Housing_Shell", ring(0.12, 0.105, 0.26, "x"), [0, 0, 0], [0.35, 0, 0]));
  j3.add(shell("Elbow_Housing_Cap", cyl(0.12, 0.016, "x"), [0.138, 0, 0], [0.55, 0, 0], MACHINED));
  j3.add(shell("Forearm_Shell", box(0.16, 0.16, 0.56), [0, 0, 0.34], [0, 0.32, 0.05]));
  j3.add(part("Forearm_Spar", box(0.05, 0.06, 0.54), LIGHT_GRAY, [0, 0.03, 0.34], { explode: [0, 0, 0.05] }));
  currentAssembly = "J5";
  const j5Servo = servoStack("J5", "z", [-0.046, -0.04, 0.2], { rStator: 0.03, length: 0.08, back: -1, ratio: 28 });
  j3.add(...j5Servo.meshes, j5Servo.rotor);
  rotors.push(j5Servo.rotor);
  j3.add(part("J5_Drive_Shaft", cyl(0.008, 0.36, "z"), MACHINED, [-0.046, -0.04, 0.43], { explode: [-0.1, -0.1, 0.05] }));
  j3.add(part("J5_Shaft_Bearing", torus(0.014, 0.005, "z"), MACHINED, [-0.046, -0.04, 0.4], { explode: [-0.1, -0.16, 0.05] }));
  currentAssembly = "J6";
  const j6Servo = servoStack("J6", "z", [0.046, -0.04, 0.2], { rStator: 0.03, length: 0.08, back: -1, ratio: 28 });
  j3.add(...j6Servo.meshes, j6Servo.rotor);
  rotors.push(j6Servo.rotor);
  j3.add(part("J6_Drive_Shaft", cyl(0.008, 0.36, "z"), MACHINED, [0.046, -0.04, 0.43], { explode: [0.1, -0.1, 0.05] }));
  j3.add(part("J6_Shaft_Bearing", torus(0.014, 0.005, "z"), MACHINED, [0.046, -0.04, 0.4], { explode: [0.1, -0.16, 0.05] }));
  currentAssembly = "J4";
  const j4Servo = servoStack("J4", "z", [0, 0.03, 0.47], { rStator: 0.038, length: 0.09, back: -1, ratio: 30 });
  j3.add(...j4Servo.meshes, j4Servo.rotor);
  rotors.push(j4Servo.rotor);
  j3.add(...harmonicDrive("J4", "z", [0, 0.03, 0.575], 0.06, { front: 1, rotor: j4Servo.rotor, teeth: 40 }));

  // ---- J4: wrist roll about +Z. Roll housing over the output bearing; the
  // J5/J6 shafts continue to bevel pinions at the pitch axis.
  const j4 = joint("J4_Wrist_Roll", [0, 0.03, 0.62], "z", [0, 0, 0.32]);
  j3.add(j4);
  j4.add(outputFlange("J4", "z", [0, 0, 0.012], 0.058, [0, 0, -0.06]));
  j4.add(shell("Wrist_Housing_Shell", ring(0.085, 0.072, 0.16, "z"), [0, -0.03, 0.08], [0, 0.24, 0]));
  j4.add(part("Wrist_Harness", tube([[0.02, 0.05, 0.0], [0.045, 0.06, 0.06], [0.045, 0.04, 0.14]], 0.009), DARK, [0, 0, 0], { explode: [0.16, 0.1, 0] }));
  currentAssembly = "J5";
  j4.add(part("J5_Wrist_Shaft", cyl(0.008, 0.13, "z"), MACHINED, [-0.046, -0.07, 0.065], { explode: [-0.12, -0.06, 0] }));
  j4.add(part("J5_Bevel_Pinion", gear(0.02, 14, 0.012, 0.006, "z"), MACHINED, [-0.046, -0.07, 0.135], { explode: [-0.12, -0.06, 0.08] }));
  currentAssembly = "J6";
  j4.add(part("J6_Wrist_Shaft", cyl(0.008, 0.13, "z"), MACHINED, [0.046, -0.07, 0.065], { explode: [0.12, -0.06, 0] }));
  j4.add(part("J6_Bevel_Pinion", gear(0.02, 14, 0.012, 0.006, "z"), MACHINED, [0.046, -0.07, 0.135], { explode: [0.12, -0.06, 0.08] }));

  // ---- J5: wrist pitch about +X. Pitch housing over the bevel gear and its
  // bearing; J6 spur gear behind the tool flange.
  currentAssembly = "J5";
  const j5 = joint("J5_Wrist_Pitch", [0, -0.03, 0.16], "x", [0, 0, 0.27]);
  j4.add(j5);
  j5.add(shell("Wrist_Pitch_Housing_Shell", box(0.16, 0.13, 0.14), [0, 0, 0.07], [0, 0.24, 0]));
  j5.add(part("J5_Bevel_Gear", gear(0.045, 24, 0.014, 0.01, "x"), MACHINED, [-0.052, 0, 0], { explode: [-0.14, 0, 0] }));
  j5.add(part("J5_Pitch_Shaft", cyl(0.01, 0.15, "x"), MACHINED, [0, 0, 0], { explode: [0, 0, 0] }));
  j5.add(part("J5_Pitch_Bearing_Inner", ring(0.024, 0.014, 0.014, "x"), MACHINED, [0.055, 0, 0], { explode: [0.12, 0, 0] }));
  j5.add(part("J5_Pitch_Bearing_Rollers", torus(0.028, 0.004, "x"), MACHINED, [0.055, 0, 0], { explode: [0.18, 0, 0] }));
  j5.add(part("J5_Pitch_Bearing_Outer", ring(0.04, 0.032, 0.014, "x"), MACHINED, [0.055, 0, 0], { explode: [0.24, 0, 0] }));
  j5.add(part("Wrist_Pitch_Frame", box(0.11, 0.09, 0.1), LIGHT_GRAY, [0, 0, 0.07], { explode: [0, 0, 0] }));

  // ---- J6: tool flange roll about +Z, carrying a rack-and-pinion gripper.
  currentAssembly = "J6";
  const j6 = joint("J6_Tool_Flange", [0, 0, 0.14], "z", [0, 0, 0.2]);
  j5.add(j6);
  j6.add(part("J6_Drive_Gear", gear(0.036, 30, 0.012, 0.008, "z"), MACHINED, [0, 0, -0.012], { explode: [0, 0, -0.1] }));
  j6.add(part("Tool_Flange", cyl(0.06, 0.03, "z"), MACHINED, [0, 0, 0.015], { explode: [0, 0, 0] }));
  currentAssembly = "Gripper";
  j6.add(shell("Gripper_Body_Shell", box(0.15, 0.09, 0.1), [0, 0, 0.08], [0, 0.2, 0.12], DARK));
  j6.add(part("Gripper_Actuator", cyl(0.024, 0.06, "z"), DARK, [0, 0.018, 0.06], { explode: [0, 0, 0.1] }));
  j6.add(part("Gripper_Pinion", gear(0.014, 12, 0.01, 0.004, "y"), MACHINED, [0, -0.012, 0.1], { explode: [0, -0.08, 0.16] }));
  j6.add(part("Gripper_Rack_Left", box(0.05, 0.008, 0.012), MACHINED, [-0.032, -0.012, 0.086], { explode: [-0.09, -0.06, 0.16] }));
  j6.add(part("Gripper_Rack_Right", box(0.05, 0.008, 0.012), MACHINED, [0.032, -0.012, 0.114], { explode: [0.09, -0.06, 0.16] }));
  j6.add(part("Gripper_Guide_Rail", box(0.13, 0.01, 0.02), MACHINED, [0, -0.03, 0.1], { explode: [0, -0.12, 0.16] }));
  // Jaws pivot at their own origin: the geometry is pushed forward so a
  // rotation about the mesh's local Y swings the tip open.
  const jawLeft = part("Gripper_Finger_Left", box(0.025, 0.07, 0.1).translate(0, 0, 0.05), MACHINED, [-0.05, 0, 0.13], { explode: [-0.14, 0, 0.3] });
  const jawRight = part("Gripper_Finger_Right", box(0.025, 0.07, 0.1).translate(0, 0, 0.05), MACHINED, [0.05, 0, 0.13], { explode: [0.14, 0, 0.3] });
  j6.add(jawLeft, jawRight);

  return { root, joints: [j1, j2, j3, j4, j5, j6], jaws: [jawLeft, jawRight], rotors };
}

// --- motion: a looping pick-and-place cycle ----------------------------------

const CYCLE_SECONDS = 9.6;
const SAMPLE_HZ = 30;
const JAW_OPEN_DEG = 16;

// [time, j1, j2, j3, j4, j5, j6, grip(0 closed .. 1 open)] in degrees.
// The tool points straight down whenever j2 + j3 + j5 = 90.
const POSES = [
  [0.0, 0, 0, 10, 0, 40, 0, 1],
  [1.8, -55, 38, 28, 0, 24, 0, 1],
  [2.4, -55, 42, 30, 0, 18, 0, 1],
  [2.9, -55, 42, 30, 0, 18, 0, 0],
  [3.7, -55, 22, 24, 0, 44, 0, 0],
  [5.4, 55, 26, 18, 0, 46, 90, 0],
  [6.3, 55, 40, 32, 0, 18, 90, 0],
  [6.8, 55, 40, 32, 0, 18, 90, 1],
  [7.6, 55, 18, 20, 0, 52, 40, 1],
  [CYCLE_SECONDS, 0, 0, 10, 0, 40, 0, 1],
];

const smoothstep = (u) => u * u * (3 - 2 * u);

function poseAt(t) {
  let index = 0;
  while (index < POSES.length - 2 && t >= POSES[index + 1][0]) index += 1;
  const a = POSES[index];
  const b = POSES[index + 1];
  const u = smoothstep(Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))));
  return a.slice(1).map((value, i) => value + (b[i + 1] - value) * u);
}

function buildClip(joints, jaws, rotors) {
  const frames = Math.round(CYCLE_SECONDS * SAMPLE_HZ);
  const times = new Float32Array(frames + 1);
  const values = (n) => Array.from({ length: n }, () => new Float32Array((frames + 1) * 4));
  const jointValues = values(joints.length);
  const jawValues = values(jaws.length);
  const rotorValues = values(rotors.length);
  const quaternion = new THREE.Quaternion();
  for (let frame = 0; frame <= frames; frame += 1) {
    const t = (frame / frames) * CYCLE_SECONDS;
    times[frame] = t;
    const pose = poseAt(t);
    joints.forEach((node, i) => {
      quaternion.setFromAxisAngle(AXES[node.userData.joint.axis], THREE.MathUtils.degToRad(pose[i]));
      quaternion.toArray(jointValues[i], frame * 4);
    });
    const open = THREE.MathUtils.degToRad(JAW_OPEN_DEG * pose[6]);
    jaws.forEach((node, i) => {
      quaternion.setFromAxisAngle(AXES.y, i === 0 ? -open : open);
      quaternion.toArray(jawValues[i], frame * 4);
    });
    // Rotor assemblies spin at the reduction ratio of their joint (J1..J6
    // in order), so the motors visibly work whenever a joint moves.
    rotors.forEach((node, i) => {
      const { axis, ratio } = node.userData.spin;
      quaternion.setFromAxisAngle(AXES[axis], THREE.MathUtils.degToRad(pose[i] * ratio));
      quaternion.toArray(rotorValues[i], frame * 4);
    });
  }
  const track = (node, data) => new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, data);
  const tracks = [
    ...joints.map((node, i) => track(node, jointValues[i])),
    ...jaws.map((node, i) => track(node, jawValues[i])),
    ...rotors.map((node, i) => track(node, rotorValues[i])),
  ];
  return new THREE.AnimationClip("Pick_And_Place", CYCLE_SECONDS, tracks);
}

// --- export ---------------------------------------------------------------------

function applyExplode(root) {
  root.traverse((node) => {
    const offset = node.userData.explode;
    if (offset) node.position.add(new THREE.Vector3(...offset));
  });
}

async function exportGlb(view) {
  const { root, joints, jaws, rotors } = buildArm(`${MODEL}_${view}`);
  if (view === "Exploded") applyExplode(root);
  const clip = buildClip(joints, jaws, rotors);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, { binary: true, animations: [clip], trs: true });
  const file = `${MODEL}_${view}.glb`;
  await writeFile(path.join(OUT_DIR, file), Buffer.from(glb));
  const counts = { shell: 0, internal: 0, sensor: 0 };
  root.traverse((node) => {
    if (node.isMesh) counts[node.userData.layer] += 1;
  });
  return { view: view.toLowerCase(), file, parts: counts.shell + counts.internal + counts.sensor, layers: counts, tracks: clip.tracks.length, bytes: glb.byteLength };
}

await mkdir(OUT_DIR, { recursive: true });
const files = [];
for (const view of ["Assembled", "Exploded"]) files.push(await exportGlb(view));
await writeFile(
  path.join(OUT_DIR, "manifest.json"),
  `${JSON.stringify({ generated: new Date().toISOString(), models: [MODEL], animation: { clip: "Pick_And_Place", seconds: CYCLE_SECONDS }, files }, null, 2)}\n`,
);
for (const entry of files) {
  console.log(`${entry.file}: ${entry.parts} parts (${entry.layers.shell} shell, ${entry.layers.internal} internal, ${entry.layers.sensor} sensor), ${entry.tracks} tracks, ${(entry.bytes / 1024).toFixed(0)} KB`);
}
