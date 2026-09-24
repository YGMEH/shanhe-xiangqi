import * as THREE from "three";

export function addMesh(
  parent,
  geometry,
  material,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1]
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function box(parent, material, size, position = [0, 0, 0], rotation = [0, 0, 0]) {
  return addMesh(
    parent,
    new THREE.BoxGeometry(...size),
    material,
    position,
    rotation
  );
}

export function cylinder(
  parent,
  material,
  radii,
  height,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  segments = 10
) {
  return addMesh(
    parent,
    new THREE.CylinderGeometry(radii[0], radii[1], height, segments),
    material,
    position,
    rotation
  );
}

export function sphere(
  parent,
  material,
  radius,
  position = [0, 0, 0],
  scale = [1, 1, 1],
  segments = 14
) {
  return addMesh(
    parent,
    new THREE.SphereGeometry(radius, segments, Math.max(8, segments / 2)),
    material,
    position,
    [0, 0, 0],
    scale
  );
}

export function cone(
  parent,
  material,
  radius,
  height,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  segments = 10
) {
  return addMesh(
    parent,
    new THREE.ConeGeometry(radius, height, segments),
    material,
    position,
    rotation
  );
}

export function capsule(
  parent,
  material,
  radius,
  length,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  segments = 10
) {
  return addMesh(
    parent,
    new THREE.CapsuleGeometry(radius, length, 4, segments),
    material,
    position,
    rotation
  );
}

export function makeLabelTexture(glyph, side) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, 256, 256);

  const gradient = context.createRadialGradient(128, 116, 30, 128, 128, 124);
  gradient.addColorStop(0, side === "red" ? "#3b1714" : "#101d20");
  gradient.addColorStop(1, side === "red" ? "#7c2923" : "#26383b");
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(128, 128, 112, 0, Math.PI * 2);
  context.fill();

  context.lineWidth = 13;
  context.strokeStyle = "#daae5b";
  context.beginPath();
  context.arc(128, 128, 101, 0, Math.PI * 2);
  context.stroke();

  context.fillStyle = side === "red" ? "#ffe0c6" : "#e3f0e9";
  context.font = '700 132px "KaiTi", "STKaiti", serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(glyph, 128, 142);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * 阵营色带贴图: 程序化绘制中式「回纹」(雷纹) 连续纹样。
 *
 * 为什么需要: 底座最外圈那条高饱和阵营色环是远镜头下区分红/黑双方的第一识别
 * 信息, 但它原先只是一条纯色 MeshStandardMaterial —— 近看就是一圈塑料。加上
 * 回纹后近景有细节可读, 远景仍然是一条清晰的色带 (纹样明度差控制得很小,
 * 缩到几个像素时会自然糊成纯色, 不影响远距离辨识)。
 *
 * 用 canvas 实时画而非位图资产: 零传输体积、任意分辨率、色值可随阵营调。
 */
export function makeFactionBandTexture(side) {
  const W = 512;
  const H = 64;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const context = canvas.getContext("2d");

  const base = side === "red" ? "#b8392c" : "#2f7f96";
  const deep = side === "red" ? "#7d1f16" : "#1b5566";
  const bright = side === "red" ? "#e8674f" : "#63c2d8";

  // 底色 + 上下压暗, 让色带本身有厚度感
  const grad = context.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, deep);
  grad.addColorStop(0.34, base);
  grad.addColorStop(0.66, base);
  grad.addColorStop(1, deep);
  context.fillStyle = grad;
  context.fillRect(0, 0, W, H);

  // 连续回纹: 一个单元 = 方形螺旋, 沿水平方向平铺
  const unit = 32;
  const step = 9;
  context.lineWidth = 2.6;
  context.strokeStyle = bright;
  context.globalAlpha = 0.34;
  for (let x0 = 0; x0 < W; x0 += unit) {
    const cy = H / 2;
    context.beginPath();
    // 由外到内的方形螺旋
    let x = x0 + 5;
    let y = cy - (unit / 2 - 6);
    let w = unit - 10;
    let h = unit - 12;
    context.moveTo(x, y);
    for (let k = 0; k < 3; k += 1) {
      context.lineTo(x + w, y);
      context.lineTo(x + w, y + h);
      context.lineTo(x + step, y + h);
      context.lineTo(x + step, y + step * 2);
      x += step * 2;
      y += step * 2;
      w -= step * 4;
      h -= step * 4;
      if (w <= step || h <= step) break;
    }
    context.stroke();
  }
  context.globalAlpha = 1;

  // 顶部一道细高光, 模拟漆面受光
  context.fillStyle = "rgba(255, 236, 200, 0.16)";
  context.fillRect(0, 2, W, 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  // 底座圆周约 2π×0.61 ≈ 3.83 世界单位, 重复 6 次让纹样在近景可辨
  texture.repeat.set(6, 1);
  texture.anisotropy = 8;
  return texture;
}

export function setShadow(group, cast = true) {
  group.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = cast;
      object.receiveShadow = true;
    }
  });
}

export function disposeObject(object) {
  object.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material?.map && material.userData.ownedTexture) material.map.dispose();
      material?.dispose?.();
    });
  });
}
