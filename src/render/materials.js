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
      loadTexture("assets/textures/sandstone/color.jpg", { color: true, repeat: 8 }),
      loadTexture("assets/textures/sandstone/normal.jpg", { repeat: 8 }),
      loadTexture("assets/textures/sandstone/roughness.jpg", { repeat: 8 }),
      loadTexture("assets/textures/wood/color.jpg", { color: true, repeat: 2.5 }),
      loadTexture("assets/textures/wood/normal.jpg", { repeat: 2.5 }),
      loadTexture("assets/textures/wood/roughness.jpg", { repeat: 2.5 }),
      loadTexture("assets/textures/stone/color.jpg", { color: true, repeat: 3 }),
      loadTexture("assets/textures/stone/normal.jpg", { repeat: 3 }),
      loadTexture("assets/textures/stone/roughness.jpg", { repeat: 3 }),
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
    gold: new THREE.MeshStandardMaterial({ color: 0xcc9a43, roughness: 0.34, metalness: 0.72 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0x8a6634, roughness: 0.42, metalness: 0.62 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x394244, roughness: 0.28, metalness: 0.78 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c9998, roughness: 0.25, metalness: 0.82 }),
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
    redLacquer: new THREE.MeshStandardMaterial({ color: 0x8e312c, roughness: 0.38, metalness: 0.1 }),
    redCloth: new THREE.MeshStandardMaterial({ color: 0xbf4439, roughness: 0.78 }),
    redSilk: new THREE.MeshStandardMaterial({
      color: 0xc85246,
      roughness: 0.5,
      side: THREE.DoubleSide,
    }),
    blackLacquer: new THREE.MeshStandardMaterial({ color: 0x223236, roughness: 0.36, metalness: 0.13 }),
    blackCloth: new THREE.MeshStandardMaterial({ color: 0x34494b, roughness: 0.79 }),
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
  };
}
