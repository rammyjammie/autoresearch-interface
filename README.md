# Six-axis robot arm — CAD animation

A six-axis industrial robot arm authored to the Nautilus model-library
contract, modeled down to its mechanism: servo stacks, harmonic drives,
crossed-roller bearings, drive shafts, bevel pinions, a rack-and-pinion
gripper. The viewer shows it **assembled** or **exploded**, with the external
shell **on** or **off**, and the same pick-and-place cycle keeps articulating
every joint (and spinning every rotor) in all four combinations. Three flat
sensor chips sit on the base, shoulder, and elbow housings; click any part
and the nearest chip's frequency histograms stack up, one per modality.

- `public/models/Six_Axis_Robot_Arm_Assembled.glb` — drop-in for the
  Nautilus model library (`public/models/library/`).
- `public/models/Six_Axis_Robot_Arm_Exploded.glb` — the matching exploded
  variant, same hierarchy and animation, offsets baked into node positions.
- `scripts/build-robot-arm.mjs` — the generator. The model is procedural, so
  every dimension, material, layer tag, offset, and pose lives in one file.
- `src/spectra.ts` — the seeded spectrum synth behind the histograms.

## Run

```bash
npm install
npm run dev        # viewer at http://127.0.0.1:5173
npm run model      # regenerate the GLB pair + manifest
npm run build      # tsc + vite build → dist/
npm run test:e2e   # Playwright: loads, animates, explodes, drops the shell, reads spectra
```

Viewer controls: **Assembled / Exploded** (`E`), **Full model / Internals**
(`I`), **Pause motion** (`Space`), playback speed, **Reset view**. Click a
part on the model or in the grouped parts list to focus it and open its
sensor spectra; click a chip to read the internal part it sits over; `Esc`
clears. Drag to orbit, wheel to zoom; the camera never goes under the floor.

## Model contract

Mirrors `src/models/registry.ts` in machine-state-ui, extended with layers:

| Rule | This model |
| --- | --- |
| Meters, +Y up, origin at floor center | Base plate is 0.72 m square; the arm reaches about 1.4 m |
| Named parts | 141 meshes: 120 internal, 18 shell, 3 sensor chips |
| `extras.layer` | `shell` (housings, covers, caps, arm skins), `internal` (mechanism), `sensor` (chips). A parts view hides `shell` and nothing else |
| `extras.assembly` | `Base`, `J1` … `J6`, `Gripper` — the parts list groups on it |
| Joint empties | `J1_Base_Rotation` (Y), `J2_Shoulder` (X), `J3_Elbow` (X), `J4_Wrist_Roll` (Z), `J5_Wrist_Pitch` (X), `J6_Tool_Flange` (Z) |
| Sensor chips | `Sensor_Chip_Base`, `_Shoulder`, `_Elbow`: 32 mm flat squares with `extras.sensor = { id, label, covers }`. Parented to the joint node that carries their housing, never to the shell mesh, so switching the shell off leaves them in place |
| Authored PBR, kept verbatim | `CAD Light Gray`, `Machined Metal`, `Dark Metal` (the library's exact factors) plus `Copper Winding` |
| Animation | One clip, `Pick_And_Place`, 9.6 s loop, 14 quaternion tracks: six joints, two gripper jaws, six rotor assemblies spinning at their reduction ratio. Rotation only, so explode offsets on node positions never fight the clip |
| Explode | Every movable node carries `extras.explode: [x, y, z]` (offset from its parent, parent frame). Internals fan out along their axis; shells lift sideways off the mechanism. The viewer tweens the assembled file 0 → 1; the exploded file bakes the offsets |

Per joint the mechanism is: stator core + front/rear copper windings +
encoder board (static), a rotor assembly (rotor, motor shaft, brake disc,
encoder disc, wave generator) that spins, then flexspline cup + gear,
internal-tooth circular spline, and a three-piece crossed-roller output
bearing, with the output flange on the moving link. J5 and J6 servos sit in
the forearm and reach the wrist through parallel shafts and bevel pinions.

Registering it in Nautilus is one row in `CAD_LIBRARY_MACHINES`:

```ts
["six-axis-robot-arm", "Six_Axis_Robot_Arm", "Six-axis robot arm"],
```

The Nautilus `GltfModel` does not yet play glTF animations or read
`extras.layer`; an `AnimationMixer` on its prepared clone and a
visibility pass on the `shell` layer are the two additions needed there.
Note that three's GLTFLoader strips `:` from node names, so `mount:` empties
arrive as `mountfront`; this model carries its chip labels in extras instead.

## Sensor spectra

Everything is seeded and deterministic (see `src/spectra.ts`): a 1/f floor
with characteristic lines by part family — rotor 1×/2×/3×, 2× line and slot
harmonics for stators and windings, gear-mesh with sidebands for splines and
pinions, BPFO/BPFI for bearings, a structural resonance hump for shells and
spars — attenuated by the chip's distance from the part and weighted per
modality (flux favors electrical lines, audio favors mesh). Five modalities
stack as small multiples: Accel X/Y/Z (3.2 kHz), Magnetic flux (1 kHz),
Audio (48 kHz). Toggle any of them off and the rest re-stack.

The histograms follow the dataviz spec: ≤ 24 px bars with a 4 px rounded
data-end and a 2 px surface gap, hairline gridlines, one direct label on
the strongest characteristic line, a per-bar hover tooltip, and a table
view. The five modality hues are the validated dark-surface categorical
palette (`#3987e5 #d95926 #199e70 #c98500 #d55181`), fixed order, never
cycled; text stays in text tokens.

## Design language

Same as the Nautilus demo stage: `#02060c` scene background on a `#04080f`
substrate, `#2bd9c7` teal feature edges at a 28° crease threshold, authored
PBR kept, Inter + IBM Plex Mono (self-hosted in `public/fonts/`, OFL), square
corners, thin `#172438` borders. Key light `#d9e8e5` from (4, 6, 5), teal
fill from (-3, 2, -4), broad ambient, soft contact shadow on a navy slab.
