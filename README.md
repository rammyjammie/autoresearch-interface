# CAD animation loadout

Procedural machine models authored to the Nautilus model-library contract,
each shipped as an **assembled / exploded** GLB pair with an embedded
animation clip, an external **shell** layer that can be switched off, and
flat **sensor chips** whose seeded frequency spectra stack up when you click
a part. One viewer, one model picker, two models so far:

| Model | Parts | Clip | What's inside |
| --- | --- | --- | --- |
| **Six-axis robot arm** | 141 (120 internal, 18 shell, 3 chips) | `Pick_And_Place`, 9.6 s, 14 tracks | Servo stacks, harmonic drives, crossed-roller bearings, wrist drive shafts and bevel pinions, rack-and-pinion gripper; rotors spin at their reduction ratio |
| **Induction motor** | 34 (22 internal, 9 shell, 3 chips) | `Run`, 6 s, 1 track | Foot-mounted TEFC frame with fins, end bells, fan cowl and terminal box over a 36-slot stator with coils and end windings, a 28-bar cage rotor with end rings on a keyed shaft with a coupling half, two ball bearings, and a seven-blade fan. Only parts that carry a fault signature or the silhouette; no nameplate, lifting eye, or terminal block |

The motor's root carries `extras.signature` (rotor 29.5 Hz, line 60 Hz, 36
slots, 28 bars, 7 blades, 9 balls), so slot-pass, bar-pass, blade-pass and
bearing lines in the spectra are derived from the geometry's own counts.

Every motor part also carries `extras.note`: what it does, how it fails,
and what a sensor sees when it does. The viewer shows the note in the hover
tooltip, under the spectra header when a part is selected, and in the
**Research guide** section of the panel, which lists every noted part by
assembly. Models without notes simply hide the section.

### Where the motor's sensors sit, and why

- **Drive-end bearing housing, horizontal radial (3 o'clock).** Bearings
  are the leading failure mode and the drive end carries the load; on a
  foot-mounted machine the horizontal direction usually has the highest
  amplitude, so it is the primary accelerometer location.
- **Non-drive-end bearing housing, vertical radial (12 o'clock).** The
  second bearing, read in the orthogonal direction so misalignment and
  imbalance (1×, 2×) separate from bearing lines.
- **Frame mid-length beside the stator.** Stray-flux coil and winding
  temperature: the place to read line-frequency harmonics, slot-pass, and
  bar-pass without opening the machine.

A full survey would add an axial reading on the drive-end cap for thrust
and misalignment, and a current clamp at the terminal box for rotor-bar
sidebands; neither is a chip on the housing, so neither is a chip here.

- `public/models/<Model>_Assembled.glb` — drop-in for the Nautilus library
  (`public/models/library/`).
- `public/models/<Model>_Exploded.glb` — same hierarchy and animation,
  explode offsets baked into node positions.
- `public/models/manifest.json` — the loadout the viewer's picker reads.
- `scripts/lib/cad.mjs` — shared toolkit: materials, primitives (rings,
  gears, tori, tubes, radial arrays), part factory, sensor chips, export.
- `scripts/models/*.mjs` — one module per model; `scripts/build-models.mjs`
  runs them all.
- `src/spectra.ts` — the seeded spectrum synth behind the histograms.

## Run

```bash
npm install
npm run dev        # viewer at http://127.0.0.1:5173  (#induction-motor deep-links the motor)
npm run model      # regenerate every GLB pair + manifest
npm run build      # tsc + vite build → dist/
npm run test:e2e   # Playwright: both models — load, animate, explode, drop the shell, read spectra
```

Viewer controls: model picker in the top bar, **Assembled / Exploded**
(`E`), **Full model / Internals** (`I`), **Pause motion** (`Space`),
playback speed, **Reset view**. Click a part on the model or in the grouped
parts list to focus it and open its sensor spectra; click a chip to read the
internal part it sits over; `Esc` clears. Drag to orbit, wheel to zoom; the
camera never goes under the floor.

## Model contract

Mirrors `src/models/registry.ts` in machine-state-ui, extended with layers:

| Rule | How the models meet it |
| --- | --- |
| Meters, +Y up, origin at floor center | Arm base plate 0.72 m square, ~1.4 m reach; motor is an IEC 132-ish frame, shaft 0.19 m above the floor |
| Named parts | Library-style names: `J2_Stator_Core`, `Drive_End_Bearing_Outer_Race`, `Cooling_Fan` |
| `extras.layer` | `shell` (housings, covers, caps, bells, cowl, skins, terminal box), `internal` (mechanism and structure), `sensor` (chips). A parts view hides `shell` and nothing else |
| `extras.assembly` | Arm: `Base`, `J1` … `J6`, `Gripper`. Motor: `Frame`, `Stator`, `Drive_End`, `Non_Drive_End`, `Rotor`. The parts list groups on it |
| Joint empties | Arm: `J1_Base_Rotation` (Y) … `J6_Tool_Flange` (Z). Motor: none — fixed frame, spinning `Rotor_Assembly` |
| Sensor chips | 32 mm flat squares with `extras.sensor = { id, label, covers }`, parented to a node that survives the shell being hidden, never to a shell mesh |
| Authored PBR, kept verbatim | `CAD Light Gray`, `Machined Metal`, `Dark Metal` (the library's exact factors) plus `Copper Winding` |
| Animation | Rotation-only quaternion tracks, so explode offsets on node positions never fight the clip. Motor rotor turns a whole number of times per loop, so the repeat is seamless |
| Explode | Every movable node carries `extras.explode: [x, y, z]` (offset from its parent, parent frame). The viewer tweens the assembled file 0 → 1; the exploded file bakes the offsets. Arm internals fan along their axis with shells lifted sideways; motor drive-end parts go +X, non-drive-end −X, skin and terminal box +Y |

Registering a model in Nautilus is one row in `CAD_LIBRARY_MACHINES`:

```ts
["six-axis-robot-arm", "Six_Axis_Robot_Arm", "Six-axis robot arm"],
["induction-motor-detailed", "Induction_Motor", "Induction motor (detailed)"],
```

The Nautilus `GltfModel` does not yet play glTF animations or read
`extras.layer`; an `AnimationMixer` on its prepared clone and a visibility
pass on the `shell` layer are the two additions needed there. Note that
three's GLTFLoader strips `:` from node names, so `mount:` empties arrive
as `mountfront`; these models carry chip labels in extras instead.

## Adding a model

1. Create `scripts/models/<name>.mjs` exporting `{ id, file, label,
   description, build(rootName) → { root, … }, clip(built) → AnimationClip }`
   on top of `scripts/lib/cad.mjs`.
2. Tag every mesh with a layer and an assembly, keep chips off the shell,
   give movable nodes an `explode` offset, keep tracks rotation-only.
3. Add it to `MODELS` in `scripts/build-models.mjs`, run `npm run model`.
4. If its parts introduce a new family (fan, rack, …), teach
   `src/spectra.ts` what lines it radiates, and add its assembly names to
   `ASSEMBLY_LABELS` in `src/main.ts`.

## Sensor spectra

Everything is seeded and deterministic (see `src/spectra.ts`): a 1/f floor
with characteristic lines by part family — rotor 1×/2×/3×, 2× line and slot
harmonics for stators and windings, gear-mesh with sidebands for splines and
pinions, blade-pass for fans, BPFO/BPFI for bearings (at output speed on the
arm's reduced joints, at rotor speed on the motor's shaft bearings), a
structural resonance hump for shells and spars — attenuated by the chip's
distance from the part and weighted per modality (flux favors electrical
lines, audio favors mesh). Five modalities stack as small multiples: Accel
X/Y/Z (3.2 kHz), Magnetic flux (1 kHz), Audio (48 kHz). Toggle any off and
the rest re-stack.

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
