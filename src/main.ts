import "./styles.css";
import { enabledModalities, renderSpectra } from "./spectra-panel";
import { RobotArmViewer, type LayerMode, type PartInfo, type ViewMode } from "./viewer";

const MODEL_URL = "/models/Six_Axis_Robot_Arm_Assembled.glb";

const host = document.getElementById("canvas-host")!;
const status = document.getElementById("status")!;
const tooltip = document.getElementById("tooltip")!;
const partsList = document.getElementById("parts")!;
const partCount = document.getElementById("part-count")!;
const spectraSection = document.getElementById("spectra-section")!;
const spectraHost = document.getElementById("spectra")!;
const motionButton = document.getElementById("motion") as HTMLButtonElement;
const resetButton = document.getElementById("reset-view") as HTMLButtonElement;
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-view]")];
const layerButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-layers]")];
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-speed]")];

const viewer = new RobotArmViewer(host);

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.parentElement?.classList.toggle("is-error", error);
}

function describe(): string {
  return `${viewer.view === "exploded" ? "Exploded" : "Assembled"} · ${viewer.layers === "internals" ? "internals only" : "full model"} · ${viewer.playing ? "motion running" : "motion paused"}`;
}

function setView(view: ViewMode): void {
  viewer.setView(view);
  for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.view === view));
  setStatus(describe());
}

function setLayers(layers: LayerMode): void {
  viewer.setLayers(layers);
  for (const button of layerButtons) button.setAttribute("aria-pressed", String(button.dataset.layers === layers));
  document.body.classList.toggle("is-internals", layers === "internals");
  setStatus(describe());
}

function setPlaying(playing: boolean): void {
  viewer.setPlaying(playing);
  motionButton.setAttribute("aria-pressed", String(playing));
  motionButton.textContent = playing ? "Pause motion" : "Play motion";
  setStatus(describe());
}

for (const button of viewButtons) button.addEventListener("click", () => setView(button.dataset.view as ViewMode));
for (const button of layerButtons) button.addEventListener("click", () => setLayers(button.dataset.layers as LayerMode));
motionButton.addEventListener("click", () => setPlaying(!viewer.playing));
resetButton.addEventListener("click", () => viewer.resetView());
for (const button of speedButtons) {
  button.addEventListener("click", () => {
    viewer.setSpeed(Number(button.dataset.speed));
    for (const other of speedButtons) other.setAttribute("aria-pressed", String(other === button));
  });
}

document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "e" || event.key === "E") setView(viewer.view === "exploded" ? "assembled" : "exploded");
  if (event.key === "i" || event.key === "I") setLayers(viewer.layers === "internals" ? "full" : "internals");
  if (event.key === " ") {
    event.preventDefault();
    setPlaying(!viewer.playing);
  }
  if (event.key === "Escape") viewer.focus(null);
});

const ASSEMBLY_LABELS: Record<string, string> = {
  Base: "Base",
  J1: "J1 · base rotation",
  J2: "J2 · shoulder",
  J3: "J3 · elbow",
  J4: "J4 · wrist roll",
  J5: "J5 · wrist pitch",
  J6: "J6 · tool flange",
  Gripper: "Gripper",
};

function renderParts(parts: PartInfo[]): void {
  const groups = new Map<string, PartInfo[]>();
  for (const part of parts) {
    const list = groups.get(part.assembly) ?? [];
    list.push(part);
    groups.set(part.assembly, list);
  }
  partsList.replaceChildren(
    ...[...groups.entries()].map(([assembly, members]) => {
      const item = document.createElement("li");
      const details = document.createElement("details");
      details.open = assembly === "J2";
      const summary = document.createElement("summary");
      summary.textContent = ASSEMBLY_LABELS[assembly] ?? assembly;
      const count = document.createElement("small");
      count.textContent = `${members.length}`;
      summary.append(count);
      const list = document.createElement("ol");
      list.className = "part-group";
      for (const part of members) {
        const row = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.part = part.name;
        button.dataset.layer = part.layer;
        button.setAttribute("aria-pressed", "false");
        const label = document.createElement("span");
        label.textContent = part.label;
        const tag = document.createElement("small");
        tag.textContent = part.layer === "sensor" ? "sensor" : part.layer === "shell" ? "shell" : part.material.replace(/^CAD /, "");
        button.append(label, tag);
        button.addEventListener("click", () => viewer.focus(viewer.focusedPart?.name === part.name ? null : part));
        row.append(button);
        list.append(row);
      }
      details.append(summary, list);
      item.append(details);
      return item;
    }),
  );
  const shells = parts.filter((part) => part.layer === "shell").length;
  const sensors = parts.filter((part) => part.layer === "sensor").length;
  partCount.textContent = `· ${parts.length} (${parts.length - shells - sensors} internal, ${shells} shell, ${sensors} sensor)`;
}

viewer.onSelect = (part) => {
  for (const button of partsList.querySelectorAll<HTMLButtonElement>("button[data-part]")) {
    const selected = button.dataset.part === part?.name;
    button.setAttribute("aria-pressed", String(selected));
    if (selected) {
      const details = button.closest("details");
      if (details) details.open = true;
      button.scrollIntoView({ block: "nearest" });
    }
  }
  if (!part) {
    spectraSection.hidden = true;
    spectraHost.replaceChildren();
    return;
  }
  // A chip reads the internal part it sits over; any other part reads the
  // chip nearest to it.
  const subject = part.layer === "sensor" && part.sensor ? viewer.nearestInternal(part.sensor) ?? part : part;
  spectraSection.hidden = false;
  renderSpectra(spectraHost, tooltip, host, part, subject);
  spectraSection.scrollIntoView({ block: "start", behavior: "smooth" });
};

viewer.onHover = (part, clientX, clientY) => {
  for (const button of partsList.querySelectorAll<HTMLButtonElement>("button[data-part]")) {
    button.classList.toggle("is-hovered", Boolean(part && button.dataset.part === part.name));
  }
  if (!part) {
    tooltip.hidden = true;
    return;
  }
  if (clientX >= 0) {
    const rect = host.getBoundingClientRect();
    tooltip.style.left = `${clientX - rect.left}px`;
    tooltip.style.top = `${clientY - rect.top}px`;
  }
  tooltip.replaceChildren();
  const name = document.createElement("span");
  name.textContent = part.label;
  const kind = document.createElement("small");
  kind.textContent = part.layer === "sensor"
    ? `Sensor chip · covers ${part.sensor?.covers.join(", ") ?? "—"}`
    : `${part.assembly} · ${part.layer} · ${part.material}${part.sensor ? ` · chip ${part.sensor.label} ${part.sensorDistance.toFixed(2)} m` : ""}`;
  tooltip.append(name, kind);
  tooltip.hidden = false;
};

viewer
  .load(MODEL_URL)
  .then((gltf) => {
    renderParts(viewer.parts);
    const joints: string[] = [];
    gltf.scene.traverse((node) => {
      if (node.userData.joint) joints.push(`${node.name.split("_")[0]} ${node.userData.joint.axis.toUpperCase()}`);
    });
    document.getElementById("fact-clip")!.textContent = viewer.clip?.name.replace(/_/g, " ") ?? "none";
    document.getElementById("fact-cycle")!.textContent = viewer.clip ? `${viewer.clip.duration.toFixed(1)} s loop · ${viewer.clip.tracks.length} tracks` : "—";
    document.getElementById("fact-joints")!.textContent = `${joints.length} · ${joints.join(", ")}`;
    document.getElementById("fact-sensors")!.textContent = viewer.sensors.map((sensor) => `${sensor.label} → ${sensor.covers.join("/")}`).join(" · ");
    document.getElementById("fact-materials")!.textContent = [...new Set(viewer.parts.map((part) => part.material))].join(" · ");
    setStatus(describe());
  })
  .catch((error: unknown) => {
    console.error(error);
    setStatus(`Model failed to load: ${String(error)}`, true);
  });

// Test hook: Playwright reads the viewer's state through this.
declare global {
  interface Window {
    __robotArm?: {
      readonly explode: number;
      readonly time: number;
      readonly playing: boolean;
      readonly view: ViewMode;
      readonly layers: LayerMode;
      readonly parts: Array<{ name: string; layer: string; visible: boolean; sensor: string | null }>;
      readonly sensors: string[];
      readonly clip: string | null;
      readonly focused: string | null;
      readonly modalities: string[];
      setView(view: ViewMode): void;
      setLayers(layers: LayerMode): void;
    };
  }
}

window.__robotArm = {
  get explode() {
    return viewer.explode;
  },
  get time() {
    return viewer.time;
  },
  get playing() {
    return viewer.playing;
  },
  get view() {
    return viewer.view;
  },
  get layers() {
    return viewer.layers;
  },
  get parts() {
    return viewer.parts.map((part) => ({ name: part.name, layer: part.layer, visible: part.mesh.visible, sensor: part.sensor?.label ?? null }));
  },
  get sensors() {
    return viewer.sensors.map((sensor) => sensor.label);
  },
  get clip() {
    return viewer.clip?.name ?? null;
  },
  get focused() {
    return viewer.focusedPart?.name ?? null;
  },
  get modalities() {
    return enabledModalities();
  },
  setView,
  setLayers,
};
