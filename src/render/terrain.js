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

/**
 * 远山专用位移: 与 displaceGeometry 的区别是沿高度衰减扰动量。
 *
 * 锥体顶点的法线是奇异的, 逐顶点沿法线推会产生针状尖刺, 远看像一排锯齿。
 * 这里让扰动量在山脚最大、接近峰顶时收敛到 0, 于是峰线保持干净, 而山体
 * 中下段仍然是不规则的岩壁。
 */
function displaceRidgeGeometry(geometry, amount, seed = 0, frequency = 0.9) {
  const position = geometry.attributes.position;
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const normals = geometry.attributes.normal;

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1e-4, maxY - minY);

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const t = (y - minY) / span; // 0 山脚, 1 峰顶

    const noise =
      fbm(x * frequency + seed * 3.7, z * frequency - seed * 2.1) * 0.62 +
      fbm(y * frequency * 2.3 + seed * 1.3, x * frequency * 1.7 + seed) * 0.38;

    // 顶部收敛: t=0 时满幅, t=1 时几乎不动。
    const taper = 1 - smoothstep(0.62, 1, t);
    const offset = (noise - 0.5) * 2 * amount * taper;

    position.setXYZ(
      i,
      x + normals.getX(i) * offset,
      y + normals.getY(i) * offset * 0.35, // 纵向少推, 避免峰顶被拉长成尖刺
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
    // 河岸草皮: 湿度高的地方把土壤往草绿推。
    //
    // 为什么走顶点色而不是种立体的草叶: 这是俯视棋类, 默认相机在 21 米高。
    // 竖直的草叶平面在俯视下只能看到"侧棱", 无论做多宽都渲染成一条线 ——
    // 铺得越多越像一地黑刺 (实测加宽+提亮+增密都没有改善观感)。
    // 俯视视角下"草"正确的载体是地面的颜色, 立体草叶只作为低视角时的补充。
    //
    // 边界扰动: 直接拿 moisture 当草量会得到一条与河岸平行、边缘锐利的绿带
    // (近景看像泼了一道绿漆)。真实的河岸草线是犬牙交错的 —— 用一层独立噪声
    // 去扰动湿润度, 让草绿有选择地渗进旱地, 边缘就有了自然的斑点过渡。
    const edgeNoise = (fbm(x * 0.9 - 3, z * 0.9 + 5) - 0.5) * 0.85;
    const moistNoisy = THREE.MathUtils.clamp(moisture + edgeNoise * moisture, 0, 1);
    const grass = moistNoisy * (0.5 + fbm(x * 3.1 + 11, z * 3.1 - 6) * 0.5);
    const soilR = 0.56 + variation * 0.15 - moisture * 0.08 - grass * 0.24;
    const soilG = 0.47 + variation * 0.12 - moisture * 0.02 + grass * 0.11;
    const soilB = 0.32 + variation * 0.09 - moisture * 0.1 - grass * 0.1;

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
  // 河床卵石专用材质: 比岸上的石材更暖、更亮。
  //
  // 为什么不能直接用 materials.stone / stoneDark: 水是 transmission 0.42 的
  // 半透明面, 透过它看到的石头会被水色(0x1d5a5c, 冷青)再压一层。岸上石材的
  // 灰褐色 #726c60 经过这层青水之后变成又暗又脏的冷灰斑块, 近景看像河里沉着
  // 一堆煤渣, 与整体黄昏暖调完全脱节。
  //
  // 注意: 单纯把水下的石头调亮是**无效**的。水面在 y=0, 石头压在 y=-0.6,
  // opacity 0.88 意味着只有约 12% 的直射光语义能穿透水面被相机读到, 画面里
  // 看到的基本是水的吸收色而非石头本身的颜色。所以「提亮卵石材质」这条路
  // 已经被实测证否(见 docs/ART_BRIEF.md 的河床条目), 正确做法是让石头
  // **露出水面**: 石头一旦破面, 它的明度与暖度才真正进入画面。
  const pebbleMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9a480,
    roughness: 0.7,
    metalness: 0.02,
  });
  const pebbleGeometry = new THREE.DodecahedronGeometry(0.07, 0);
  for (let i = 0; i < 150; i += 1) {
    const pebble = new THREE.Mesh(pebbleGeometry, pebbleMaterial);
    pebble.position.set(
      (Math.random() - 0.5) * 24,
      // 破水线: -0.10 ~ +0.09 让约四成石头露出水面, 其余半淹。
      // 河床在 -0.72, 水面在 0 —— 0.62 的浅滩里石头露头是物理诚实的。
      -0.10 + Math.random() * 0.19,
      (Math.random() - 0.5) * 2.9
    );
    pebble.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    pebble.scale.set(
      0.6 + Math.random() * 1.4,
      0.5 + Math.random() * 0.6,
      0.6 + Math.random() * 1.4
    );
    pebble.castShadow = true;
    pebble.receiveShadow = true;
    pebbles.add(pebble);
  }

  // Wet boulders breaking the current.
  const boulderMaterial = new THREE.MeshStandardMaterial({
    color: 0xa89272,
    roughness: 0.62,
    metalness: 0.03,
  });
  for (let i = 0; i < 14; i += 1) {
    const boulder = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.22, 1),
      boulderMaterial
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

        // 柱头: 中式石桥的望柱头。
        //
        // 旧实现是压扁的球体 (SphereGeometry + scale.y=0.7), 近看就是一颗
        // 光滑鹅卵石 —— 石材不该是这种圆润无棱的形态。
        // 改成方础 + 收分覆斗 + 顶部小方台: 三段方几何堆出有棱角的望柱头,
        // 与栏杆方柱的语言一致, 且面数比球体更低 (方盒 12 tri vs 球 120 tri)。
        const capBase = new THREE.Mesh(
          new THREE.BoxGeometry(0.24, 0.07, 0.24, 1, 1, 1),
          materials.stone
        );
        capBase.position.set(side * (bridgeWidth * 0.5 + 0.03), 0.775, i * 1.28);
        capBase.castShadow = true;
        bridge.add(capBase);

        // 覆斗: 上小下大的四棱台, 用 4 段圆柱近似 (顶面 4 边形 -> 棱台)
        const capTaper = new THREE.Mesh(
          new THREE.CylinderGeometry(0.075, 0.115, 0.13, 4, 1),
          materials.stoneDark
        );
        capTaper.rotation.y = Math.PI / 4; // 让方边与柱身对齐
        capTaper.position.set(side * (bridgeWidth * 0.5 + 0.03), 0.875, i * 1.28);
        capTaper.castShadow = true;
        bridge.add(capTaper);

        const capTop = new THREE.Mesh(
          new THREE.BoxGeometry(0.1, 0.05, 0.1, 1, 1, 1),
          materials.stone
        );
        capTop.position.set(side * (bridgeWidth * 0.5 + 0.03), 0.962, i * 1.28);
        capTop.castShadow = true;
        bridge.add(capTop);
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

/**
 * 远山山脊。设计要点（每条都对应一个"一眼假"的失效模式）:
 *
 * 1. 高分段锥体 (径向 18~26, 高度 7)。旧实现只有 5~8 段, 山体就是几块平直大
 *    面片拼的锥子, 轮廓生硬。
 * 2. 平滑着色 + 逐顶点色。平坦着色会把每块面片照成同样的亮度, 远山变成刺眼的
 *    色块; 改为按海拔做色带后, 山脚压暗、山腰过渡、山顶提亮, 读起来才有体积。
 * 3. 强扰动。扰动量与锥半径挂钩, 让山脊线不规则, 避免整齐的锥形轮廓。
 * 4. 大气透视。逐顶点沿高度向雾色混合, 越远越淡, 与天空自然衔接, 而不是
 *    "贴"在天上的一排剪影。
 *
 * 全部是几何与顶点色参数, 不增加任何外部资源体积。
 */
export function createDistantRidges(materials, quality = "high") {
  const group = new THREE.Group();
  group.name = "distant-ridges";

  const high = quality !== "low";
  // 大气色: 跟随新天空背景板 (暖金夕照) 的雾色。远山是逆光剪影, 底色偏暖灰紫,
  // 而不是冷青绿 —— 冷色山体压在暖色天空下会明显割裂。
  const haze = new THREE.Color(0xb08a72);

  const layers = [
    {
      // 远层: 更淡更接近天色, 被夕阳的散射吃掉最多
      foot: new THREE.Color(0x33403f),
      mid: new THREE.Color(0x4a5050),
      peak: new THREE.Color(0x6b635c),
      count: high ? 26 : 14,
      radius: 43,
      height: 7.6,
      base: -0.9,
      spread: 1.7,
      depth: 1.9,
      hazeMix: 0.34,
      radial: high ? 20 : 12,
    },
    {
      // 近层: 更实更暗, 保留可辨认的岩体结构
      foot: new THREE.Color(0x2f3a36),
      mid: new THREE.Color(0x424a44),
      peak: new THREE.Color(0x5e5a4e),
      count: high ? 22 : 12,
      radius: 37,
      height: 5.4,
      base: -0.76,
      spread: 1.5,
      depth: 1.5,
      hazeMix: 0.2,
      radial: high ? 18 : 10,
    },
  ];

  layers.forEach((layer, layerIndex) => {
    // 远山用 MeshLambertMaterial 而不是 MeshStandardMaterial。
    //
    // 为什么: Standard 是 PBR 材质, roughness=1/metalness=0 时会全量接收
    // scene.environment 的 IBL。本场景的 HDRI 环境强度 0.62, 会把哪怕顶点色
    // 只有 RGB(39,54,52) 的山体整体提亮成灰白, 看起来像雪山/石膏, 与暖调
    // 前景完全打架。Far mountain 不需要金属度/清漆这类 PBR 特性, 用 Lambert
    // 只吃方向光 + 环境光底色, 山体的明暗就由我们写入的顶点色主导。
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff, // 颜色全部走顶点色
      vertexColors: true,
      emissive: layer.foot.clone().multiplyScalar(0.35),
      fog: true,
    });

    for (let i = 0; i < layer.count; i += 1) {
      const angle =
        Math.PI * 0.88 + (i / Math.max(1, layer.count - 1)) * Math.PI * 1.24;
      const distance = layer.radius + (hash2d(i, layerIndex * 9) - 0.5) * layer.spread * 3;
      const height = layer.height * (0.5 + hash2d(i, 31) * 0.9);
      const radius = height * (0.46 + hash2d(i, 44) * 0.24);

      // 多个重叠位移的山峰读起来像一条真山脊, 而不是一排明显的锥子。
      const stack = new THREE.Group();
      const peakCount = high ? 3 : 2;
      for (let p = 0; p < peakCount; p += 1) {
        const peakHeight = height * (p === 0 ? 1 : 0.52 + hash2d(i * 7 + p, 61) * 0.34);
        const peakRadius = radius * (p === 0 ? 1 : 0.66 + hash2d(i * 5 + p, 73) * 0.3);
        const geometry = new THREE.ConeGeometry(
          peakRadius,
          peakHeight,
          layer.radial,
          high ? 7 : 4 // 高度分段: 让位移沿山体纵向也有变化
        );
        displaceRidgeGeometry(geometry, peakRadius * 0.5, i * 3 + p, 0.85);

        applyRidgeVertexColors(geometry, layer, haze, hash2d(i * 19 + p, 55));

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

/**
 * 给远山几何体写入逐顶点色: 山脚 -> 山腰 -> 山顶的三段色带, 再整体向大气雾色
 * 混合, 形成远淡近浓的空气透视。没有顶点色的远山会是一块均匀的剪影。
 */
function applyRidgeVertexColors(geometry, layer, haze, tint = 0.5) {
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const color = new THREE.Color();
  const localHaze = haze.clone().lerp(
    new THREE.Color(0x9fb2ad),
    tint * 0.35
  );

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(1e-4, maxY - minY);

  for (let i = 0; i < position.count; i += 1) {
    const t = (position.getY(i) - minY) / span; // 0 = 山脚, 1 = 山顶
    if (t < 0.55) {
      color.copy(layer.foot).lerp(layer.mid, smoothstep(0, 0.55, t));
    } else {
      color.copy(layer.mid).lerp(layer.peak, smoothstep(0.55, 1, t));
    }
    // 空气透视: 越靠近峰顶越吃雾色, 山体自然融进天空。
    color.lerp(localHaze, layer.hazeMix * (0.35 + t * 0.65));
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
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

  // 河岸草丛。
  //
  // 这一段被推翻重做过三次, 过程值得记下来。
  //
  // 最初的实现是"150 片竖直窄叶均匀随机撒点", 俯视像一地牙签。
  // 第二次改成成簇 (簇心 + 8 片叶 + 枯荣顶点色), 近景变好但俯视仍是黑刺。
  // 第三次尝试加宽(0.16)压矮(0.5)并提亮颜色、加密到 130 簇 —— 反而更糟,
  // 俯视变成一排排黑色短横线。
  //
  // 三次都失败的原因不是参数, 是几何本身: **竖直平面在俯视下只能看到侧棱**,
  // 无论多宽多亮, 投影永远是一条线; 而在近景低机位, 叶片背光面又会整片
  // 渲染成黑块。也就是说这种几何在任何机位都读不出"草"。
  //
  // 结论: 草的载体是地面顶点色 (见 createTerrain 里的 grass 项), 立体几何
  // 只能做成"贴地草丛"—— 高度压到几乎为零, 靠一小片贴地的浅色斑块提供
  // 近景的草丛暗示, 而不是竖起来当叶片用。
  const reedMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    toneMapped: true,
  });
  // 贴地草丛: 一个近水平的窄矩形, 根部略窄、尖端略宽, 整体贴地。
  // 用 MeshBasicMaterial 而非 Standard: 它只作为地面色斑存在, 不需要再参与
  // 光照计算 —— 参与光照反而会在背光侧压暗成黑块 (这正是前几版的问题)。
  const reedGeometry = new THREE.PlaneGeometry(0.42, 0.26, 2, 1);
  reedGeometry.rotateX(-Math.PI / 2); // 放平, 贴地
  reedGeometry.translate(0, 0.012, 0); // 抬高 12mm 避免与地面 z-fighting
  {
    // 边缘做一点不规则: 让贴地草丛不是死板的矩形
    const pos = reedGeometry.attributes.position;
    for (let i = 0; i < pos.count; i += 1) {
      const px = pos.getX(i);
      const pz = pos.getZ(i);
      // 越靠外的顶点收得越窄, 形成一个梭形
      const taper = 1 - Math.abs(pz / 0.13) * 0.35;
      pos.setX(i, px * taper);
    }
    pos.needsUpdate = true;
  }

  // 枯荣色带: 整体提亮并偏向黄昏暖光, 与地面草绿的顶点色衔接。
  //
  // 注意材质是 MeshBasicMaterial (不参与光照), 所以这些色值**直接就是屏幕上
  // 的最终颜色**, 没有灯光增益。第一版沿用了 Standard 材质时期的色值
  // (0x7d8a4a 一类), 结果在画面上呈现为一块块深色泥斑而不是草。
  // 这里整体往亮、往暖推, 让它读作"被夕阳照到的草皮"。
  const REED_TONES = [
    new THREE.Color(0xa8b46a),
    new THREE.Color(0xb6bd76),
    new THREE.Color(0xc2c182),
    new THREE.Color(0xcfc68e),
    new THREE.Color(0xafb96e),
    new THREE.Color(0xd8ca96),
  ];

  const tuftCount = quality === "high" ? 62 : 30;
  const bladesPerTuft = quality === "high" ? 8 : 6;
  const reedCount = tuftCount * bladesPerTuft;
  const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, reedCount);
  reeds.name = "reeds";
  reeds.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(reedCount * 3),
    3
  );

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  let instance = 0;

  for (let t = 0; t < tuftCount; t += 1) {
    // 簇心分布: 七成贴河岸 (水边草最密), 三成散到离河较远的旱地。
    const bank = t % 2 === 0 ? -1 : 1;
    const farTuft = hash2d(t, 137) > 0.7;
    const cx = (hash2d(t, 61) - 0.5) * 28;
    const cz = farTuft
      ? bank * (2.6 + hash2d(t, 67) * 3.4) // 旱地散点
      : bank * (1.5 + hash2d(t, 67) * 1.5); // 近岸密生
    const nearBridge = BRIDGE_COLUMNS.some((column) => {
      const bridgeX = (column - (BOARD_COLUMNS - 1) / 2) * BOARD_SPACING.x;
      return Math.abs(cx - bridgeX) < 1.6;
    });
    if (nearBridge) {
      // 桥位让空: 这些实例留成零缩放, 视觉上不存在
      for (let b = 0; b < bladesPerTuft; b += 1) {
        dummy.position.set(0, -50, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        reeds.setMatrixAt(instance, dummy.matrix);
        reeds.setColorAt(instance, tmpColor.setHex(0x000000));
        instance += 1;
      }
      continue;
    }

    // 整簇共用一个基调色, 簇间才有枯荣差异
    const tone = REED_TONES[Math.floor(hash2d(t, 89) * REED_TONES.length) % REED_TONES.length];
    const tuftSpread = 0.22 + hash2d(t, 91) * 0.2;

    for (let b = 0; b < bladesPerTuft; b += 1) {
      // 斑块在簇心附近聚集, 椭圆分布
      const a = hash2d(t * 13 + b, 97) * Math.PI * 2;
      const r = Math.sqrt(hash2d(t * 17 + b, 101)) * tuftSpread;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r * 0.8;
      const y = terrainHeightAt(x, z);

      // 贴地: 只绕 Y 轴旋转 + 轻微倾斜, 让斑块顺着地形起伏
      dummy.position.set(x, y - 0.01, z);
      dummy.rotation.set(
        (hash2d(t * 19 + b, 71) - 0.5) * 0.12,
        hash2d(t * 23 + b, 73) * Math.PI * 2,
        (hash2d(t * 29 + b, 79) - 0.5) * 0.12
      );
      const s = 0.6 + hash2d(t * 31 + b, 83) * 0.75;
      dummy.scale.set(s, 1, s * (0.7 + hash2d(t * 37 + b, 87) * 0.6));
      dummy.updateMatrix();
      reeds.setMatrixAt(instance, dummy.matrix);

      // 簇内也做轻微明暗差, 避免整簇一个色
      tmpColor.copy(tone).multiplyScalar(0.84 + hash2d(t * 41 + b, 103) * 0.32);
      reeds.setColorAt(instance, tmpColor);
      instance += 1;
    }
  }

  reeds.instanceMatrix.needsUpdate = true;
  if (reeds.instanceColor) reeds.instanceColor.needsUpdate = true;
  reeds.castShadow = false;
  reeds.receiveShadow = false; // 贴地色斑不参与阴影, 避免自阴影变黑
  reeds.renderOrder = 1;
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

/** 军帐: 八角柱身 + 攒尖帐顶 + 顶旗杆
 *
 * 原来的顶是一个 "完美圆锥": roofH / roofR 恰好 = 0.85/0.86 = 0.99,
 * 半顶角 45.3°, 且锥底半径(0.86 size)大于柱身顶半径(0.62 size),
 * 形成一圈外挑檐; 锥底平面又浮在柱身顶面之上。近景看过去就是一顶
 * 现代露营圆顶帐 / 倒扣的碗。
 *
 * 中式军帐不是圆锥:
 *   · 攒尖顶(sì jiǎo zǎn jiān)四坡向上收拢, 脊线挺直, 半顶角要陡得多
 *   · 屋面比墙体大出一圈形成檐口, 但檐口必须**贴着**墙顶, 不能悬空
 *   · 顶部收成一个短小的宝顶/旗杆座, 而不是尖点
 * 这里按这个结构重做: 4 面攒尖(segments=4) + 无缝檐口 + 宝顶。
 */
function makeTent(size, material) {
  const tent = new THREE.Group();

  // 墙体: 略收分(下大上小), 八角。
  const baseHeight = size * 0.58;
  const wallTop = baseHeight / 2;
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.64, size * 0.78, baseHeight, 8),
    material
  );
  base.position.y = wallTop;
  base.castShadow = true;
  base.receiveShadow = true;
  tent.add(base);

  // 攒尖顶: 4 面, 陡坡。檐口半径大于墙顶, 但底沿**落在墙顶上**。
  const eaveY = wallTop + baseHeight / 2;
  const eaveRadius = size * 0.70;
  const roofHeight = size * 0.62;
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(eaveRadius, roofHeight, 4, 1),
    material
  );
  // ConeGeometry 的原点在几何中心, 所以下移半个高度让锥底落在 eaveY。
  roof.position.y = eaveY + roofHeight / 2;
  // 四坡的角对准墙体八角, 转 45° 让坡面对着正方向更好看。
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.receiveShadow = true;
  tent.add(roof);

  // 檐口压边: 一圈薄八角环, 把屋面与墙体的接缝盖住(悬空感的来源)。
  const eave = new THREE.Mesh(
    new THREE.CylinderGeometry(eaveRadius * 1.02, eaveRadius * 1.02, size * 0.045, 8),
    material
  );
  eave.position.y = eaveY;
  eave.castShadow = true;
  tent.add(eave);

  // 宝顶: 短圆柱座 + 小方顶, 顶住旗杆。收尖而不留尖刺。
  const finialBase = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.075, size * 0.095, size * 0.10, 6),
    material
  );
  finialBase.position.y = eaveY + roofHeight + size * 0.03;
  tent.add(finialBase);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(size * 0.022, size * 0.022, size * 0.42, 5),
    material
  );
  pole.position.y = eaveY + roofHeight + size * 0.22;
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
