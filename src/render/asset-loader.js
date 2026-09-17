import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";

const loader = new GLTFLoader();
const cache = new Map();

export const MODEL_MANIFEST = Object.freeze({
  soldier: "assets/models/generated/soldier.glb",
  "soldier-black": "assets/models/generated/soldier-black.glb",
  general: "assets/models/generated/general.glb",
  "general-black": "assets/models/generated/general-black.glb",
  advisor: "assets/models/generated/advisor.glb",
  "advisor-black": "assets/models/generated/advisor-black.glb",
  elephant: "assets/models/generated/elephant.glb",
  "elephant-black": "assets/models/generated/elephant-black.glb",
  horse: "assets/models/generated/horse.glb",
  "horse-black": "assets/models/generated/horse-black.glb",
  chariot: "assets/models/generated/chariot.glb",
  "chariot-black": "assets/models/generated/chariot-black.glb",
  cannon: "assets/models/generated/cannon.glb",
  "cannon-black": "assets/models/generated/cannon-black.glb",
});

export function loadModel(key) {
  if (cache.has(key)) return cache.get(key);
  const url = MODEL_MANIFEST[key];
  const promise = url
    ? new Promise((resolve) => {
        loader.load(
          url,
          (gltf) => resolve(prepareModel(gltf.scene, gltf.animations ?? [])),
          undefined,
          () => resolve(null)
        );
      })
    : Promise.resolve(null);
  cache.set(key, promise);
  return promise;
}

function prepareModel(scene, animations) {
  const materialGroups = new Map();
  const resolveMaterial = (material) => {
    if (!material) return material;
    const key = material.uuid ?? material.name;
    if (!materialGroups.has(key)) {
      const clone = material.clone();
      tunePbrMaterial(clone, material.name);
      materialGroups.set(key, clone);
    }
    return materialGroups.get(key);
  };

  scene.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.frustumCulled = true;
    if (Array.isArray(child.material)) {
      child.material = child.material.map(resolveMaterial);
    } else {
      child.material = resolveMaterial(child.material);
    }
  });
  scene.userData.animations = animations;
  return { scene, animations };
}

/**
 * glTF base colors are untextured flat factors, so the shading has to carry
 * the material read. Tune each authored slot toward its real-world response
 * instead of letting everything resolve to the same matte grey.
 */
function tunePbrMaterial(material, name) {
  const key = String(name ?? "").toLowerCase();
  material.envMapIntensity = 0.3;
  material.side = material.side ?? THREE.FrontSide;

  if (key.includes("steel")) {
    material.metalness = Math.min(0.72, (material.metalness ?? 0.55) * 1.02);
    material.roughness = Math.max(0.3, (material.roughness ?? 0.42) * 0.92);
    material.envMapIntensity = 0.4;
    return;
  }
  if (key.includes("accent") || key.includes("bronze")) {
    material.metalness = Math.min(0.66, (material.metalness ?? 0.5) * 1.0);
    material.roughness = Math.max(0.3, (material.roughness ?? 0.42) * 0.95);
    material.envMapIntensity = 0.36;
    return;
  }
  if (key.includes("silk") || key.includes("cloth") || key.includes("sleeve")) {
    material.metalness = 0;
    material.roughness = Math.max(0.52, (material.roughness ?? 0.72) * 0.92);
    material.side = THREE.DoubleSide;
    return;
  }
  if (key.includes("leather") || key.includes("hide") || key.includes("wood")) {
    material.metalness = 0;
    material.roughness = Math.max(0.6, (material.roughness ?? 0.8) * 0.98);
    return;
  }
  if (key.includes("skin") || key.includes("ivory")) {
    material.metalness = 0;
    material.roughness = Math.max(0.4, (material.roughness ?? 0.6) * 0.94);
    material.envMapIntensity = 0.22;
    return;
  }
  if (key.includes("faction")) {
    material.metalness = Math.min(0.35, material.metalness ?? 0.08);
    material.roughness = Math.max(0.34, (material.roughness ?? 0.46) * 0.95);
    return;
  }
  material.metalness = Math.min(0.6, material.metalness ?? 0.2);
  material.roughness = Math.min(1, (material.roughness ?? 0.72) * 1.05);
}

export async function cloneModel(key) {
  const source = await loadModel(key);
  if (!source) return null;
  const scene = cloneSkeleton(source.scene);
  return {
    scene,
    animations: source.animations.map((clip) => clip.clone()),
  };
}
