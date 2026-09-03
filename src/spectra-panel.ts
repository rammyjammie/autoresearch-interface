import { BINS, formatHz, MODALITIES, spectrumFor, type Modality, type ModalityId, type Signature, type Spectrum } from "./spectra";
import type { PartInfo } from "./viewer";

// The stacked-histogram panel: one small-multiple per enabled modality,
// same x-scale family (0 → that modality's span), one series each — the
// heading names the series, so no legend box. Marks follow the dataviz
// spec: ≤ 24px bars with a 4px rounded data-end, a 2px surface gap between
// neighbors, hairline gridlines, one direct label on the strongest
// characteristic line, a per-bar hover tooltip, and a table view.

const WIDTH = 296;
const PLOT_HEIGHT = 72;
const MARGIN = { top: 14, right: 6, bottom: 18, left: 30 };
const SVG_NS = "http://www.w3.org/2000/svg";

const enabled = new Set<ModalityId>(MODALITIES.map((modality) => modality.id));

export function enabledModalities(): ModalityId[] {
  return MODALITIES.filter((modality) => enabled.has(modality.id)).map((modality) => modality.id);
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Rounded-top bar path: 4px radius at the data end, square at the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const bottom = y + h;
  return `M${x},${bottom} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${bottom} Z`;
}

function histogram(spectrum: Spectrum, tooltip: HTMLElement, host: HTMLElement): SVGSVGElement {
  const { modality, bins, peaks } = spectrum;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const slot = plotWidth / BINS;
  const barWidth = Math.min(24, slot - 2);
  const height = PLOT_HEIGHT + MARGIN.top + MARGIN.bottom;
  const chart = svg("svg", { viewBox: `0 0 ${WIDTH} ${height}`, width: "100%", role: "img", "aria-label": `${modality.label} spectrum, ${BINS} bins to ${formatHz(modality.fmax)}` });
  chart.classList.add("spectrum-svg");

  // Gridlines: hairline, recessive, at 0.5 and 1.0.
  for (const level of [0.5, 1]) {
    const y = MARGIN.top + PLOT_HEIGHT * (1 - level);
    chart.append(svg("line", { x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: y, y2: y, class: "grid" }));
    chart.append(Object.assign(svg("text", { x: MARGIN.left - 6, y: y + 3, class: "tick", "text-anchor": "end" }), { textContent: level === 1 ? "1.0" : "0.5" }));
  }
  const baseline = MARGIN.top + PLOT_HEIGHT;
  chart.append(svg("line", { x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: baseline, y2: baseline, class: "axis" }));

  // Bars with a per-bar hover target wider than the mark.
  let strongest = { index: -1, value: -1 };
  bins.forEach((value, index) => {
    const x = MARGIN.left + index * slot + (slot - barWidth) / 2;
    const h = Math.max(1, value * PLOT_HEIGHT);
    const y = baseline - h;
    chart.append(svg("path", { d: barPath(x, y, barWidth, h), fill: modality.color, class: "bar" }));
    const hit = svg("rect", { x: MARGIN.left + index * slot, y: MARGIN.top, width: slot, height: PLOT_HEIGHT, fill: "transparent", class: "hit" });
    const lo = index * (modality.fmax / BINS);
    const place = (event: PointerEvent) => {
      const rect = host.getBoundingClientRect();
      tooltip.style.left = `${event.clientX - rect.left}px`;
      tooltip.style.top = `${event.clientY - rect.top}px`;
    };
    hit.addEventListener("pointerenter", (event) => {
      tooltip.replaceChildren(el("span", undefined, `${formatHz(lo)} – ${formatHz(lo + modality.fmax / BINS)}`), el("small", undefined, `${modality.label} · ${value.toFixed(2)} rel.`));
      place(event);
      tooltip.hidden = false;
    });
    hit.addEventListener("pointermove", place);
    hit.addEventListener("pointerleave", () => {
      tooltip.hidden = true;
    });
    chart.append(hit);
    if (value > strongest.value) strongest = { index, value };
  });

  // One direct label: the strongest bin, named after the characteristic
  // line it carries when one lands there.
  if (strongest.index >= 0) {
    const binWidth = modality.fmax / BINS;
    const line = peaks.find((peak) => Math.abs(peak.hz - (strongest.index + 0.5) * binWidth) <= binWidth);
    const label = line ? `${line.label} · ${formatHz(line.hz)}` : formatHz((strongest.index + 0.5) * binWidth);
    const x = MARGIN.left + strongest.index * slot + slot / 2;
    const anchor = x > WIDTH * 0.7 ? "end" : x < WIDTH * 0.3 ? "start" : "middle";
    chart.append(Object.assign(svg("text", { x, y: MARGIN.top - 4, class: "label", "text-anchor": anchor }), { textContent: label }));
  }

  // X ticks: 0, mid, span.
  for (const fraction of [0, 0.5, 1]) {
    const x = MARGIN.left + plotWidth * fraction;
    chart.append(Object.assign(svg("text", { x, y: height - 4, class: "tick", "text-anchor": fraction === 0 ? "start" : fraction === 1 ? "end" : "middle" }), { textContent: formatHz(modality.fmax * fraction) }));
  }
  return chart;
}

function modalityToggles(onChange: () => void): HTMLElement {
  const row = el("div", "modality-toggles");
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", "Stacked modalities");
  for (const modality of MODALITIES) {
    const button = el("button");
    button.type = "button";
    button.dataset.modality = modality.id;
    button.setAttribute("aria-pressed", String(enabled.has(modality.id)));
    const swatch = el("i", "swatch");
    swatch.style.background = modality.color;
    button.append(swatch, el("span", undefined, modality.label));
    button.addEventListener("click", () => {
      if (enabled.has(modality.id)) enabled.delete(modality.id);
      else enabled.add(modality.id);
      button.setAttribute("aria-pressed", String(enabled.has(modality.id)));
      onChange();
    });
    row.append(button);
  }
  return row;
}

function table(spectra: Spectrum[]): HTMLElement {
  const details = el("details", "spectrum-table");
  details.append(el("summary", undefined, "Table view"));
  const wrap = el("div", "table-scroll");
  const grid = el("table");
  const head = el("tr");
  head.append(el("th", undefined, "Bin"));
  for (const spectrum of spectra) head.append(el("th", undefined, spectrum.modality.label));
  grid.append(head);
  for (let i = 0; i < BINS; i += 1) {
    const row = el("tr");
    row.append(el("td", undefined, String(i + 1)));
    for (const spectrum of spectra) row.append(el("td", undefined, spectrum.bins[i].toFixed(2)));
    grid.append(row);
  }
  wrap.append(grid);
  details.append(wrap);
  return details;
}

/**
 * Render the spectra for `part` into `container`. `subject` is the part
 * whose signature is synthesized (the clicked part, or the internal part a
 * clicked chip sits over).
 */
export function renderSpectra(container: HTMLElement, tooltip: HTMLElement, host: HTMLElement, part: PartInfo, subject: PartInfo, signature: Signature = {}): void {
  const sensor = subject.sensor;
  container.replaceChildren();
  if (!sensor) {
    container.append(el("p", "spectra-empty", "No sensor chip covers this part."));
    return;
  }
  const header = el("header", "spectra-header");
  header.append(el("strong", undefined, part.label));
  const meta = el("span", undefined);
  meta.textContent = part.layer === "sensor"
    ? `Chip on ${sensor.label} · reading ${subject.label.toLowerCase()} at ${subject.sensorDistance.toFixed(2)} m`
    : `${part.assembly.replace(/_/g, " ")} · ${part.material} · chip: ${sensor.label} at ${subject.sensorDistance.toFixed(2)} m`;
  header.append(meta);
  if (part.note) header.append(el("p", "spectra-note", part.note));
  container.append(header);

  const spectra = new Map<ModalityId, Spectrum>();
  const stack = el("div", "spectrum-stack");
  const draw = () => {
    stack.replaceChildren();
    const active: Spectrum[] = [];
    for (const modality of MODALITIES) {
      if (!enabled.has(modality.id)) continue;
      const spectrum = spectra.get(modality.id) ?? spectrumFor(sensor.id, subject.name, modality, subject.sensorDistance, signature);
      spectra.set(modality.id, spectrum);
      active.push(spectrum);
      stack.append(figure(spectrum, tooltip, host));
    }
    if (!active.length) stack.append(el("p", "spectra-empty", "Every modality is switched off. Turn one on to stack it."));
    else stack.append(table(active));
  };
  container.append(modalityToggles(draw), stack);
  draw();
}

function figure(spectrum: Spectrum, tooltip: HTMLElement, host: HTMLElement): HTMLElement {
  const { modality } = spectrum;
  const figure = el("figure", "spectrum");
  figure.dataset.modality = modality.id;
  const caption = el("figcaption");
  const swatch = el("i", "swatch");
  swatch.style.background = modality.color;
  caption.append(swatch, el("span", undefined, modality.label), el("small", undefined, `${modality.rate} · ${modality.unit} · rel. RMS ${spectrum.rms.toFixed(2)}`));
  figure.append(caption, histogram(spectrum, tooltip, host));
  return figure;
}

export function modalityById(id: ModalityId): Modality {
  return MODALITIES.find((modality) => modality.id === id)!;
}
