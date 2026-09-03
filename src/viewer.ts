import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { applyReefTreatment, emphasize, type TreatedPart } from "./treatment";

// The Nautilus machine check-in stage, distilled: the model floats above a
// dark slab with a soft contact shadow, lit by a warm key, a teal fill, and
// a broad ambient so authored PBR reads on the navy substrate. Camera is
// rotation-first, clamped near the machine, never under the floor.

export type ViewMode = "assembled" | "exploded";
export type LayerMode = "full" | "internals";
export type Layer = "shell" | "internal" | "sensor";

export interface PartInfo {
  name: string;
  label: string;
  material: string;
  layer: Layer;
  assembly: string;
  mesh: THREE.Mesh;
  /** Nearest sensor chip (rest pose) and its distance in meters. */
  sensor: SensorInfo | null;
  sensorDistance: number;
}

export interface SensorInfo {
  id: string;
  label: string;
  covers: string[];
  mesh: THREE.Mesh;
}

interface ExplodeTarget {
  node: THREE.Object3D;
  rest: THREE.Vector3;
  offset: THREE.Vector3;
}

const BACKGROUND = "#02060c";
const FLOOR_Y = -0.42;
const EXPLODE_SECONDS = 1.1;
const EDGE = new THREE.Color("#2bd9c7");

const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export function humanize(name: string): string {
  return name.replace(/^Sensor_Chip_/, "Sensor chip · ").replace(/_/g, " ");
}

export class RobotArmViewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly clock = new THREE.Clock();

  parts: PartInfo[] = [];
  sensors: SensorInfo[] = [];
  clip: THREE.AnimationClip | null = null;

  private treated: TreatedPart[] = [];
  private byMesh = new Map<THREE.Mesh, PartInfo>();
  private mixer: THREE.AnimationMixer | null = null;
  private root: THREE.Group | null = null;
  private explodeTargets: ExplodeTarget[] = [];
  private explodeValue = 0;
  private explodeGoal = 0;
  private radii: Record<ViewMode, number> = { assembled: 1.6, exploded: 2.4 };
  private centers: Record<ViewMode, THREE.Vector3> = { assembled: new THREE.Vector3(0, 0.7, 0), exploded: new THREE.Vector3(0, 1.2, 0) };
  private frameGoal: { center: THREE.Vector3; distance: number } | null = null;
  private focused: THREE.Mesh | null = null;
  private hovered: THREE.Mesh | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2(2, 2);
  private pointerInside = false;

  playing = true;
  speed = 1;
  view: ViewMode = "assembled";
  layers: LayerMode = "full";

  onHover: ((part: PartInfo | null, clientX: number, clientY: number) => void) | null = null;
  onSelect: ((part: PartInfo | null) => void) | null = null;

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(BACKGROUND);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
    this.camera.position.set(4.5, 3.2, 4.8);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.maxPolarAngle = Math.PI * 0.5;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // Lights: same rig as the Nautilus scene, plus shadows from the key.
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight("#d9e8e5", 0.9 * Math.PI);
    key.position.set(4, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.radius = 6;
    key.shadow.bias = -0.0004;
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 30;
    Object.assign(key.shadow.camera, { left: -4, right: 4, top: 6, bottom: -2 });
    this.scene.add(key);
    const fill = new THREE.DirectionalLight("#2bd9c7", 0.35 * Math.PI);
    fill.position.set(-3, 2, -4);
    this.scene.add(fill);
    this.scene.add(new THREE.HemisphereLight("#8fb3c8", "#0a1522", 0.45));

    // Slab + contact shadow: navy concrete, soft shadow, no grid. The slab
    // runs out past the fog so it has no visible horizon.
    const slab = new THREE.Mesh(
      new THREE.CircleGeometry(60, 96),
      new THREE.MeshStandardMaterial({ color: "#050a12", metalness: 0.4, roughness: 0.9 }),
    );
    slab.rotation.x = -Math.PI / 2;
    slab.position.y = FLOOR_Y - 0.01;
    this.scene.add(slab);
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.55 }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = FLOOR_Y;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);
    this.scene.fog = new THREE.Fog(BACKGROUND, 12, 30);

    this.resize();
    window.addEventListener("resize", () => this.resize());
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", (event) => this.trackPointer(event));
    canvas.addEventListener("pointerleave", () => {
      this.pointerInside = false;
      this.setHovered(null, 0, 0);
    });
    canvas.addEventListener("click", (event) => this.pick(event));
    this.renderer.setAnimationLoop(() => this.tick());
  }

  async load(url: string): Promise<GLTF> {
    const gltf = await new GLTFLoader().loadAsync(url);
    this.setModel(gltf);
    return gltf;
  }

  private setModel(gltf: GLTF): void {
    if (this.root) this.scene.remove(this.root);
    this.mixer?.stopAllAction();

    const root = gltf.scene as THREE.Group;
    this.root = root;
    this.treated = applyReefTreatment(root);

    // Sensor chips first, so parts can be matched to their nearest chip.
    this.sensors = [];
    for (const { mesh } of this.treated) {
      const sensor = mesh.userData.sensor as { id: string; label: string; covers: string[] } | undefined;
      if (sensor) this.sensors.push({ ...sensor, mesh });
    }

    this.explodeTargets = [];
    root.traverse((node) => {
      const offset = node.userData.explode as number[] | undefined;
      if (Array.isArray(offset) && offset.length === 3) {
        this.explodeTargets.push({ node, rest: node.position.clone(), offset: new THREE.Vector3(...offset) });
      }
    });

    // Re-ground to the contract (origin at floor center) and frame both
    // views before anything moves.
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root);
    root.position.x -= (bounds.min.x + bounds.max.x) / 2;
    root.position.z -= (bounds.min.z + bounds.max.z) / 2;
    root.position.y -= bounds.min.y;
    this.scene.add(root);
    this.measure("assembled", 0);
    this.measure("exploded", 1);
    this.applyExplode(this.explodeValue);
    root.updateMatrixWorld(true);

    // Part records, each paired with the chip nearest to it in the rest pose.
    const chipPositions = this.sensors.map((sensor) => ({ sensor, position: sensor.mesh.getWorldPosition(new THREE.Vector3()) }));
    const center = new THREE.Vector3();
    this.parts = this.treated.map(({ mesh, material }) => {
      new THREE.Box3().setFromObject(mesh).getCenter(center);
      let nearest: SensorInfo | null = null;
      let distance = Infinity;
      for (const chip of chipPositions) {
        const d = chip.position.distanceTo(center);
        if (d < distance) {
          distance = d;
          nearest = chip.sensor;
        }
      }
      return {
        name: mesh.name,
        label: humanize(mesh.name),
        material: material.name,
        layer: ((mesh.userData.layer as Layer | undefined) ?? "internal"),
        assembly: (mesh.userData.assembly as string | undefined) ?? "Arm",
        mesh,
        sensor: nearest,
        sensorDistance: Number.isFinite(distance) ? distance : 0,
      };
    });
    this.byMesh = new Map(this.parts.map((part) => [part.mesh, part]));
    this.setLayers(this.layers);

    this.clip = gltf.animations[0] ?? null;
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.play();
    }
    this.frame(true);
  }

  private measure(view: ViewMode, explode: number): void {
    this.applyExplode(explode);
    this.root!.updateMatrixWorld(true);
    const bounds = new THREE.Box3();
    for (const { mesh } of this.treated) bounds.expandByObject(mesh);
    const sphere = new THREE.Sphere();
    bounds.getBoundingSphere(sphere);
    // The arm sweeps ±55° and reaches forward: pad the rest-pose sphere so
    // the cycle stays in frame. The exploded stack is tall and mostly
    // vertical, so it needs less padding to stay in view.
    this.radii[view] = Math.max(sphere.radius * (view === "exploded" ? 1.0 : 1.2), 1.2);
    this.centers[view] = new THREE.Vector3(0, (bounds.min.y + bounds.max.y) * 0.45, 0);
  }

  private applyExplode(t: number): void {
    for (const target of this.explodeTargets) {
      target.node.position.copy(target.rest).addScaledVector(target.offset, t);
    }
  }

  /** Current explode blend, 0 = assembled, 1 = exploded. */
  get explode(): number {
    return this.explodeValue;
  }

  /** Seconds into the animation clip. */
  get time(): number {
    return this.mixer?.time ?? 0;
  }

  setView(view: ViewMode): void {
    this.view = view;
    this.explodeGoal = view === "exploded" ? 1 : 0;
    this.frame(false);
  }

  /** "internals" hides every shell mesh; chips and mechanism stay. */
  setLayers(layers: LayerMode): void {
    this.layers = layers;
    for (const part of this.parts) {
      part.mesh.visible = layers === "full" || part.layer !== "shell";
    }
    if (this.focused && !this.focused.visible) this.focus(null);
    if (this.hovered && !this.hovered.visible) this.setHovered(null, 0, 0);
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
  }

  setSpeed(speed: number): void {
    this.speed = speed;
  }

  focus(part: PartInfo | null): void {
    this.focused = part?.mesh ?? null;
    emphasize(this.treated, this.focused, this.hovered);
    this.onSelect?.(part);
  }

  get focusedPart(): PartInfo | null {
    return this.focused ? this.byMesh.get(this.focused) ?? null : null;
  }

  /** The internal part closest to a chip: what the chip "hears" first. */
  nearestInternal(sensor: SensorInfo): PartInfo | null {
    const candidates = this.parts.filter((part) => part.layer === "internal" && part.sensor === sensor);
    return candidates.sort((a, b) => a.sensorDistance - b.sensorDistance)[0] ?? null;
  }

  frame(immediate: boolean): void {
    const radius = this.radii[this.view];
    const center = this.centers[this.view];
    this.controls.minDistance = radius * 0.6;
    this.controls.maxDistance = radius * 3.4;
    const distance = radius * (this.view === "exploded" ? 1.9 : 2.05);
    if (immediate) {
      this.controls.target.copy(center);
      const direction = new THREE.Vector3(0.62, 0.42, 0.66).normalize();
      this.camera.position.copy(center).addScaledVector(direction, distance);
      this.controls.update();
      this.frameGoal = null;
    } else {
      this.frameGoal = { center: center.clone(), distance };
    }
  }

  resetView(): void {
    this.frame(true);
  }

  private resize(): void {
    const { clientWidth, clientHeight } = this.host;
    this.renderer.setSize(clientWidth, clientHeight, false);
    this.camera.aspect = clientWidth / Math.max(clientHeight, 1);
    this.camera.updateProjectionMatrix();
  }

  private pickables(): THREE.Mesh[] {
    return this.parts.filter((part) => part.mesh.visible).map((part) => part.mesh);
  }

  private trackPointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.pointerInside = true;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables(), false)[0];
    this.setHovered((hit?.object as THREE.Mesh | undefined) ?? null, event.clientX, event.clientY);
  }

  private setHovered(mesh: THREE.Mesh | null, clientX: number, clientY: number): void {
    if (mesh !== this.hovered) {
      this.hovered = mesh;
      emphasize(this.treated, this.focused, this.hovered);
      this.renderer.domElement.style.cursor = mesh ? "pointer" : "";
    }
    this.onHover?.(mesh ? this.byMesh.get(mesh) ?? null : null, clientX, clientY);
  }

  private pick(event: MouseEvent): void {
    if (!this.root) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables(), false)[0];
    const mesh = (hit?.object as THREE.Mesh | undefined) ?? null;
    const part = mesh ? this.byMesh.get(mesh) ?? null : null;
    this.focus(part && part.mesh === this.focused ? null : part);
  }

  private tick(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1);

    // Explode tween: eased, and the joint clip keeps running underneath it.
    if (this.explodeValue !== this.explodeGoal) {
      const step = delta / EXPLODE_SECONDS;
      const next = this.explodeValue + Math.sign(this.explodeGoal - this.explodeValue) * step;
      this.explodeValue = this.explodeGoal > this.explodeValue ? Math.min(next, this.explodeGoal) : Math.max(next, this.explodeGoal);
      this.applyExplode(easeInOut(this.explodeValue));
    }

    if (this.mixer && this.playing) this.mixer.update(delta * this.speed);

    // Sensor chips breathe teal so they read as live instruments, not trim.
    const pulse = 0.55 + 0.45 * Math.sin(this.clock.elapsedTime * 2.4);
    for (const sensor of this.sensors) {
      if (sensor.mesh === this.focused || sensor.mesh === this.hovered) continue;
      const material = sensor.mesh.material as THREE.MeshStandardMaterial;
      material.emissive.copy(EDGE);
      material.emissiveIntensity = 0.25 + pulse * 0.5;
    }

    // Camera glide toward the framing for the current view.
    if (this.frameGoal) {
      const { center, distance } = this.frameGoal;
      this.controls.target.lerp(center, 0.08);
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      const current = this.camera.position.distanceTo(this.controls.target);
      const nextDistance = current + (distance - current) * 0.08;
      this.camera.position.copy(this.controls.target).addScaledVector(direction, nextDistance);
      if (Math.abs(nextDistance - distance) < 0.01 && this.controls.target.distanceTo(center) < 0.01) this.frameGoal = null;
    }

    this.controls.update();
    if (this.pointerInside && this.root) {
      // The arm moves under a still cursor: re-test hover each frame.
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hit = this.raycaster.intersectObjects(this.pickables(), false)[0];
      const mesh = (hit?.object as THREE.Mesh | undefined) ?? null;
      if (mesh !== this.hovered) this.setHovered(mesh, -1, -1);
    }
    this.renderer.render(this.scene, this.camera);
  }
}
