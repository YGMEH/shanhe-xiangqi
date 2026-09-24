import * as THREE from "three";

const loader = new THREE.TextureLoader();

function loadTexture(url, { color = false, repeat = 1 } = {}) {
  return new Promise((resolve) => {
    loader.load(
      url,
      (texture) => {
        if (color) texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(repeat, repeat);
        texture.anisotropy = 8;
        resolve(texture);
      },
      undefined,
      () => resolve(null)
    );
  });
}

export async function createMaterialLibrary(renderer) {
  const [groundColor, groundNormal, groundRough, woodColor, woodNormal, woodRough, stoneColor, stoneNormal, stoneRough] =
    await Promise.all([
      loadTexture("assets/textures/sandstone/color.webp", { color: true, repeat: 8 }),
      loadTexture("assets/textures/sandstone/normal.webp", { repeat: 8 }),
      loadTexture("assets/textures/sandstone/roughness.webp", { repeat: 8 }),
      loadTexture("assets/textures/wood/color.webp", { color: true, repeat: 2.5 }),
      loadTexture("assets/textures/wood/normal.webp", { repeat: 2.5 }),
      loadTexture("assets/textures/wood/roughness.webp", { repeat: 2.5 }),
      loadTexture("assets/textures/stone/color.webp", { color: true, repeat: 3 }),
      loadTexture("assets/textures/stone/normal.webp", { repeat: 3 }),
      loadTexture("assets/textures/stone/roughness.webp", { repeat: 3 }),
    ]);

  const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  [
    groundColor,
    groundNormal,
    groundRough,
    woodColor,
    woodNormal,
    woodRough,
    stoneColor,
    stoneNormal,
    stoneRough,
  ].forEach((texture) => {
    if (texture) texture.anisotropy = maxAnisotropy;
  });

  const ground = new THREE.MeshStandardMaterial({
    color: groundColor ? 0x9f967c : 0x726c58,
    map: groundColor,
    normalMap: groundNormal,
    roughnessMap: groundRough,
    normalScale: new THREE.Vector2(0.72, 0.72),
    roughness: 0.96,
    metalness: 0.02,
  });

  const stone = new THREE.MeshStandardMaterial({
    color: stoneColor ? 0xb0a68d : 0x8d8774,
    map: stoneColor,
    normalMap: stoneNormal,
    roughnessMap: stoneRough,
    normalScale: new THREE.Vector2(0.82, 0.82),
    roughness: 0.93,
    metalness: 0.01,
  });

  const stoneDark = stone.clone();
  stoneDark.color = new THREE.Color(0x726c60);

  const common = {
    gold: new THREE.MeshStandardMaterial({ color: 0xe0b356, roughness: 0.3, metalness: 0.76 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x9a7440, roughness: 0.42, metalness: 0.62 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x394244, roughness: 0.28, metalness: 0.78 }),
    steel: new THREE.MeshStandardMaterial({ color: 0xa9c0c6, roughness: 0.22, metalness: 0.84 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x553728, roughness: 0.84, metalness: 0.02 }),
    riderLeather: new THREE.MeshStandardMaterial({ color: 0x341f1d, roughness: 0.78, metalness: 0.02 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xb77e58, roughness: 0.82 }),
    darkSkin: new THREE.MeshStandardMaterial({ color: 0x8d5e43, roughness: 0.84 }),
    horseBrown: new THREE.MeshStandardMaterial({ color: 0x5b3425, roughness: 0.8 }),
    horseBlack: new THREE.MeshStandardMaterial({ color: 0x201c1b, roughness: 0.76 }),
    elephant: new THREE.MeshStandardMaterial({ color: 0x59615c, roughness: 0.88 }),
    ivory: new THREE.MeshStandardMaterial({ color: 0xd7cbac, roughness: 0.56 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x68452b, roughness: 0.68 }),
    drum: new THREE.MeshStandardMaterial({ color: 0x8e382f, roughness: 0.64 }),
    // 红方: 偏暖的朱漆 + 高光金, 在暖黄沙地上靠"亮度+饱和度"区分
    redLacquer: new THREE.MeshStandardMaterial({ color: 0xa8352b, roughness: 0.34, metalness: 0.12 }),
    redCloth: new THREE.MeshStandardMaterial({ color: 0xcf4a3c, roughness: 0.76 }),
    factionRed: new THREE.MeshStandardMaterial({
      color: 0xe04a35,
      roughness: 0.4,
      metalness: 0.1,
      emissive: 0x4a0d06,
      emissiveIntensity: 0.55,
    }),
    redSilk: new THREE.MeshStandardMaterial({
      color: 0xc85246,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
    // 黑方: 偏冷的玄铁 + 青钢, 与红方的暖色形成冷/暖对立
    blackLacquer: new THREE.MeshStandardMaterial({ color: 0x1e3a46, roughness: 0.32, metalness: 0.16 }),
    blackCloth: new THREE.MeshStandardMaterial({ color: 0x2f5766, roughness: 0.76 }),
    factionBlack: new THREE.MeshStandardMaterial({
      color: 0x49b8d6,
      roughness: 0.38,
      metalness: 0.18,
      emissive: 0x06323f,
      emissiveIntensity: 0.6,
    }),
    blackSilk: new THREE.MeshStandardMaterial({
      color: 0x57706f,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
    glowRed: new THREE.MeshBasicMaterial({ color: 0xff5c4d, transparent: true, opacity: 0.75 }),
    glowGold: new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7 }),
    shadow: new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    }),
  };

  return {
    ground,
    stone,
    stoneDark,
    ...common,
    textureSources: {
      groundColor,
      groundNormal,
      groundRough,
      woodColor,
      woodNormal,
      woodRough,
      stoneColor,
      stoneNormal,
      stoneRough,
    },
  };
}

export function factionMaterials(materials, side) {
  const red = side === "red";
  return {
    accent: red ? materials.redLacquer : materials.blackLacquer,
    cloth: red ? materials.redCloth : materials.blackCloth,
    silk: red ? materials.redSilk : materials.blackSilk,
    trim: red ? materials.gold : materials.steel,
    darkTrim: red ? materials.bronze : materials.darkMetal,
    // 底座最外圈的高饱和阵营色带: 远景/俯视时最先被看到的那一档识别信息。
    baseBand: red ? materials.factionRed : materials.factionBlack,
  };
}
