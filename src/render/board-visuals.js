import * as THREE from "three";
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  PIECE_TYPES,
  SIDES,
} from "../game/constants.js";
import { BOARD_SPACING, boardPosition, terrainNormalAt } from "./terrain.js";

export function createBoardVisuals(materials) {
  const group = new THREE.Group();
  group.name = "board-visuals";
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0x8d7648,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const secondaryLineMaterial = new THREE.MeshBasicMaterial({
    color: 0x7d6a45,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });

  const nodes = [];
  for (let y = 0; y < BOARD_ROWS; y += 1) {
    for (let x = 0; x < BOARD_COLUMNS; x += 1) {
      const position = boardPosition(x, y);
      const height = terrainHeightAtBoard(x, y) + 0.018;
      nodes.push(new THREE.Vector3(position.x, height, position.z));
    }
  }

  for (let y = 0; y < BOARD_ROWS; y += 1) {
    const points = [];
    for (let x = 0; x < BOARD_COLUMNS; x += 1) points.push(nodes[y * BOARD_COLUMNS + x]);
    group.add(createGroundRibbon(points, 0.035, lineMaterial));
  }

  for (let x = 0; x < BOARD_COLUMNS; x += 1) {
    if (x === 0 || x === BOARD_COLUMNS - 1) {
      const points = [];
      for (let y = 0; y < BOARD_ROWS; y += 1) points.push(nodes[y * BOARD_COLUMNS + x]);
      group.add(createGroundRibbon(points, 0.035, lineMaterial));
    } else {
      group.add(
        createGroundRibbon(
          Array.from({ length: 5 }, (_, y) => nodes[y * BOARD_COLUMNS + x]),
          0.03,
          secondaryLineMaterial
        )
      );
      group.add(
        createGroundRibbon(
          Array.from({ length: 5 }, (_, i) => nodes[(i + 5) * BOARD_COLUMNS + x]),
          0.03,
          secondaryLineMaterial
        )
      );
    }
  }

  const palaceMarkers = [];
  [
    [3, 0, 5, 2],
    [5, 0, 3, 2],
    [3, 7, 5, 9],
    [5, 7, 3, 9],
  ].forEach(([x1, y1, x2, y2]) => {
    palaceMarkers.push(
      createGroundRibbon(
        [nodePosition(x1, y1, 0), nodePosition(x2, y2, 0)],
        0.03,
        lineMaterial
      )
    );
  });
  palaceMarkers.forEach((marker) => group.add(marker));

  // Carved node markers read the intersections from a low tactical camera.
  const nodeGeometry = new THREE.RingGeometry(0.055, 0.095, 16);
  nodeGeometry.rotateX(-Math.PI / 2);
  const nodeMaterial = new THREE.MeshBasicMaterial({
    color: 0xa08a58,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const nodeMarkers = new THREE.InstancedMesh(nodeGeometry, nodeMaterial, nodes.length);
  nodeMarkers.name = "board-nodes";
  const markerDummy = new THREE.Object3D();
  nodes.forEach((node, index) => {
    markerDummy.position.copy(node);
    markerDummy.position.y += 0.045;
    const y = Math.floor(index / BOARD_COLUMNS);
    const x = index % BOARD_COLUMNS;
    const normal = getSurfaceNormal(x, y);
    markerDummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    markerDummy.updateMatrix();
    nodeMarkers.setMatrixAt(index, markerDummy.matrix);
  });
  nodeMarkers.instanceMatrix.needsUpdate = true;
  group.add(nodeMarkers);

  const riverInscription = createTextPlane("楚 河", 4.8, 0.92, 0xd8e2d2);
  riverInscription.position.set(-3.1, -0.19, 0);
  riverInscription.material.opacity = 0.84;
  riverInscription.rotation.x = -Math.PI / 2;
  riverInscription.rotation.z = Math.PI / 2;
  group.add(riverInscription);

  const riverInscriptionTwo = createTextPlane("汉 界", 4.8, 0.92, 0xd8e2d2);
  riverInscriptionTwo.position.set(3.1, -0.19, 0);
  riverInscriptionTwo.material.opacity = 0.84;
  riverInscriptionTwo.rotation.x = -Math.PI / 2;
  riverInscriptionTwo.rotation.z = Math.PI / 2;
  group.add(riverInscriptionTwo);

  const markerGeometry = new THREE.RingGeometry(0.28, 0.39, 28);
  markerGeometry.rotateX(-Math.PI / 2);
  const moveMarker = new THREE.Mesh(
    markerGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xd6b05b,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  moveMarker.visible = false;
  moveMarker.renderOrder = 3;
  group.add(moveMarker);

  const captureGeometry = new THREE.RingGeometry(0.48, 0.55, 32);
  captureGeometry.rotateX(-Math.PI / 2);
  const captureMarker = new THREE.Mesh(
    captureGeometry,
    new THREE.MeshBasicMaterial({
      color: 0xff6d5c,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  captureMarker.visible = false;
  captureMarker.renderOrder = 3;
  group.add(captureMarker);

  const targetGeometry = new THREE.RingGeometry(0.16, 0.24, 20);
  targetGeometry.rotateX(-Math.PI / 2);
  const targetMaterial = new THREE.MeshBasicMaterial({
    color: 0xff8271,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const targetMarkers = [];
  for (let i = 0; i < 12; i += 1) {
    const marker = new THREE.Mesh(targetGeometry, targetMaterial.clone());
    marker.visible = false;
    marker.renderOrder = 3;
    group.add(marker);
    targetMarkers.push(marker);
  }

  const selectionRing = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.68, 40),
    new THREE.MeshBasicMaterial({
      color: 0xf1c46b,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
  );
  selectionRing.rotation.x = -Math.PI / 2;
  selectionRing.visible = false;
  selectionRing.renderOrder = 3;
  group.add(selectionRing);

  const warningRings = [];
  for (let i = 0; i < 2; i += 1) {
    const warningRing = new THREE.Mesh(
      new THREE.RingGeometry(0.7, 0.78, 40),
      new THREE.MeshBasicMaterial({
        color: 0xff413a,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    warningRing.rotation.x = -Math.PI / 2;
    warningRing.visible = false;
    warningRing.renderOrder = 3;
    group.add(warningRing);
    warningRings.push(warningRing);
  }

  return {
    group,
    moveMarker,
    captureMarker,
    targetMarkers,
    selectionRing,
    warningRings,
    nodes,
    update(time) {
      moveMarker.rotation.y = time * 0.48;
      const pulse = 0.95 + Math.sin(time * 4.8) * 0.08;
      moveMarker.scale.setScalar(pulse);
      captureMarker.rotation.y = -time * 0.35;
      captureMarker.scale.setScalar(0.98 + Math.sin(time * 4.1) * 0.06);
      selectionRing.scale.setScalar(0.96 + Math.sin(time * 3.6) * 0.055);
      warningRings.forEach((warningRing) => {
        warningRing.rotation.y = time * 0.7;
        warningRing.material.opacity = 0.62 + Math.sin(time * 7) * 0.28;
      });
      targetMarkers.forEach((marker, index) => {
        if (marker.visible) {
          marker.scale.setScalar(0.92 + Math.sin(time * 5 + index) * 0.1);
        }
      });
    },
  };
}

export function showMoveMarkers(visuals, moves) {
  let moveIndex = 0;
  let targetIndex = 0;
  visuals.moveMarker.visible = false;
  visuals.captureMarker.visible = false;
  visuals.targetMarkers.forEach((marker) => (marker.visible = false));

  moves.forEach((move) => {
    const position = nodePosition(move.x, move.y, 0.035);
    if (move.captured) {
      visuals.captureMarker.visible = true;
      visuals.captureMarker.position.copy(position);
      if (move.kind === "cannon") {
        const target = visuals.targetMarkers[targetIndex++];
        if (target) {
          target.visible = true;
          target.position.copy(position);
        }
      }
    } else if (moveIndex === 0) {
      visuals.moveMarker.visible = true;
      visuals.moveMarker.position.copy(position);
      moveIndex += 1;
    } else {
      const target = visuals.targetMarkers[targetIndex++];
      if (target) {
        target.visible = true;
        target.position.copy(position);
      }
    }
  });
}

export function clearMoveMarkers(visuals) {
  visuals.moveMarker.visible = false;
  visuals.captureMarker.visible = false;
  visuals.selectionRing.visible = false;
  visuals.warningRings.forEach((ring) => (ring.visible = false));
  visuals.targetMarkers.forEach((marker) => (marker.visible = false));
}

export function nodePosition(x, y, offset = 0) {
  const position = boardPosition(x, y);
  return new THREE.Vector3(
    position.x,
    terrainHeightAtBoard(x, y) + offset,
    position.z
  );
}

/**
 * Convert a polyline into a thin strip that hugs the terrain. Subdividing each
 * segment and resampling the height keeps the board lines from floating over
 * slopes, which is what made them read as wire strung above the ground.
 */
function createGroundRibbon(points, width, material) {
  const positions = [];
  const indices = [];
  const halfWidth = width * 0.5;
  const subdivisions = 6;
  let vertexCount = 0;

  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const start = points[segment];
    const end = points[segment + 1];
    const direction = new THREE.Vector2(end.x - start.x, end.z - start.z);
    if (direction.lengthSq() < 1e-6) continue;
    direction.normalize();
    const normalX = -direction.y * halfWidth;
    const normalZ = direction.x * halfWidth;

    for (let step = 0; step <= subdivisions; step += 1) {
      const t = step / subdivisions;
      const x = THREE.MathUtils.lerp(start.x, end.x, t);
      const z = THREE.MathUtils.lerp(start.z, end.z, t);
      const y = terrainHeightAtBoardWorld(x, z) + 0.035;
      positions.push(x - normalX, y, z - normalZ);
      positions.push(x + normalX, y, z + normalZ);
      vertexCount += 2;
    }
  }

  for (let segment = 0; segment < points.length - 1; segment += 1) {
    const base = segment * (subdivisions + 1) * 2;
    for (let step = 0; step < subdivisions; step += 1) {
      const a = base + step * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return mesh;
}

function terrainHeightAtBoardWorld(x, z) {
  return heightAtWorld(x, z);
}

export function terrainHeightAtBoard(x, y) {
  const position = boardPosition(x, y);
  return heightAtWorld(position.x, position.z);
}

let heightAtWorld = () => 0;

export function installTerrainHeightSampler(sampler) {
  heightAtWorld = sampler;
}

export function createTextPlane(text, width, height, color = "#c9b47c") {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 144;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = '600 74px "KaiTi", "STKaiti", serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
  mesh.renderOrder = 2;
  return mesh;
}

export function getBoardNode(nodes, x, y) {
  return nodes[y * BOARD_COLUMNS + x];
}

export function getSurfaceNormal(x, y) {
  const position = boardPosition(x, y);
  return terrainNormalAt(position.x, position.z);
}

export const BOARD_META = {
  spacing: BOARD_SPACING,
  columns: BOARD_COLUMNS,
  rows: BOARD_ROWS,
  bridges: [0, 4, 8],
};

export const PIECE_TYPE_GLYPHS = {
  [SIDES.RED]: {
    [PIECE_TYPES.GENERAL]: "帅",
    [PIECE_TYPES.ADVISOR]: "仕",
    [PIECE_TYPES.ELEPHANT]: "相",
    [PIECE_TYPES.HORSE]: "马",
    [PIECE_TYPES.CHARIOT]: "车",
    [PIECE_TYPES.CANNON]: "炮",
    [PIECE_TYPES.SOLDIER]: "兵",
  },
  [SIDES.BLACK]: {
    [PIECE_TYPES.GENERAL]: "将",
    [PIECE_TYPES.ADVISOR]: "士",
    [PIECE_TYPES.ELEPHANT]: "象",
    [PIECE_TYPES.HORSE]: "马",
    [PIECE_TYPES.CHARIOT]: "车",
    [PIECE_TYPES.CANNON]: "砲",
    [PIECE_TYPES.SOLDIER]: "卒",
  },
};
