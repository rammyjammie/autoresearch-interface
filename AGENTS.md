# autoresearch-interface — Agent Instructions

## What this repo is

A standalone Vite + three.js viewer for a loadout of procedurally generated
machine models (a six-axis robot arm, an induction motor), authored to the
Nautilus (`innova-harmonics/machine-state-ui`) model-library contract. It
exists to prove a CAD-animation pipeline: each GLB is shown assembled or
exploded, with the external shell on or off, and its embedded clip keeps
running in every combination. Sensor chips on the housings open stacked,
seeded frequency spectra for whichever part is clicked.

## Rules

- **The models are code.** Change `scripts/models/<model>.mjs` (on the
  shared toolkit in `scripts/lib/cad.mjs`) and run `npm run model`; never
  hand-edit or replace the GLBs with opaque exports. Commit the regenerated
  GLBs and `manifest.json` together with the script. New models follow the
  "Adding a model" steps in the README.
- **Simple interiors are fine; nameable parts are required.** The motor is
  deliberately a couple of dozen parts. Model what a technician would name
  and what a sensor would hear (bearings, windings, rotor, fan) and stop.
- **Keep the authoring contract.** Meters, +Y up, floor-center origin,
  named parts, `J<n>_` joint empties, `extras.layer` on every mesh
  (`shell` / `internal` / `sensor`), `extras.assembly`, chips parented to
  joints (never to a shell mesh), the library's PBR materials, rotation-only
  animation tracks, `extras.explode` on movable nodes. The README table is
  the spec.
- **Shell means skin.** Only housings, covers, caps, and arm skins are
  `shell`. Structure that a mechanic would still see with the covers off
  (plates, spars, frames, ribs) is `internal`.
- **Spectra are seeded.** `src/spectra.ts` is deterministic by design; do
  not introduce randomness or wire it to a backend. There is no backend and
  no auth in this repo; Playwright asserts nothing else is fetched.
- **Charts follow the dataviz skill.** Modality hues are the validated
  dark-surface categorical palette in fixed order; re-run the validator if
  you change them. Text never wears a series color.
- **No customer artifacts.** Nothing photo-matched to a real machine and no
  real site names — this is a generic library model.
- **Design language** follows the Nautilus demo stage (tokens in
  `src/styles.css`, treatment in `src/treatment.ts`). Port token changes by
  hand when upstream evolves.

## Verification

`npx tsc -p tsconfig.json`, `npm run build`, and `npm run test:e2e` must
pass. Playwright starts the dev server itself and writes screenshots to
`test-results/` (not committed). If the pinned Playwright wants a newer
Chromium than is installed, point `PW_CHROMIUM_PATH` at an installed
`chrome.exe` under `%LOCALAPPDATA%\ms-playwright`. Browser-pane screenshots
are unreliable on the maintainer's laptop; trust the Playwright run.
