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
