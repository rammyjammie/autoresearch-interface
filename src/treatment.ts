import * as THREE from "three";

// The Nautilus "outline" model treatment for library GLBs with authored
// PBR: materials render verbatim, and every mesh gains CAD-style feature
// edges — only creases sharper than the threshold draw, so dense meshes
// stay quiet while silhouettes and caps read as drawing line work.

export const EDGE_COLOR = "#2bd9c7";
export const EDGE_ANGLE_DEG = 28;
const EDGE_OPACITY = 0.85;
const EDGE_OPACITY_DIM = 0.18;

export interface TreatedPart {
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
  edges: THREE.LineSegments;
  edgeMaterial: THREE.LineBasicMaterial;
}

/** Apply the treatment in place; returns one record per mesh. */
export function applyReefTreatment(root: THREE.Object3D): TreatedPart[] {
  const parts: TreatedPart[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    // Per-mesh material clones so hover/selection can tint one part
    // without touching its siblings that share the authored material.
    const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const material = source.clone();
    // Push faces back a hair so the edge lines never z-fight.
    material.polygonOffset = true;
    material.polygonOffsetFactor = 1;
    material.polygonOffsetUnits = 1;
    mesh.material = material;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: EDGE_OPACITY });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, EDGE_ANGLE_DEG), edgeMaterial);
    edges.name = "feature-edges";
    edges.raycast = () => undefined;
    mesh.add(edges);
    parts.push({ mesh, material, edges, edgeMaterial });
  });
  return parts;
}

const HIGHLIGHT = new THREE.Color(EDGE_COLOR);

/**
 * Selection/hover emphasis: the focused part glows teal and keeps its
 * edges; while anything is focused, every other part's edges fall back so
 * the focused silhouette carries the frame.
 */
export function emphasize(parts: TreatedPart[], focused: THREE.Mesh | null, hovered: THREE.Mesh | null): void {
  for (const part of parts) {
    const isFocused = part.mesh === focused;
    const isHovered = part.mesh === hovered;
    part.material.emissive.copy(isFocused || isHovered ? HIGHLIGHT : new THREE.Color(0x000000));
    part.material.emissiveIntensity = isFocused ? 0.28 : isHovered ? 0.14 : 0;
    part.edgeMaterial.opacity = focused && !isFocused && !isHovered ? EDGE_OPACITY_DIM : EDGE_OPACITY;
  }
}
