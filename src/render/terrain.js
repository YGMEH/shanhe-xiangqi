import * as THREE from "three";
import { BOARD_COLUMNS, BOARD_ROWS, BRIDGE_COLUMNS } from "../game/constants.js";

export const TERRAIN_SIZE = Object.freeze({
  width: 30,
  depth: 19.5,
});

export const BOARD_SPACING = Object.freeze({
  x: 1.98,
  y: 1.7,
});

export function boardPosition(x, y) {
  return {
    x: (x - (BOARD_COLUMNS - 1) / 2) * BOARD_SPACING.x,
    z: (y - (BOARD_ROWS - 1) / 2) * BOARD_SPACING.y,
  };
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hash2d(x, z) {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2d(ix, iz);
  const b = hash2d(ix + 1, iz);
  const c = hash2d(ix, iz + 1);
  const d = hash2d(ix + 1, iz + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uz
  );
}

function fbm(x, z) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let i = 0; i < 4; i += 1) {
    value += valueNoise(x * frequency, z * frequency) * amplitude;
    frequency *= 2.05;
    amplitude *= 0.5;
  }
  return value;
}

/**
 * Push every vertex of a primitive along its own normal by coherent noise.
 * Turns clean primitives (cones, spheres, ico shells) into believable
 * fractured rock and foliage silhouettes without authoring extra geometry.
 */
function displaceGeometry(geometry, amount, seed = 0, frequency = 1.6) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  if (!normal) geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const noise =
      fbm(x * frequency + seed * 3.7, z * frequency - seed * 2.1) * 0.62 +
      fbm(y * frequency * 2.3 + seed * 1.3, x * frequency * 1.7 + seed) * 0.38;
    const offset = (noise - 0.5) * 2 * amount;
    position.setXYZ(
      i,
      x + normals.getX(i) * offset,
      y + normals.getY(i) * offset,
      z + normals.getZ(i) * offset
    );
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  return geometry;
}

export function terrainHeightAt(x, z) {
  const boardX = x / 12.1;
  const boardZ = z / 8.55;
  const boardFalloff = Math.max(0, 1 - Math.pow(boardX * boardX + boardZ * boardZ, 0.8));
  const rolling =
    (fbm(x * 0.26 + 2.1, z * 0.26 - 1.3) - 0.5) * 1.25 +
    (fbm(x * 0.72 - 3.2, z * 0.72 + 1.8) - 0.5) * 0.28;
  const plateau = 0.1 + boardFalloff * 0.2 + rolling * (0.22 + (1 - boardFalloff) * 0.9);
  const riverCore = 1 - smoothstep(0.35, 1.35, Math.abs(z));
  const riverBank = 1 - smoothstep(1.5, 2.7, Math.abs(z));
  const channel = riverCore * 0.78 + riverBank * 0.16;

  const rawBridgeBlend = BRIDGE_COLUMNS.reduce((closest, column) => {
    const bridgeX = (column - (BOARD_COLUMNS - 1) / 2) * BOARD_SPACING.x;
    return Math.min(closest, smoothstep(0.35, 1.22, Math.abs(x - bridgeX)));
  }, 1);
  const bridgeBlend = 1 - rawBridgeBlend;
  const bridgeDeck = 0.26 + smoothstep(0.2, 0.85, Math.abs(z)) * 0.04;
  const height = THREE.MathUtils.lerp(plateau - channel, bridgeDeck, bridgeBlend);
  return height;
}

export function terrainNormalAt(x, z, epsilon = 0.08) {
  const left = terrainHeightAt(x - epsilon, z);
  const right = terrainHeightAt(x + epsilon, z);
  const back = terrainHeightAt(x, z - epsilon);
  const front = terrainHeightAt(x, z + epsilon);
  const normal = new THREE.Vector3(left - right, epsilon * 2, back - front);
  return normal.normalize();
}

export function createTerrain(materials, quality = "high") {
  const segmentsX = quality === "high" ? 180 : 112;
  const segmentsZ = quality === "high" ? 112 : 72;
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE.width,
    TERRAIN_SIZE.depth,
    segmentsX,
    segmentsZ
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors = [];
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = terrainHeightAt(x, z);
    position.setY(i, y);
    const moisture = 1 - smoothstep(1.2, 3.4, Math.abs(z));
    const variation = fbm(x * 1.4 + 7, z * 1.4 - 4);
    const soilR = 0.56 + variation * 0.15 - moisture * 0.08;
    const soilG = 0.47 + variation * 0.12 - moisture * 0.02;
    const soilB = 0.32 + variation * 0.09 - moisture * 0.1;

    // Pale weathered paving laid into the ground across the playable grid.
    // Blending the colour instead of adding a raised slab keeps the terrain
    // continuous: no plateau edge, no seam against the surrounding ground.
    //
    // 注意这两个归一化系数: 原来写的是 0.58 / 0.54, 也就是把"看得见的铺装区"
    // 缩到了真实棋盘的 58%/54%。结果是棋子站在浅色区域之外 —— 俯视时非常明显,
    // 红方前排和黑方后排都落在格线外的土地上, 玩家会以为棋子"跑出格子了"。
    // 正确的做法是让铺装范围正好覆盖"最后一排格子的中心再外扩半格",
    // 即 X 用 8 格间距 / Z 用 9 格间距, 再加上半格余量。
    const boardHalfX = ((BOARD_COLUMNS - 1) / 2 + 0.5) * BOARD_SPACING.x;
    const boardHalfZ = ((BOARD_ROWS - 1) / 2 + 0.5) * BOARD_SPACING.y;
    const boardX = x / boardHalfX;
    const boardZ = z / boardHalfZ;
    const boardDistance = Math.hypot(boardX, boardZ);
    // 1.0 往外再留一点过渡, 让铺装边缘自然融进土地而不是硬切
    const paving = 1 - smoothstep(0.94, 1.12, boardDistance);
    const slabVariation = fbm(x * 2.1 - 5, z * 2.1 + 9);
    const slabShade = 0.66 + slabVariation * 0.14;
    colors.push(
      THREE.MathUtils.lerp(soilR, slabShade * 1.02, paving),
      THREE.MathUtils.lerp(soilG, slabShade * 0.95, paving),
      THREE.MathUtils.lerp(soilB, slabShade * 0.78, paving)
    );
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = materials.ground.clone();
  material.vertexColors = true;
  material.color = new THREE.Color(0xb09a72);

  const terrain = new THREE.Mesh(geometry, material);
  terrain.receiveShadow = true;
  terrain.castShadow = false;
  terrain.name = "terrain";
  return terrain;
}

export function createRiver(materials) {
  const waterGeometry = new THREE.PlaneGeometry(26.4, 4.3, 240, 38);
  waterGeometry.rotateX(-Math.PI / 2);

  const water = new THREE.MeshPhysicalMaterial({
    color: 0x1d5a5c,
    roughness: 0.14,
    metalness: 0.12,
    transmission: 0.42,
    thickness: 0.7,
    ior: 1.333,
    clearcoat: 1,
    clearcoatRoughness: 0.14,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(waterGeometry, water);
  mesh.receiveShadow = true;
  mesh.name = "river";
  mesh.userData.basePositions = Float32Array.from(waterGeometry.attributes.position.array);

  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(27.0, 4.7, 1, 1),
    materials.stoneDark
  );
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = -0.72;
  bed.receiveShadow = true;

  const pebbles = new THREE.Group();
  pebbles.name = "riverbed-pebbles";
  const pebbleGeometry = new THREE.DodecahedronGeometry(0.07, 0);
  for (let i = 0; i < 110; i += 1) {
    const pebble = new THREE.Mesh(pebbleGeometry, materials.stone);
    pebble.position.set(
      (Math.random() - 0.5) * 24,
      -0.6 + Math.random() * 0.04,
      (Math.random() - 0.5) * 2.9
    );
    pebble.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    pebble.scale.set(
      0.6 + Math.random() * 1.4,
      0.4 + Math.random() * 0.5,
      0.6 + Math.random() * 1.4
    );
    pebble.receiveShadow = true;
    pebbles.add(pebble);
  }

  // Wet boulders breaking the current.
  for (let i = 0; i < 14; i += 1) {
    const boulder = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.22, 1),
      materials.stoneDark
    );
    displaceGeometry(boulder.geometry, 0.07, i, 2.1);
    boulder.position.set(
      (Math.random() - 0.5) * 23.5,
      -0.42 + Math.random() * 0.14,
      (Math.random() - 0.5) * 2.5
    );
    boulder.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    boulder.castShadow = true;
    pebbles.add(boulder);
  }

  const group = new THREE.Group();
  group.name = "river-group";
  group.add(bed, pebbles, mesh);

  const foamMaterial = new THREE.MeshBasicMaterial({
    color: 0xd3e4dc,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const foam = new THREE.Group();
  const foamGeometry = new THREE.PlaneGeometry(1.0, 0.05, 1, 1);
  for (let i = 0; i < 46; i += 1) {
    const strip = new THREE.Mesh(
      i % 3 === 0
        ? new THREE.PlaneGeometry(0.5 + Math.random() * 1.1, 0.035)
        : foamGeometry.clone(),
      foamMaterial
    );
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = (Math.random() - 0.5) * 0.34;
    strip.position.set(
      (Math.random() - 0.5) * 23.5,
      -0.315 + Math.random() * 0.04,
      (Math.random() - 0.5) * 2.5
    );
    strip.scale.x = 0.5 + Math.random() * 1.4;
    strip.userData.speed = 0.4 + Math.random() * 0.95;
    strip.userData.wobble = Math.random() * Math.PI * 2;
    foam.add(strip);
  }
  group.add(foam);

  return { group, mesh, bed, foam };
}

export function updateRiver(river, time) {
  const geometry = river.mesh.geometry;
  const position = geometry.attributes.position;
  const base = river.mesh.userData.basePositions;
  const shouldRecomputeNormals = time - (river.mesh.userData.lastNormalUpdate ?? -1) > 0.08;
  for (let i = 0; i < position.count; i += 1) {
    const index = i * 3;
    const x = base[index];
    const z = base[index + 2];
    const flow = x * 0.62 + time * 1.35;
    const y =
      Math.sin(flow) * 0.042 +
      Math.sin(flow * 2.3 + z * 1.4) * 0.016 +
      Math.sin(z * 2.2 - time * 1.9) * 0.02;
    position.setY(i, y - 0.34);
  }
  position.needsUpdate = true;
  if (shouldRecomputeNormals) {
    geometry.computeVertexNormals();
    river.mesh.userData.lastNormalUpdate = time;
  }

  river.foam.children.forEach((strip, index) => {
    strip.position.x += strip.userData.speed * 0.03;
    strip.position.z += Math.sin(time * 0.9 + strip.userData.wobble) * 0.0016;
    strip.rotation.z += Math.sin(time * 1.4 + index) * 0.002;
    if (strip.position.x > 12.4) strip.position.x = -12.4;
    strip.material.opacity = 0.12 + Math.sin(time * 1.3 + index) * 0.05;
  });
}

export function createBridges(materials) {
  const group = new THREE.Group();
  group.name = "bridges";
  const bridgeWidth = 2.05;

  BRIDGE_COLUMNS.forEach((column) => {
    const x = (column - (BOARD_COLUMNS - 1) / 2) * BOARD_SPACING.x;
    const bridge = new THREE.Group();
    bridge.position.set(x, 0.02, 0);

    // Deck slabs laid over a gentle arch instead of one flat box.
    const deckSegments = 17;
    const bridgeSpan = 5.9;
    for (let i = 0; i < deckSegments; i += 1) {
      const t = i / (deckSegments - 1);
      const z = (t - 0.5) * bridgeSpan;
      const arch = Math.sin(t * Math.PI) * 0.17;
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(bridgeWidth, 0.15, bridgeSpan / deckSegments + 0.035, 1, 1, 1),
        i % 2 === 0 ? materials.stone : materials.stoneDark
      );
      slab.position.set(0, 0.12 + arch, z);
      slab.rotation.x = -Math.cos(t * Math.PI) * 0.13;
      slab.castShadow = true;
      slab.receiveShadow = true;
      bridge.add(slab);
    }

    // Barrel arches, water-stained below the deck.
    [-1, 1].forEach((side) => {
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(0.62, 0.2, 10, 30, Math.PI),
        side < 0 ? materials.stoneDark : materials.stone
      );
      arch.rotation.set(Math.PI / 2, 0, Math.PI);
      arch.position.set(side * (bridgeWidth * 0.5 - 0.16), -0.3, 0);
      arch.scale.set(1.12, 0.9, 1);
      arch.castShadow = true;
      bridge.add(arch);
    });

    const keystone = new THREE.Mesh(
      new THREE.BoxGeometry(bridgeWidth + 0.16, 0.34, 0.42, 1, 1, 1),
      materials.stoneDark
    );
    keystone.position.set(0, 0.35, 0.28);
    keystone.castShadow = true;
    bridge.add(keystone);

    // Balustrade rails, posts and carved caps.
    [-1.0, 1.0].forEach((side) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.16, bridgeSpan + 0.3, 1, 1, 1),
        materials.stone
      );
      rail.position.set(side * (bridgeWidth * 0.5 + 0.03), 0.5, 0);
      rail.rotation.x = -0.04;
      rail.castShadow = true;
      bridge.add(rail);

      for (let i = -2; i <= 2; i += 1) {
        const post = new THREE.Mesh(
          new THREE.BoxGeometry(0.19, 0.72, 0.19, 1, 1, 1),
          materials.stone
        );
        post.position.set(side * (bridgeWidth * 0.5 + 0.03), 0.4, i * 1.32);
        post.castShadow = true;
        bridge.add(post);

        const cap = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 10, 7),
          materials.stoneDark
        );
        cap.position.set(side * (bridgeWidth * 0.5 + 0.03), 0.79, i * 1.28);
        cap.scale.set(1, 0.7, 1);
        cap.castShadow = true;
        bridge.add(cap);
      }
    });

    // Stone lions at the four approaches.
    [-1, 1].forEach((sideX) => {
      [-1, 1].forEach((sideZ) => {
        const lion = new THREE.Group();
        lion.position.set(sideX * (bridgeWidth * 0.5 + 0.12), 0.3, sideZ * (bridgeSpan * 0.5 + 0.12));
        const plinth = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.34, 0.28),
          materials.stoneDark
        );
        plinth.position.y = -0.02;
        lion.add(plinth);
        const body = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.17, 1),
          materials.stone
        );
        displaceGeometry(body.geometry, 0.035, sideX * 7 + sideZ, 3.1);
        body.position.y = 0.3;
        body.scale.set(0.85, 1.1, 1.3);
        body.rotation.y = sideZ > 0 ? 0 : Math.PI;
        body.castShadow = true;
        lion.add(body);
        const head = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.12, 1),
          materials.stone
        );
        head.position.set(0, 0.48, sideZ * 0.1);
        head.castShadow = true;
        lion.add(head);
        bridge.add(lion);
      });
    });

    group.add(bridge);
  });

  return group;
}

export function createDistantRidges(materials, quality = "high") {
  const group = new THREE.Group();
  group.name = "distant-ridges";

  const layers = [
    {
      color: 0x4c5d59,
      count: quality === "high" ? 26 : 14,
      radius: 43,
      height: 7.2,
      base: -0.9,
      spread: 1.7,
      depth: 1.9,
    },
    {
      color: 0x5a6a64,
      count: quality === "high" ? 22 : 12,
      radius: 37,
      height: 5.2,
      base: -0.76,
      spread: 1.5,
      depth: 1.5,
    },
  ];

  layers.forEach((layer, layerIndex) => {
    const material = new THREE.MeshStandardMaterial({
      color: layer.color,
      roughness: 1,
      metalness: 0,
      flatShading: true,
      fog: true,
    });
    for (let i = 0; i < layer.count; i += 1) {
      const angle =
        Math.PI * 0.88 + (i / Math.max(1, layer.count - 1)) * Math.PI * 1.24;
      const distance = layer.radius + (hash2d(i, layerIndex * 9) - 0.5) * layer.spread * 3;
      const height = layer.height * (0.5 + hash2d(i, 31) * 0.9);
      const radius = height * (0.46 + hash2d(i, 44) * 0.24);

      // Two overlapping, displaced crags read as a real ridge line rather
      // than a row of obvious cones.
      const stack = new THREE.Group();
      const peakCount = quality === "high" ? 3 : 2;
      for (let p = 0; p < peakCount; p += 1) {
        const peakHeight = height * (p === 0 ? 1 : 0.52 + hash2d(i * 7 + p, 61) * 0.34);
        const peakRadius = radius * (p === 0 ? 1 : 0.66 + hash2d(i * 5 + p, 73) * 0.3);
        const geometry = new THREE.ConeGeometry(peakRadius, peakHeight, 5 + ((i + p) % 4), 3);
        displaceGeometry(geometry, peakRadius * 0.24, i * 3 + p, 0.9);
        const peak = new THREE.Mesh(geometry, material);
        peak.position.set(
          (hash2d(i * 11 + p, 83) - 0.5) * radius * 0.8,
          peakHeight * (p === 0 ? 0.5 : 0.34),
          (hash2d(i * 13 + p, 97) - 0.5) * radius * 0.6
        );
        peak.rotation.y = hash2d(i + p, 71) * Math.PI;
        peak.scale.set(
          0.82 + hash2d(i * 3 + p, 41) * 0.5,
          1,
          layer.depth * (0.5 + hash2d(i * 3 + p, 88) * 0.34)
        );
        stack.add(peak);
      }

      stack.position.set(
        Math.cos(angle) * distance,
        layer.base + height * 0.5,
        Math.sin(angle) * distance * 0.72
      );
      group.add(stack);
    }
  });

  return group;
}

export function createGroundSkirt(materials) {
  const outerWidth = 96;
  const outerDepth = 74;
  const geometry = new THREE.PlaneGeometry(outerWidth, outerDepth, 96, 74);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position;
  const colors = [];
  const innerX = TERRAIN_SIZE.width / 2;
  const innerZ = TERRAIN_SIZE.depth / 2;
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const outsideX = Math.max(0, Math.abs(x) - innerX);
    const outsideZ = Math.max(0, Math.abs(z) - innerZ);
    const blend = smoothstep(0, 22, Math.hypot(outsideX, outsideZ));
    const terrainY = terrainHeightAt(
      THREE.MathUtils.clamp(x, -innerX, innerX),
      THREE.MathUtils.clamp(z, -innerZ, innerZ)
    );
    position.setY(i, THREE.MathUtils.lerp(terrainY - 0.02, -1.9, blend));
    const variation = fbm(x * 0.5 + 4, z * 0.5 - 2);
    const shade = 0.56 + variation * 0.15;
    colors.push(shade * 1.02, shade * 0.9, shade * 0.7);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const skirt = new THREE.Mesh(
    geometry,
    materials.ground.clone()
  );
  skirt.material.vertexColors = true;
  skirt.receiveShadow = true;
  skirt.name = "ground-skirt";
  skirt.material.color = new THREE.Color(0xb09a72);
  skirt.material.roughness = 1;
  return skirt;
}

export function createBoundaryDetails(materials, quality = "high") {
  const group = new THREE.Group();
  group.name = "boundary-details";
  const rockCount = quality === "high" ? 34 : 18;
  const rockMaterials = [
    materials.stoneDark,
    materials.stone,
    new THREE.MeshStandardMaterial({ color: 0x5f5a4e, roughness: 0.98 }),
  ];

  for (let i = 0; i < rockCount; i += 1) {
    const angle = (i / rockCount) * Math.PI * 2 + hash2d(i, 3) * 0.34;
    const radius = 11.5 + hash2d(i, 6) * 6.5;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.72;
    // 排除"棋盘 + 相机活动区"。
    // 原来只排除 |x|<10.2 && |z|<9.6, 但玩家默认相机在 z≈14 一带
    // (红方身后), 于是会有一颗石头正好落在镜头前 3.5 米处, 在 32° FOV 下
    // 被放大成一坨挡住半个画面的巨石 —— 看起来像模型出错, 其实只是距离太近。
    // 所以把短边方向(z)的排除范围扩到 13.5, 连相机站的那条带子一起清空。
    if (Math.abs(z) < 13.5 && Math.abs(x) < 11.5) continue;
    if (Math.abs(x) < 10.2 && Math.abs(z) < 9.6) continue;
    const scale = 0.12 + hash2d(i, 9) * 0.42;
    const geometry = new THREE.DodecahedronGeometry(scale, 1);
    displaceGeometry(geometry, scale * 0.34, i, 2.4);
    const rock = new THREE.Mesh(geometry, rockMaterials[i % rockMaterials.length]);
    rock.position.set(x, terrainHeightAt(x, z) + scale * 0.34, z);
    rock.rotation.set(hash2d(i, 2) * 2, hash2d(i, 8) * Math.PI, hash2d(i, 5) * 2);
    rock.scale.set(0.8 + hash2d(i, 4), 0.5 + hash2d(i, 7) * 0.7, 0.85 + hash2d(i, 1));
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.96 });
  const foliageMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x2f4438, roughness: 0.94, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x3a5341, roughness: 0.92, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x455840, roughness: 0.9, flatShading: true }),
    new THREE.MeshStandardMaterial({ color: 0x505a38, roughness: 0.93, flatShading: true }),
  ];

  const treeCount = quality === "high" ? 40 : 20;
  for (let i = 0; i < treeCount; i += 1) {
    const angle = (i / treeCount) * Math.PI * 2 + hash2d(i, 12) * 0.5;
    // 树往外推: 原来最近的一圈落在半径 12.4, 在世界里离棋盘边缘只有约 1.4,
    // 斜俯视时树冠会正好投影到前排棋子上(实测红方前排被一棵松树挡住)。
    // 近端(棋盘短边方向)尤其明显, 所以整体半径加大, 并且靠近棋盘的
    // 方向再多让出一段。
    const radius = 15.2 + Math.pow(hash2d(i, 12), 0.7) * 8.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.72;
    // 排除"棋盘 + 营地 + 相机活动区"。
    //
    // 玩家默认相机在 z≈14 一带(红方身后) 俯视棋盘。原来只排除到 |z|<10,
    // 于是 z=11~15 的树正好长在镜头前 2.6~4 米处, 斜视角下被放大成一坨
    // 挡住左下角的棕色块 —— 前两轮我把它误判成"巨石", 其实一直是树。
    // 营地帐篷占 z≈12.8~17, 所以树的排除区必须推到 19 以外,
    // 让相机和营地之间留出一条干净的通视带。
    if (Math.abs(z) < 19.0 && Math.abs(x) < 15.0) continue;
    if (Math.abs(x) < 10.4 && Math.abs(z) < 10.0) continue;
    if (Math.abs(z) < 3.4 && Math.abs(x) < 14) continue;

    const y = terrainHeightAt(x, z);
    const tree = new THREE.Group();
    tree.position.set(x, y, z);
    tree.rotation.y = hash2d(i, 29) * Math.PI * 2;
    // 靠近棋盘短边(玩家视角的"上下")的树压矮, 避免遮住前排棋子
    const nearBoardZ = Math.max(0, 1 - Math.max(0, Math.abs(z) - 9) / 6);
    const kind = hash2d(i, 33) < 0.58 ? "pine" : "broad";
    // 越靠近棋盘短边越矮(最多压到 62%), 远处的树保持原高度以撑住景深
    const height = ((kind === "pine" ? 1.35 : 1.15) + hash2d(i, 18) * 1.1) *
      (1 - nearBoardZ * 0.38);
    const lean = (hash2d(i, 37) - 0.5) * 0.14;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.13, height, 7),
      bark
    );
    trunk.position.y = height / 2;
    trunk.rotation.z = lean;
    trunk.castShadow = true;
    tree.add(trunk);

    if (kind === "pine") {
      const tiers = quality === "high" && i % 2 === 0 ? 4 : 3;
      for (let tier = 0; tier < tiers; tier += 1) {
        const t = tier / Math.max(1, tiers - 1);
        const tierHeight = height * (0.62 - t * 0.14);
        const tierRadius = (0.56 - t * 0.26) * (0.82 + hash2d(i, 20) * 0.36);
        const geometry = new THREE.ConeGeometry(tierRadius, tierHeight, 9, 2);
        displaceGeometry(geometry, tierRadius * 0.14, i + tier * 5, 2.2);
        const crown = new THREE.Mesh(
          geometry,
          foliageMaterials[(i + tier) % foliageMaterials.length]
        );
        crown.position.y = height * (0.42 + t * 0.34) + tierHeight * 0.3;
        crown.rotation.y = hash2d(i + tier, 41) * Math.PI;
        crown.castShadow = true;
        tree.add(crown);
      }
    } else {
      const blobs = quality === "high" ? 5 : 3;
      for (let blob = 0; blob < blobs; blob += 1) {
        const radius = height * (0.24 + hash2d(i * 3 + blob, 20) * 0.14);
        const geometry = new THREE.IcosahedronGeometry(radius, 1);
        displaceGeometry(geometry, radius * 0.22, i * 3 + blob, 2.6);
        const crown = new THREE.Mesh(
          geometry,
          foliageMaterials[(i + blob) % foliageMaterials.length]
        );
        crown.position.set(
          (hash2d(i * 5 + blob, 43) - 0.5) * height * 0.5,
          height * (0.76 + blob * 0.1),
          (hash2d(i * 7 + blob, 47) - 0.5) * height * 0.5
        );
        crown.scale.set(1, 0.88 + hash2d(i + blob, 51) * 0.3, 1);
        crown.castShadow = true;
        tree.add(crown);
      }
    }
    group.add(tree);
  }

  // Riverbank reeds and grass tufts: thin instanced blades catch the low sun
  // and give the waterline a believable, lived-in edge.
  const reedMaterial = new THREE.MeshStandardMaterial({
    color: 0x5f6b3d,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const reedGeometry = new THREE.PlaneGeometry(0.06, 0.62, 1, 2);
  reedGeometry.translate(0, 0.31, 0);
  const reedCount = quality === "high" ? 150 : 80;
  const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, reedCount);
  reeds.name = "reeds";
  const dummy = new THREE.Object3D();
  for (let i = 0; i < reedCount; i += 1) {
    const bank = i % 2 === 0 ? -1 : 1;
    const x = (hash2d(i, 61) - 0.5) * 25;
    const z = bank * (1.62 + hash2d(i, 67) * 1.05);
    const nearBridge = BRIDGE_COLUMNS.some((column) => {
      const bridgeX = (column - (BOARD_COLUMNS - 1) / 2) * BOARD_SPACING.x;
      return Math.abs(x - bridgeX) < 1.5;
    });
    if (nearBridge) continue;
    const y = terrainHeightAt(x, z);
    dummy.position.set(x, y, z);
    dummy.rotation.set(
      (hash2d(i, 71) - 0.5) * 0.22,
      hash2d(i, 73) * Math.PI,
      (hash2d(i, 79) - 0.5) * 0.28
    );
    const scale = 0.45 + hash2d(i, 83) * 0.5;
    dummy.scale.set(1, scale, 1);
    dummy.updateMatrix();
    reeds.setMatrixAt(i, dummy.matrix);
  }
  reeds.instanceMatrix.needsUpdate = true;
  reeds.castShadow = false;
  reeds.receiveShadow = true;
  group.add(reeds);

  const bannerMaterialRed = new THREE.MeshBasicMaterial({
    map: makeBannerTexture("蜀"),
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const bannerMaterialBlack = new THREE.MeshBasicMaterial({
    map: makeBannerTexture("魏"),
    transparent: true,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  [
    [-10.2, 0, bannerMaterialRed],
    [10.2, 0, bannerMaterialBlack],
  ].forEach(([x, z, bannerMaterial]) => {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.06, 3.6, 8),
      materials.darkMetal
    );
    const y = terrainHeightAt(x, z);
    pole.position.set(x, y + 1.8, z);
    pole.castShadow = true;
    group.add(pole);

    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.8, 6, 6), bannerMaterial);
    banner.userData.basePositions = Float32Array.from(
      banner.geometry.attributes.position.array
    );
    banner.userData.phase = x < 0 ? 0.4 : 1.6;
    banner.position.set(x + (x < 0 ? 0.58 : -0.58), y + 2.7, z);
    group.add(banner);
  });

  // ---- 中景层: 两军营地 ----
  //
  // 为什么需要:
  //   原来只有"棋盘 + 外圈树林"两层, 中间是一大片什么都没有的空地
  //   (俯视图看得最清楚)。玩家的反馈是"战场显得很小气, 没有两军交战的
  //   宏大/大气感"。空旷本身不是问题, 问题是空旷里没有任何叙事线索 ——
  //   看不出这是两军对垒的战场, 只像一块放在地上的毯子。
  //
  // 这里加的是"两军各自的营地", 布局按真实扎营逻辑:
  //   · 红营在 +Z(红方身后), 黑营在 -Z(黑方身后), 各自背对己方棋阵
  //   · 每营有帅旗(最高)、两排错落的帐篷、拒马(防骑兵的木桩)
  //   · 靠近棋盘的那排帐篷压矮, 避免斜视角下遮住前排棋子
  buildCamps(group, bark, hash2d);

  return group;
}

/**
 * 生成两军营地。全部程序化, 不引入外部资源。
 * 红营在 +Z, 黑营在 -Z(与棋子阵营方向一致)。
 *
 * 尺度按玩家真实相机来定: 默认相机在 (±3.2, 21.4, ±28.6), 距棋盘中心 35 米、
 * 俯视约 37°。在这个视角下, 棋盘(15.8×15.3)在画面上只占中间一条,
 * 上下各留出大片地面 —— 那片地面就是"战场"该出现的地方。
 *
 * 所以营地要"小而成群、层层后退", 而不是"几个大帐篷":
 *   · 帐篷缩到 0.5~0.85(原来 0.85~1.3 太大, 挤到棋盘边上)
 *   · 三排纵深: 11.5 / 15.0 / 19.5, 越远越大, 形成透视压缩
 *   · 每排 9 顶, 密一点才像"连营", 稀疏的几顶反而显得空旷
 */
function buildCamps(group, bark, hash2d) {
  // 军帐用暗土黄/褐布色, 才能从黄土里"跳"出来
  const clothOf = (i) =>
    new THREE.MeshStandardMaterial({
      color: [0x6b5738, 0x745e3d, 0x5c4a30, 0x7d6644][i % 4],
      roughness: 0.94,
      side: THREE.DoubleSide,
    });

  for (const side of ["red", "black"]) {
    const dirZ = side === "red" ? 1 : -1;

    // 三排帐篷, 越远越大、越密, 用透视压缩制造"纵深很深的连营"
    const rows = [
      { z: 11.5, size: 0.52, count: 9, spread: 22 },
      { z: 15.2, size: 0.68, count: 9, spread: 24 },
      { z: 19.8, size: 0.86, count: 8, spread: 26 },
    ];
    rows.forEach((row, ri) => {
      for (let i = 0; i < row.count; i += 1) {
        const t = row.count === 1 ? 0.5 : i / (row.count - 1);
        const x = -row.spread / 2 + t * row.spread + (hash2d(i, 61 + ri) - 0.5) * 1.8;
        const z = dirZ * (row.z + hash2d(i, 62 + ri) * 1.4);
        const y = terrainHeightAt(x, z);
        const size = row.size * (0.85 + hash2d(i, 63 + ri) * 0.32);
        const tent = makeTent(size, clothOf(i + ri + (side === "red" ? 0 : 2)));
        tent.position.set(x, y, z);
        tent.rotation.y = hash2d(i, 64 + ri) * Math.PI * 2;
        group.add(tent);
      }
    });

    // 帅旗: 营地里唯一的"高物件", 用来交代这是哪一方的营盘
    const bannerX = side === "red" ? -12.6 : 12.6;
    const bannerZ = dirZ * 13.4;
    const banner = makeCampBanner(side);
    banner.position.set(bannerX, terrainHeightAt(bannerX, bannerZ), bannerZ);
    group.add(banner);

    // 拒马: 摆在营地朝向敌阵的一侧(棋盘和营地之间的那条带子),
    // 交代"这里在防骑兵"。高度压低, 避免在斜视角里挡住前排棋子。
    for (let i = 0; i < 6; i += 1) {
      const x = -12 + i * 4.8 + (hash2d(i, 71) - 0.5) * 1.4;
      const z = dirZ * (9.6 + hash2d(i, 72) * 0.6);
      const barricade = makeBarricade(bark);
      barricade.position.set(x, terrainHeightAt(x, z), z);
      barricade.rotation.y = (hash2d(i, 73) - 0.5) * 0.5;
      barricade.scale.setScalar(0.8);
      group.add(barricade);
    }
  }
}

/** 帐篷: 八角柱身 + 圆锥顶 + 顶旗杆 */
function makeTent(size, material) {
  const tent = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.62, size * 0.78, size * 0.55, 8),
    material
  );
  base.position.y = size * 0.28;
  base.castShadow = true;
  base.receiveShadow = true;
  tent.add(base);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(size * 0.86, size * 0.85, 8), material);
  roof.position.y = size * 0.72 + size * 0.42;
  roof.castShadow = true;
  tent.add(roof);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.028, size * 0.028, size * 0.5, 5),
    material
  );
  pole.position.y = size * 1.14 + size * 0.25;
  tent.add(pole);

  return tent;
}

/** 拒马: 三根交叉木桩 + 一根横杆 */
function makeBarricade(bark) {
  const bar = new THREE.Group();
  const size = 0.95;
  for (let i = 0; i < 3; i += 1) {
    const spike = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, size * 1.5, 6), bark);
    spike.position.set((i - 1) * size * 0.5, size * 0.62, 0);
    spike.rotation.z = (i - 1) * 0.38;
    spike.castShadow = true;
    bar.add(spike);
  }
  const cross = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, size * 2.1, 6), bark);
  cross.rotation.z = Math.PI / 2;
  cross.position.y = size * 0.72;
  cross.castShadow = true;
  bar.add(cross);
  return bar;
}

/** 营帅旗: 高杆 + 长条旗面(旗面交给 updateBoundaryDetails 做飘动) */
function makeCampBanner(side) {
  const group = new THREE.Group();
  const height = 4.6;

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.1, height, 7),
    new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.95 })
  );
  pole.position.y = height / 2;
  pole.castShadow = true;
  group.add(pole);

  const bannerMaterial = new THREE.MeshStandardMaterial({
    color: side === "red" ? 0xa8322c : 0x2f3a4d,
    roughness: 0.88,
    side: THREE.DoubleSide,
  });
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 2.5, 6, 10), bannerMaterial);
  flag.position.set(0.4, height - 1.5, 0);
  flag.castShadow = true;
  // 记下基准顶点, 交给 updateBoundaryDetails 做飘动
  flag.userData.basePositions = Float32Array.from(flag.geometry.attributes.position.array);
  flag.userData.phase = side === "red" ? 0 : 1.7;
  group.add(flag);

  const finial = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.34, 6),
    new THREE.MeshStandardMaterial({ color: 0x9a7b3f, roughness: 0.5, metalness: 0.6 })
  );
  finial.position.y = height + 0.15;
  group.add(finial);

  return group;
}

export function updateBoundaryDetails(group, time) {
  group.children.forEach((child) => {
    if (!child.userData.basePositions || !child.geometry) return;
    const position = child.geometry.attributes.position;
    const base = child.userData.basePositions;
    const phase = child.userData.phase ?? 0;
    for (let i = 0; i < position.count; i += 1) {
      const index = i * 3;
      const x = base[index];
      const y = base[index + 1];
      const wave = Math.sin(time * 1.7 + y * 3.1 + phase + x * 1.8) * 0.055;
      position.setZ(i, base[index + 2] + wave * (y + 0.9) * 0.45);
    }
    position.needsUpdate = true;
  });
}

function makeBannerTexture(glyph) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 400;
  const context = canvas.getContext("2d");
  context.fillStyle = glyph === "蜀" ? "#7d2722" : "#1f3033";
  context.fillRect(0, 0, 256, 400);
  context.strokeStyle = "#c99a4d";
  context.lineWidth = 8;
  context.strokeRect(10, 10, 236, 380);
  context.fillStyle = "#efd9ab";
  context.font = '700 130px "KaiTi", "STKaiti", serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, 128, 210);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
