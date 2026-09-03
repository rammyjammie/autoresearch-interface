# autoresearch-interface — Agent Instructions

## What this repo is

A standalone Vite + three.js viewer for a procedurally generated six-axis
robot arm, authored to the Nautilus (`innova-harmonics/machine-state-ui`)
model-library contract. It exists to prove a CAD-animation pipeline: the
same GLB is shown assembled and exploded, and the embedded joint clip keeps
running in both states.

## Rules

- **The model is code.** Change `scripts/build-robot-arm.mjs` and run
  `npm run model`; never hand-edit or replace the GLBs with opaque exports.
  Commit the regenerated GLBs and `manifest.json` together with the script.
- **Keep the authoring contract.** Meters, +Y up, floor-center origin,
  named parts, `J<n>_` joint empties, `mount:<label>` empties on static
  geometry, the library's three PBR materials, rotation-only animation
  tracks, `extras.explode` on movable nodes. The README table is the spec.
- **No customer artifacts.** Nothing photo-matched to a real machine and no
  real site names — this is a generic library model.
- **No backend, no auth.** Static assets only; Playwright asserts nothing
  else is fetched.
- **Design language** follows the Nautilus demo stage (tokens in
  `src/styles.css`, treatment in `src/treatment.ts`). Port token changes by
  hand when upstream evolves.

## Verification

`npx tsc -p tsconfig.json`, `npm run build`, and `npm run test:e2e` must
pass. Playwright starts the dev server itself and writes screenshots to
`test-results/` (not committed). Browser-pane screenshots are unreliable on
the maintainer's laptop; trust the Playwright run.
