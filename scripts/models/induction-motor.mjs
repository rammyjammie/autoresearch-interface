// Foot-mounted TEFC induction motor — a research-grade simple interior.
//
// Shaft along +X (drive end at +X, fan at −X), frame on the floor at the
// origin. Only parts that carry a fault signature or the silhouette make
// the cut: a slotted stator core with coils and end windings, a cage rotor
// with visible bars and end rings, a keyed shaft with a coupling half, a
// ball bearing at each end, the fan, and the skin (finned frame, end
// bells, cowl + grille, terminal box). No nameplate, no lifting eye, no
// terminal block: they carry no signal.
//
// The root carries `extras.signature` — rotor speed, line frequency, and
// the slot / bar / blade / ball counts — so the viewer's spectra derive
// slot-pass, bar-pass, blade-pass and bearing lines from this geometry
// instead of typed-in numbers.
//
// Sensor chips sit where a vibration analyst mounts accelerometers and a
// stray-flux coil: on the drive-end bearing housing (horizontal radial,
// 3 o'clock — usually the highest-amplitude direction on a foot-mounted
// machine), on the non-drive-end bearing housing (vertical radial, 12
// o'clock), and on the frame mid-length beside the stator for stray flux
// and winding temperature.
//
// Explode fans the drive-end parts +X, the non-drive-end parts −X, and
// lifts the skin and terminal box +Y off the mechanism. The clip spins the
// rotor assembly at a display speed.

import * as THREE from "three";
import { box, COPPER, cyl, DARK, group, LIGHT_GRAY, MACHINED, part as basePart, radialArray, ring, sensorChip, slottedRing, spinTrack, torus } from "../lib/cad.mjs";

const CYCLE_SECONDS = 6;
const DISPLAY_REV_PER_SECOND = 1;

// Electrical/mechanical signature (four-pole, 60 Hz, ~1,770 rpm).
const SIGNATURE = { rotorHz: 29.5, lineHz: 60, statorSlots: 36, rotorBars: 28, fanBlades: 7, bearingBalls: 9 };

const part = (assembly) => (name, geometry, material, position, opts = {}) =>
  basePart(name, geometry, material, position, { assembly, ...opts });
const shell = (assembly) => (name, geometry, position, explode, material = LIGHT_GRAY) =>
  basePart(name, geometry, material, position, { assembly, layer: "shell", explode });

// Frame geometry (meters): IEC 132-ish.
const R_FRAME = 0.135;
const L_FRAME = 0.34;
const R_SHAFT = 0.019;
const R_BORE = 0.076; // stator bore
const R_ROTOR = 0.066; // rotor core; bars reach 0.0725, air gap 3.5 mm
const Y_AXIS = 0.19; // shaft height above the floor

function build(rootName) {
  const root = new THREE.Group();
  root.name = rootName;
  root.userData.signature = SIGNATURE;

  // ---- Frame: feet, finned housing, terminal box.
  const frame = group("Motor_Frame", [0, 0, 0]);
  root.add(frame);
  const F = part("Frame");
  const FS = shell("Frame");
  frame.add(F("Mounting_Foot_Front", box(0.36, 0.03, 0.06), MACHINED, [0, 0.015, 0.11], { explode: [0, -0.16, 0.12] }));
  frame.add(F("Mounting_Foot_Rear", box(0.36, 0.03, 0.06), MACHINED, [0, 0.015, -0.11], { explode: [0, -0.16, -0.12] }));
  frame.add(F("Foot_Bridge", box(0.3, 0.05, 0.2), LIGHT_GRAY, [0, 0.05, 0], { explode: [0, -0.1, 0] }));
  frame.add(FS("Frame_Housing", ring(R_FRAME, R_FRAME - 0.012, L_FRAME, "x"), [0, Y_AXIS, 0], [0, 0.42, 0]));
  // Cooling fins: 28 radial blades welded into one mesh.
  const fin = box(L_FRAME - 0.04, 0.03, 0.006).translate(0, R_FRAME + 0.012, 0);
  frame.add(FS("Frame_Fins", radialArray(fin, 28, "x", Math.PI / 28), [0, Y_AXIS, 0], [0, 0.42, 0]));
  frame.add(FS("Terminal_Box", box(0.12, 0.08, 0.13), [0.02, Y_AXIS + R_FRAME + 0.052, 0], [0, 0.72, 0]));
  frame.add(FS("Terminal_Box_Lid", box(0.126, 0.012, 0.136), [0.02, Y_AXIS + R_FRAME + 0.098, 0], [0, 0.9, 0], MACHINED));

  // ---- Stator: slotted core, one coil side per slot, copper end windings.
  const S = part("Stator");
  const coreLength = L_FRAME - 0.12;
  frame.add(S("Stator_Core", slottedRing(R_FRAME - 0.014, R_BORE, SIGNATURE.statorSlots, 0.02, 0.45, coreLength, "x"), DARK, [0, Y_AXIS, 0], { explode: [0, 0, 0] }));
  const coil = box(coreLength + 0.012, 0.015, 0.005).translate(0, R_BORE + 0.011, 0);
  frame.add(S("Stator_Coils", radialArray(coil, SIGNATURE.statorSlots, "x"), COPPER, [0, Y_AXIS, 0], { explode: [0, 0, 0] }));
  frame.add(S("Winding_Drive_End", torus(0.088, 0.02, "x"), COPPER, [coreLength / 2 + 0.014, Y_AXIS, 0], { explode: [0.1, 0, 0] }));
  frame.add(S("Winding_Non_Drive_End", torus(0.088, 0.02, "x"), COPPER, [-coreLength / 2 - 0.014, Y_AXIS, 0], { explode: [-0.1, 0, 0] }));

  // ---- Drive end (+X): bearing, end bell, bearing cap.
  const D = part("Drive_End");
  const DS = shell("Drive_End");
  const xDE = L_FRAME / 2;
  frame.add(D("Drive_End_Bearing_Inner_Race", ring(0.03, R_SHAFT + 0.001, 0.02, "x"), MACHINED, [xDE - 0.02, Y_AXIS, 0], { explode: [0.22, 0, 0] }));
  frame.add(D("Drive_End_Bearing_Balls", torus(0.036, 0.0065, "x", 8, 24), MACHINED, [xDE - 0.02, Y_AXIS, 0], { explode: [0.3, 0, 0] }));
  frame.add(D("Drive_End_Bearing_Outer_Race", ring(0.048, 0.042, 0.02, "x"), MACHINED, [xDE - 0.02, Y_AXIS, 0], { explode: [0.38, 0, 0] }));
  frame.add(DS("Drive_End_Bell", ring(R_FRAME, 0.05, 0.03, "x"), [xDE + 0.015, Y_AXIS, 0], [0.55, 0, 0]));
  frame.add(DS("Drive_End_Bearing_Cap", ring(0.05, R_SHAFT + 0.004, 0.012, "x"), [xDE + 0.036, Y_AXIS, 0], [0.7, 0, 0], MACHINED));

  // ---- Non-drive end (−X): bearing, end bell, fan cowl + grille.
  const N = part("Non_Drive_End");
  const NS = shell("Non_Drive_End");
  const xNDE = -L_FRAME / 2;
  frame.add(N("Non_Drive_End_Bearing_Inner_Race", ring(0.028, R_SHAFT + 0.001, 0.018, "x"), MACHINED, [xNDE + 0.02, Y_AXIS, 0], { explode: [-0.22, 0, 0] }));
  frame.add(N("Non_Drive_End_Bearing_Balls", torus(0.033, 0.006, "x", 8, 24), MACHINED, [xNDE + 0.02, Y_AXIS, 0], { explode: [-0.3, 0, 0] }));
  frame.add(N("Non_Drive_End_Bearing_Outer_Race", ring(0.044, 0.038, 0.018, "x"), MACHINED, [xNDE + 0.02, Y_AXIS, 0], { explode: [-0.38, 0, 0] }));
  frame.add(NS("Non_Drive_End_Bell", ring(R_FRAME, 0.046, 0.03, "x"), [xNDE - 0.015, Y_AXIS, 0], [-0.55, 0, 0]));
  frame.add(NS("Fan_Cowl", ring(R_FRAME + 0.008, R_FRAME - 0.004, 0.1, "x"), [xNDE - 0.08, Y_AXIS, 0], [-0.95, 0, 0]));
  const grilleBar = box(0.004, 0.11, 0.004).translate(0, 0.07, 0);
  frame.add(NS("Fan_Cowl_Grille", radialArray(grilleBar, 16, "x"), [xNDE - 0.128, Y_AXIS, 0], [-1.15, 0, 0], MACHINED));

  // ---- Rotor assembly: spins as one node.
  const R = part("Rotor");
  const rotor = group("Rotor_Assembly", [0, Y_AXIS, 0]);
  rotor.userData.spin = { axis: "x" };
  frame.add(rotor);
  const rotorLength = L_FRAME - 0.14;
  rotor.add(R("Shaft", cyl(R_SHAFT, L_FRAME + 0.34, "x"), MACHINED, [0.06, 0, 0], { explode: [0, 0, 0] }));
  rotor.add(R("Shaft_Key", box(0.05, 0.006, 0.006), MACHINED, [xDE + 0.1, R_SHAFT, 0], { explode: [0.1, 0.05, 0] }));
  rotor.add(R("Coupling_Half", cyl(0.045, 0.05, "x"), MACHINED, [xDE + 0.19, 0, 0], { explode: [0.3, 0, 0] }));
  rotor.add(R("Rotor_Core", cyl(R_ROTOR, rotorLength, "x"), DARK, [0, 0, 0], { explode: [0, 0, 0] }));
  const bar = box(rotorLength + 0.004, 0.007, 0.006).translate(0, R_ROTOR + 0.003, 0);
  rotor.add(R("Rotor_Bars", radialArray(bar, SIGNATURE.rotorBars, "x"), COPPER, [0, 0, 0], { explode: [0, 0, 0] }));
  rotor.add(R("Rotor_End_Ring_Drive_End", torus(0.06, 0.012, "x"), COPPER, [rotorLength / 2 + 0.01, 0, 0], { explode: [0.06, 0, 0] }));
  rotor.add(R("Rotor_End_Ring_Non_Drive_End", torus(0.06, 0.012, "x"), COPPER, [-rotorLength / 2 - 0.01, 0, 0], { explode: [-0.06, 0, 0] }));
  const blade = box(0.02, 0.075, 0.006).translate(0, 0.065, 0).rotateY(0.45);
  rotor.add(R("Cooling_Fan", radialArray(blade, SIGNATURE.fanBlades, "x"), LIGHT_GRAY, [xNDE - 0.075, 0, 0], { explode: [-0.72, 0, 0] }));
  rotor.add(R("Fan_Hub", cyl(0.03, 0.022, "x"), DARK, [xNDE - 0.075, 0, 0], { explode: [-0.72, 0, 0] }));

  // ---- Sensor chips (see header).
  frame.add(sensorChip("drive-end", "Drive_End", [xDE + 0.015, Y_AXIS, R_FRAME + 0.002], [0, 0, 1], ["Drive_End", "Rotor"], "Drive_End"));
  frame.add(sensorChip("non-drive-end", "Non_Drive_End", [xNDE - 0.015, Y_AXIS + R_FRAME + 0.002, 0], [0, 1, 0], ["Non_Drive_End", "Rotor"], "Non_Drive_End"));
  frame.add(sensorChip("frame", "Frame", [0.09, Y_AXIS + 0.03, R_FRAME + 0.045], [0, 0, 1], ["Frame", "Stator"], "Frame"));

  return { root, rotor };
}

function clip({ rotor }) {
  // Constant display speed with a whole number of turns per loop, so the
  // repeat is seamless.
  const track = spinTrack(rotor, "x", (t) => t * DISPLAY_REV_PER_SECOND * 360, CYCLE_SECONDS, 24);
  return new THREE.AnimationClip("Run", CYCLE_SECONDS, [track]);
}

export const inductionMotor = {
  id: "induction-motor",
  file: "Induction_Motor",
  label: "Induction motor",
  description: "Foot-mounted TEFC induction motor: finned frame, end bells, fan cowl and terminal box over a 36-slot stator with coils, a 28-bar cage rotor on a keyed shaft with coupling half, two ball bearings, and a seven-blade fan.",
  build,
  clip,
};
