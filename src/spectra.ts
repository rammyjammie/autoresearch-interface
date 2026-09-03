// Seeded frequency spectra per (sensor chip, part, modality).
//
// Everything here is deterministic — the same part and modality always
// produce the same histogram — so a rehearsed walkthrough never surprises
// anyone. The physics is suggestive, not measured: each part family gets
// the characteristic lines a vibration analyst would look for (rotor 1×/2×,
// gear-mesh with sidebands, bearing defect frequencies, line-frequency slot
// harmonics) laid over a 1/f floor, and each modality weights those lines
// the way its sensor would see them.

export type ModalityId = "accel-x" | "accel-y" | "accel-z" | "flux" | "audio";

export interface Modality {
  id: ModalityId;
  label: string;
  unit: string;
  rate: string;
  /** Histogram span in Hz. */
  fmax: number;
  /** Categorical hue (validated dark-surface palette, fixed order). */
  color: string;
}

export const MODALITIES: Modality[] = [
  { id: "accel-x", label: "Accel X", unit: "g", rate: "3.2 kHz", fmax: 1600, color: "#3987e5" },
  { id: "accel-y", label: "Accel Y", unit: "g", rate: "3.2 kHz", fmax: 1600, color: "#d95926" },
  { id: "accel-z", label: "Accel Z", unit: "g", rate: "3.2 kHz", fmax: 1600, color: "#199e70" },
  { id: "flux", label: "Magnetic flux", unit: "mT", rate: "1 kHz", fmax: 500, color: "#c98500" },
  { id: "audio", label: "Audio", unit: "dB", rate: "48 kHz", fmax: 8000, color: "#d55181" },
];

export const BINS = 48;

/**
 * What a model knows about itself (root `extras.signature`): rotor speed,
 * line frequency, and the counts that set slot-pass, bar-pass, blade-pass
 * and bearing lines. Anything missing falls back to a sensible default.
 */
export interface Signature {
  rotorHz?: number;
  lineHz?: number;
  statorSlots?: number;
  rotorBars?: number;
  fanBlades?: number;
  bearingBalls?: number;
}

export interface SpectrumPeak {
  hz: number;
  label: string;
}

export interface Spectrum {
  modality: Modality;
  /** Bin amplitudes in [0, 1]. */
  bins: number[];
  /** Characteristic lines the part family is known for (may be above fmax). */
  peaks: SpectrumPeak[];
  /** Relative RMS across the whole span, for the tile figure. */
  rms: number;
}

// Rotor speeds per joint servo in Hz (so 1× lines land at distinct places).
// Parts without a joint prefix belong to a line-fed machine: a four-pole
// induction motor at 1,770 rpm.
const ROTOR_HZ: Record<string, number> = { J1: 45, J2: 52, J3: 58, J4: 66, J5: 74, J6: 80 };
const LINE_HZ = 60;
const INDUCTION_ROTOR_HZ = 29.5;

interface Family {
  /** Which spectral lines this part radiates, with relative strengths. */
  lines: Array<{ hz: number; label: string; strength: number }>;
  /** Broadband resonance hump center (Hz) and width, if the part rings. */
  hump?: { hz: number; width: number; strength: number };
}

function rotorHzFor(part: string): number {
  const joint = part.match(/^J(\d)_/)?.[0].slice(0, 2);
  return joint ? ROTOR_HZ[joint] ?? 52 : INDUCTION_ROTOR_HZ;
}

/** The spectral signature of a part, keyed off its library name. */
function familyFor(part: string, signature: Signature): Family {
  const isJoint = /^J\d_/.test(part);
  const rotor = signature.rotorHz ?? rotorHzFor(part);
  const line = signature.lineHz ?? LINE_HZ;
  const slots = signature.statorSlots ?? 12;
  const bars = signature.rotorBars ?? 24;
  const blades = signature.fanBlades ?? 7;
  const balls = signature.bearingBalls ?? (isJoint ? 17 : 9);
  const name = part.toLowerCase();
  const lines: Family["lines"] = [];
  let hump: Family["hump"];

  if (/fan|hub/.test(name)) {
    lines.push({ hz: rotor * blades, label: "Blade pass", strength: 1 }, { hz: rotor, label: "1× rotor", strength: 0.5 }, { hz: rotor * blades * 2, label: "2× blade pass", strength: 0.35 });
    hump = { hz: 1100, width: 300, strength: 0.3 };
  } else if (/rotor_bars|end_ring/.test(name)) {
    // Cage faults: bar-pass in flux, plus the rotor lines. (Broken-bar
    // sidebands at twice slip sit inside the 1× bin at this resolution.)
    lines.push({ hz: rotor * bars, label: "Bar pass", strength: 1 }, { hz: rotor, label: "1× rotor", strength: 0.7 }, { hz: rotor * 2, label: "2× rotor", strength: 0.3 });
  } else if (/rotor|motor_shaft|wave_generator|shaft_key|coupling/.test(name)) {
    lines.push({ hz: rotor, label: "1× rotor", strength: 1 }, { hz: rotor * 2, label: "2× rotor", strength: /coupling/.test(name) ? 0.8 : 0.45 }, { hz: rotor * 3, label: "3×", strength: 0.2 });
  } else if (/stator|winding|coil|encoder_board|terminal/.test(name)) {
    lines.push({ hz: line * 2, label: "2× line", strength: 0.9 }, { hz: rotor * slots, label: "Slot pass", strength: 0.55 }, { hz: rotor * slots * 2, label: "2× slot", strength: 0.25 });
  } else if (/brake|encoder_disc/.test(name)) {
    lines.push({ hz: rotor, label: "1× rotor", strength: 0.6 }, { hz: rotor * 0.5, label: "½× rub", strength: 0.35 });
  } else if (/spline|flexspline|gear|pinion|rack/.test(name)) {
    const teeth = /circular|flexspline/.test(name) ? 50 : /pinion/.test(name) ? 14 : 30;
    const shaftHz = /flexspline|circular/.test(name) ? rotor / 30 : rotor / 4;
    const mesh = teeth * shaftHz * (/flexspline|circular/.test(name) ? 30 : 1);
    lines.push({ hz: mesh, label: "Gear mesh", strength: 1 }, { hz: mesh - shaftHz * 4, label: "Sideband", strength: 0.3 }, { hz: mesh + shaftHz * 4, label: "Sideband", strength: 0.3 }, { hz: mesh * 2, label: "2× mesh", strength: 0.4 });
  } else if (/bearing|race|rollers|balls/.test(name)) {
    // Robot joint bearings turn at output speed (after the reduction);
    // the motor's shaft bearings turn at rotor speed.
    const shaftHz = isJoint ? rotor / 30 : rotor;
    lines.push({ hz: shaftHz * balls * 0.4, label: "BPFO", strength: 0.8 }, { hz: shaftHz * balls * 0.6, label: "BPFI", strength: 0.55 }, { hz: shaftHz * balls * 0.8, label: "2× BPFO", strength: 0.3 });
    hump = { hz: 900, width: 260, strength: 0.35 };
  } else if (/shaft|flange/.test(name)) {
    lines.push({ hz: rotor / 30, label: "1× output", strength: 0.7 }, { hz: rotor, label: "1× rotor", strength: 0.35 });
  } else if (/harness|dress|cable/.test(name)) {
    hump = { hz: 40, width: 30, strength: 0.5 };
  } else if (/actuator|finger|rail/.test(name)) {
    lines.push({ hz: 12, label: "Stroke", strength: 0.6 }, { hz: 24, label: "2× stroke", strength: 0.3 });
    hump = { hz: 320, width: 120, strength: 0.3 };
  } else {
    // Shells, spars, ribs, frames, plates: structure rings at a resonance
    // and carries whatever the nearest drive puts into it.
    lines.push({ hz: rotor, label: "1× rotor", strength: 0.4 });
    hump = { hz: /shell|cover|cap|housing|bell|cowl|fins|lid|box/.test(name) ? 480 : 720, width: 180, strength: 0.7 };
  }
  return { lines, hump };
}

/** Per-modality weighting of the mechanical lines. */
function weight(modality: ModalityId, label: string, part: string): number {
  const axis = /_Rotation|_Roll|_Flange|^Shaft|End_Ring/.test(part) ? "z" : "x";
  switch (modality) {
    case "flux":
      return /line|slot|rotor|bar/i.test(label) ? 1.2 : 0.12;
    case "audio":
      return /mesh|sideband|slot/i.test(label) ? 1.1 : 0.45;
    case "accel-x":
      return axis === "x" ? 1 : 0.8;
    case "accel-y":
      return 0.85;
    case "accel-z":
      return axis === "z" ? 1 : 0.7;
    default:
      return 1;
  }
}

/** Deterministic hash → [0, 1). */
function hash01(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Histogram for one modality of the sensor covering `part`. `distance` (m)
 * from chip to part attenuates the mechanical lines, so the same fault
 * reads stronger from the chip that sits on it.
 */
export function spectrumFor(sensorId: string, part: string, modality: Modality, distance: number, signature: Signature = {}): Spectrum {
  const family = familyFor(part, signature);
  const attenuation = 1 / (1 + distance * 1.6);
  const bins: number[] = [];
  const width = modality.fmax / BINS;
  for (let i = 0; i < BINS; i += 1) {
    const lo = i * width;
    const hi = lo + width;
    const center = (lo + hi) / 2;
    // 1/f floor with seeded texture.
    const noise = hash01(`${sensorId}:${part}:${modality.id}:${i}`);
    let value = (0.06 + 0.1 / (1 + center / 120)) * (0.7 + noise * 0.6);
    for (const line of family.lines) {
      if (line.hz >= lo && line.hz < hi) value += line.strength * weight(modality.id, line.label, part) * attenuation;
      // Spread a little into neighbors so a line reads as a peak, not a spike.
      else if (Math.abs(line.hz - center) < width * 1.5) value += line.strength * weight(modality.id, line.label, part) * attenuation * 0.28;
    }
    if (family.hump && modality.id !== "flux") {
      const d = (center - family.hump.hz) / family.hump.width;
      value += family.hump.strength * Math.exp(-d * d) * (modality.id === "audio" ? 0.6 : 1) * attenuation;
    }
    bins.push(value);
  }
  const max = Math.max(...bins, 0.001);
  const normalized = bins.map((value) => Math.min(1, value / max));
  const rms = Math.sqrt(normalized.reduce((sum, value) => sum + value * value, 0) / BINS);
  const peaks = family.lines
    .filter((line) => line.hz < modality.fmax && weight(modality.id, line.label, part) > 0.3)
    .map((line) => ({ hz: line.hz, label: line.label }));
  return { modality, bins: normalized, peaks, rms };
}

export function formatHz(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)} kHz` : `${Math.round(hz)} Hz`;
}
