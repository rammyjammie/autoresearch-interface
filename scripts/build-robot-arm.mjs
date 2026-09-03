// Six-axis robot arm — procedural CAD model generator.
//
// Builds the arm as a named kinematic hierarchy with three.js primitives and
// exports it twice through GLTFExporter, following the Nautilus model-library
// authoring contract:
//
// - Units are meters, +Y up, origin at the machine's floor center.
// - Every component is a named mesh (`Shoulder_Motor`, `Forearm`, ...) and
//   every joint is a named empty (`J1_Base_Rotation` ... `J6_Tool_Flange`).
// - `mount:<label>` empties mark octopus sensor attachment points on the
//   static base so markers never drift off a moving link.
// - Materials are the library's authored PBR set ("CAD Light Gray",
//   "Machined Metal", "Dark Metal") — viewers keep them verbatim.
// - One looping animation clip ("Pick_And_Place", 9.6 s) drives the six
//   joints and the gripper jaws with rotation tracks only, so the exploded
//   file (and a live explode tween) can move node positions freely while the
//   same clip keeps articulating the links. The explode budget goes mostly
//   into the vertical joints (J1-J3) and stays short along the forearm, so
//   the exploded wrist chain clears the floor even when the arm reaches down.
// - Each movable node carries `extras.explode: [x, y, z]` — its offset from
//   its parent, in the parent's frame, in the exploded view. The exploded
//   file bakes those offsets into node positions; the assembled file keeps
//   them as extras so a viewer can tween between the two states.
//
// Run: `npm run model` → public/models/Six_Axis_Robot_Arm_{Assembled,Exploded}.glb

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

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

// --- geometry helpers --------------------------------------------------------

const SEGMENTS = 48;

function box(w, h, d) {
  return new THREE.BoxGeometry(w, h, d);
}

/** Cylinder along `axis` ("x" | "y" | "z"). */
function cyl(radius, height, axis = "y") {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, SEGMENTS);
  if (axis === "x") geometry.rotateZ(Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  return geometry;
}

/** Bent cable dress pack along a spline. */
function tube(points, radius) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  return new THREE.TubeGeometry(curve, 32, radius, 16, false);
}

function part(name, geometry, material, position, explode = [0, 0, 0]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.userData.explode = explode;
  return mesh;
}

function joint(name, position, axis, explode) {
  const node = new THREE.Group();
  node.name = name;
  node.position.set(...position);
  node.userData.explode = explode;
  node.userData.joint = { axis };
  return node;
}

function mount(label, position) {
  const node = new THREE.Object3D();
  node.name = `mount:${label}`;
  node.position.set(...position);
  // GLTFLoader strips ":" from node names on import (PropertyBinding
  // sanitization), so the label also rides along as extras.
  node.userData.mount = label;
  return node;
}

// --- the arm --------------------------------------------------------------------

/**
 * Builds the hierarchy. Returns the root plus the joint nodes the animation
 * binds to, in J1..J6 order, and the two gripper jaws.
 */
function buildArm(rootName) {
  const root = new THREE.Group();
  root.name = rootName;

  // Static base: floor plate, pedestal, anchor bolts, rear connector panel.
  const base = new THREE.Group();
  base.name = "Robot_Base";
  root.add(base);
  base.add(part("Base_Plate", box(0.72, 0.05, 0.72), MACHINED, [0, 0.025, 0]));
  base.add(part("Base_Pedestal", cyl(0.27, 0.3), LIGHT_GRAY, [0, 0.2, 0], [0, 0.18, 0]));
  for (const [tag, x, z] of [["FL", -0.3, 0.3], ["FR", 0.3, 0.3], ["RL", -0.3, -0.3], ["RR", 0.3, -0.3]]) {
    base.add(part(`Anchor_Bolt_${tag}`, cyl(0.022, 0.05), DARK, [x, 0.075, z], [0, 0.16, 0]));
  }
  base.add(part("Base_Connector_Panel", box(0.22, 0.14, 0.05), DARK, [0, 0.19, -0.285], [0, 0.05, -0.25]));
  // Octopus mounts stay on the pedestal: real bearing/gear monitoring
  // points, and static so markers never fly off a moving link.
  base.add(mount("front", [0, 0.2, 0.29]));
  base.add(mount("rear", [0.19, 0.2, -0.19]));
  base.add(mount("top", [-0.27, 0.3, 0]));

  // J1: base rotation about +Y.
  const j1 = joint("J1_Base_Rotation", [0, 0.35, 0], "y", [0, 0.45, 0]);
  root.add(j1);
  j1.add(part("Turntable", cyl(0.25, 0.16), LIGHT_GRAY, [0, 0.08, 0]));
  j1.add(part("J1_Drive_Motor", cyl(0.065, 0.2), DARK, [-0.16, 0.26, -0.2], [0, 0, -0.28]));
  j1.add(part("J1_Drive_Motor_Cap", cyl(0.065, 0.015), MACHINED, [-0.16, 0.3675, -0.2], [0, 0.12, -0.28]));
  j1.add(part("Shoulder_Bracket", box(0.3, 0.3, 0.26), LIGHT_GRAY, [0, 0.31, 0], [0, 0.22, 0]));

  // J2: shoulder pitch about +X (positive leans the upper arm toward +Z).
  const j2 = joint("J2_Shoulder", [0, 0.46, 0], "x", [0, 0.6, 0]);
  j1.add(j2);
  j2.add(part("Shoulder_Hub", cyl(0.13, 0.3, "x"), LIGHT_GRAY, [0, 0, 0]));
  j2.add(part("Shoulder_Motor", cyl(0.11, 0.2, "x"), DARK, [0.25, 0, 0], [0.32, 0, 0]));
  j2.add(part("Shoulder_Motor_Cap", cyl(0.11, 0.02, "x"), MACHINED, [0.36, 0, 0], [0.46, 0, 0]));
  j2.add(part("Upper_Arm", box(0.18, 0.62, 0.2), LIGHT_GRAY, [0, 0.31, 0]));
  j2.add(part(
    "Cable_Dress",
    tube([[-0.14, 0.02, -0.08], [-0.2, 0.25, -0.12], [-0.16, 0.5, -0.04], [-0.13, 0.62, 0.05]], 0.02),
    DARK,
    [0, 0, 0],
    [-0.25, 0, 0],
  ));

  // J3: elbow pitch about +X (positive tips the forearm down).
  const j3 = joint("J3_Elbow", [0, 0.62, 0], "x", [0, 0.9, 0]);
  j2.add(j3);
  j3.add(part("Elbow_Housing", cyl(0.12, 0.26, "x"), LIGHT_GRAY, [0, 0, 0]));
  j3.add(part("Elbow_Motor", cyl(0.085, 0.16, "x"), DARK, [-0.21, 0, 0], [-0.3, 0, 0]));
  j3.add(part("Elbow_Motor_Cap", cyl(0.085, 0.02, "x"), MACHINED, [-0.3, 0, 0], [-0.42, 0, 0]));
  j3.add(part("Forearm", box(0.16, 0.16, 0.56), LIGHT_GRAY, [0, 0, 0.34], [0, 0, 0.15]));

  // J4: wrist roll about the forearm axis (+Z).
  const j4 = joint("J4_Wrist_Roll", [0, 0, 0.62], "z", [0, 0, 0.3]);
  j3.add(j4);
  j4.add(part("Wrist_Housing", cyl(0.085, 0.16, "z"), LIGHT_GRAY, [0, 0, 0.08]));
  j4.add(part("J4_Motor", cyl(0.045, 0.09, "z"), DARK, [0, 0.115, 0.07], [0, 0.25, 0]));

  // J5: wrist pitch about +X.
  const j5 = joint("J5_Wrist_Pitch", [0, 0, 0.16], "x", [0, 0, 0.25]);
  j4.add(j5);
  j5.add(part("Wrist_Pitch_Housing", box(0.16, 0.13, 0.14), LIGHT_GRAY, [0, 0, 0.07]));
  j5.add(part("J5_Motor", cyl(0.05, 0.07, "x"), DARK, [0.115, 0, 0.07], [0.25, 0, 0]));

  // J6: tool flange roll about +Z, carrying a two-jaw gripper.
  const j6 = joint("J6_Tool_Flange", [0, 0, 0.14], "z", [0, 0, 0.2]);
  j5.add(j6);
  j6.add(part("Tool_Flange", cyl(0.06, 0.03, "z"), MACHINED, [0, 0, 0.015]));
  j6.add(part("Gripper_Body", box(0.15, 0.09, 0.1), DARK, [0, 0, 0.08], [0, 0, 0.15]));
  // Jaws pivot at their own origin: the geometry is pushed forward so a
  // rotation about the mesh's local Y swings the tip open.
  const jawLeft = part("Gripper_Finger_Left", box(0.025, 0.07, 0.1).translate(0, 0, 0.05), MACHINED, [-0.05, 0, 0.13], [-0.14, 0, 0.28]);
  const jawRight = part("Gripper_Finger_Right", box(0.025, 0.07, 0.1).translate(0, 0, 0.05), MACHINED, [0.05, 0, 0.13], [0.14, 0, 0.28]);
  j6.add(jawLeft, jawRight);

  return { root, joints: [j1, j2, j3, j4, j5, j6], jaws: [jawLeft, jawRight] };
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

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };

function buildClip(joints, jaws) {
  const frames = Math.round(CYCLE_SECONDS * SAMPLE_HZ);
  const times = new Float32Array(frames + 1);
  const jointValues = joints.map(() => new Float32Array((frames + 1) * 4));
  const jawValues = jaws.map(() => new Float32Array((frames + 1) * 4));
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
  }
  const tracks = [
    ...joints.map((node, i) => new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, jointValues[i])),
    ...jaws.map((node, i) => new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`, times, jawValues[i])),
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
  const { root, joints, jaws } = buildArm(`${MODEL}_${view}`);
  if (view === "Exploded") applyExplode(root);
  const clip = buildClip(joints, jaws);
  const exporter = new GLTFExporter();
  const glb = await exporter.parseAsync(root, { binary: true, animations: [clip], trs: true });
  const file = `${MODEL}_${view}.glb`;
  await writeFile(path.join(OUT_DIR, file), Buffer.from(glb));
  let parts = 0;
  root.traverse((node) => {
    if (node.isMesh) parts += 1;
  });
  return { view: view.toLowerCase(), file, parts, bytes: glb.byteLength };
}

await mkdir(OUT_DIR, { recursive: true });
const files = [];
for (const view of ["Assembled", "Exploded"]) files.push(await exportGlb(view));
await writeFile(
  path.join(OUT_DIR, "manifest.json"),
  `${JSON.stringify({ generated: new Date().toISOString(), models: [MODEL], animation: { clip: "Pick_And_Place", seconds: CYCLE_SECONDS }, files }, null, 2)}\n`,
);
for (const entry of files) console.log(`${entry.file}: ${entry.parts} parts, ${(entry.bytes / 1024).toFixed(1)} KB`);
