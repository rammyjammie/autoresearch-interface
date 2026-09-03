// Builds every model in the loadout and writes public/models/manifest.json,
// which the viewer's model picker reads.
//
// Run: `npm run model`

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exportPair } from "./lib/cad.mjs";
import { inductionMotor } from "./models/induction-motor.mjs";
import { robotArm } from "./models/robot-arm.mjs";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public/models");
const MODELS = [robotArm, inductionMotor];

await mkdir(OUT_DIR, { recursive: true });
const entries = [];
for (const model of MODELS) entries.push(await exportPair(model, OUT_DIR));
await writeFile(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify({ generated: new Date().toISOString(), models: entries }, null, 2)}\n`);
for (const entry of entries) {
  console.log(
    `${entry.label}: ${entry.parts} parts (${entry.layers.shell} shell, ${entry.layers.internal} internal, ${entry.layers.sensor} sensor), `
    + `${entry.clip.tracks} tracks over ${entry.clip.seconds}s, `
    + `${(entry.files.assembled.bytes / 1024).toFixed(0)} KB assembled / ${(entry.files.exploded.bytes / 1024).toFixed(0)} KB exploded`,
  );
}
