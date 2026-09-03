import "./styles.css";
import { RobotArmViewer, humanize, type PartInfo, type ViewMode } from "./viewer";

const MODEL_URL = "/models/Six_Axis_Robot_Arm_Assembled.glb";

const host = document.getElementById("canvas-host")!;
const status = document.getElementById("status")!;
const tooltip = document.getElementById("tooltip")!;
const partsList = document.getElementById("parts")!;
const partCount = document.getElementById("part-count")!;
const motionButton = document.getElementById("motion") as HTMLButtonElement;
const resetButton = document.getElementById("reset-view") as HTMLButtonElement;
const viewButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-view]")];
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-speed]")];

const viewer = new RobotArmViewer(host);

function setStatus(text: string, error = false): void {
  status.textContent = text;
  status.parentElement?.classList.toggle("is-error", error);
}

function setView(view: ViewMode): void {
  viewer.setView(view);
  for (const button of viewButtons) button.setAttribute("aria-pressed", String(button.dataset.view === view));
  setStatus(`${view === "exploded" ? "Exploded" : "Assembled"} view · ${viewer.playing ? "motion running" : "motion paused"}`);
}

function setPlaying(playing: boolean): void {
  viewer.setPlaying(playing);
  motionButton.setAttribute("aria-pressed", String(playing));
  motionButton.textContent = playing ? "Pause motion" : "Play motion";
  setStatus(`${viewer.view === "exploded" ? "Exploded" : "Assembled"} view · ${playing ? "motion running" : "motion paused"}`);
}

for (const button of viewButtons) button.addEventListener("click", () => setView(button.dataset.view as ViewMode));
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
  if (event.key === " ") {
    event.preventDefault();
    setPlaying(!viewer.playing);
  }
  if (event.key === "Escape") viewer.focus(null);
});

function renderParts(parts: PartInfo[]): void {
  partsList.replaceChildren(
    ...parts.map((part) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.part = part.name;
      button.setAttribute("aria-pressed", "false");
      const label = document.createElement("span");
      label.textContent = part.label;
      const material = document.createElement("small");
      material.textContent = part.material.replace(/^CAD /, "");
      button.append(label, material);
      button.addEventListener("click", () => viewer.focus(viewer.focusedPart?.name === part.name ? null : part));
      item.append(button);
      return item;
    }),
  );
  partCount.textContent = `· ${parts.length}`;
}

viewer.onSelect = (part) => {
  for (const button of partsList.querySelectorAll<HTMLButtonElement>("button[data-part]")) {
    button.setAttribute("aria-pressed", String(button.dataset.part === part?.name));
  }
};

viewer.onHover = (part, clientX, clientY) => {
  for (const button of partsList.querySelectorAll<HTMLButtonElement>("button[data-part]")) {
    button.classList.toggle("is-hovered", Boolean(part && "name" in part && button.dataset.part === part.name));
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
  name.textContent = "material" in part ? part.label : humanize(part.label);
  const kind = document.createElement("small");
  kind.textContent = "material" in part ? part.material : "Octopus mount";
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
    document.getElementById("fact-mounts")!.textContent = viewer.mounts.map((mount) => `mount:${mount.label}`).join(" · ");
    document.getElementById("fact-materials")!.textContent = [...new Set(viewer.parts.map((part) => part.material))].join(" · ");
    setStatus("Assembled view · motion running");
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
      readonly parts: string[];
      readonly mounts: string[];
      readonly clip: string | null;
      setView(view: ViewMode): void;
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
  get parts() {
    return viewer.parts.map((part) => part.name);
  },
  get mounts() {
    return viewer.mounts.map((mount) => mount.label);
  },
  get clip() {
    return viewer.clip?.name ?? null;
  },
  setView,
};
