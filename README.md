# Six-axis robot arm — CAD animation

A six-axis industrial robot arm authored to the Nautilus model-library
contract, with a viewer that shows it **assembled** or **exploded** while the
same pick-and-place cycle keeps articulating every joint in both states.

- `public/models/Six_Axis_Robot_Arm_Assembled.glb` — drop-in for the
  Nautilus model library (`public/models/library/`).
- `public/models/Six_Axis_Robot_Arm_Exploded.glb` — the matching exploded
  variant, same hierarchy and animation, offsets baked into node positions.
- `scripts/build-robot-arm.mjs` — the generator. The model is procedural, so
  every dimension, material, offset, and pose lives in one file.

## Run

```bash
npm install
npm run dev        # viewer at http://127.0.0.1:5173
npm run model      # regenerate the GLB pair + manifest
npm run build      # tsc + vite build → dist/
npm run test:e2e   # Playwright: loads, animates, explodes, pauses, focuses
```

Viewer controls: **Assembled / Exploded** toggle (or press `E`), **Pause
motion** (or `Space`), playback speed, **Reset view**, click a part on the
model or in the list to focus it (`Esc` clears). Drag to orbit, wheel to
zoom; the camera never goes under the floor.

## Model contract

Mirrors `src/models/registry.ts` in machine-state-ui:

| Rule | This model |
| --- | --- |
| Meters, +Y up, origin at floor center | Base plate is 0.72 m square; the arm reaches about 1.4 m |
| Named parts | 28 meshes (`Shoulder_Motor`, `Forearm`, `Gripper_Finger_Left`, ...) |
| Joint empties | `J1_Base_Rotation` (Y), `J2_Shoulder` (X), `J3_Elbow` (X), `J4_Wrist_Roll` (Z), `J5_Wrist_Pitch` (X), `J6_Tool_Flange` (Z) |
| `mount:<label>` empties | `mount:front`, `mount:rear`, `mount:top` on the static pedestal, so octopus markers never drift off a moving link |
| Authored PBR, kept verbatim | `CAD Light Gray`, `Machined Metal`, `Dark Metal` — the library's exact factors |
| Animation | One clip, `Pick_And_Place`, 9.6 s loop, 8 quaternion tracks (six joints + two gripper jaws). Rotation only, so explode offsets on node positions never fight the clip |
| Explode | Every movable node carries `extras.explode: [x, y, z]` (offset from its parent, parent frame). The viewer tweens the assembled file between 0 and 1; the exploded file bakes the offsets |

Registering it in Nautilus is one row in `CAD_LIBRARY_MACHINES`:

```ts
["six-axis-robot-arm", "Six_Axis_Robot_Arm", "Six-axis robot arm"],
```

The Nautilus `GltfModel` does not yet play glTF animations; wiring an
`AnimationMixer` onto its prepared clone (clips bind by node name, which the
clone preserves) is the only change needed for the arm to move there.

## Design language

Same as the Nautilus demo stage: `#02060c` scene background on a `#04080f`
substrate, `#2bd9c7` teal feature edges at a 28° crease threshold, authored
PBR kept, Inter + IBM Plex Mono (self-hosted in `public/fonts/`, OFL), square
corners, thin `#172438` borders. Key light `#d9e8e5` from (4, 6, 5), teal
fill from (-3, 2, -4), broad ambient, soft contact shadow on a navy slab.
