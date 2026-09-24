import * as THREE from "three";
import { PIECE_TYPES } from "../game/constants.js";
import { factionMaterials } from "./materials.js";
import {
  addMesh,
  box,
  capsule,
  cone,
  cylinder,
  makeFactionBandTexture,
  makeLabelTexture,
  setShadow,
  sphere,
} from "./model-utils.js";

const TEMP_FORWARD = new THREE.Vector3(0, 0, 1);

// 阵营色带贴图按阵营缓存: 32 颗棋子共用两张 canvas 贴图。
// 每颗各建一份会白白多吃 32 倍显存, 而纹样只取决于阵营, 没有逐子差异。
const FACTION_BAND_CACHE = new Map();

function factionBandMaterial(faction, side) {
  if (!FACTION_BAND_CACHE.has(side)) {
    const texture = makeFactionBandTexture(side);
    const material = faction.baseBand.clone();
    material.map = texture;
    FACTION_BAND_CACHE.set(side, material);
  }
  return FACTION_BAND_CACHE.get(side);
}

export class PieceActor {
  constructor(piece, materials, options = {}) {
    this.piece = piece;
    this.group = new THREE.Group();
    this.group.name = `piece-${piece.id}`;
    this.group.userData.pieceId = piece.id;
    this.group.userData.actor = this;
    this.rig = {};
    this.phase = Math.random() * Math.PI * 2;
    this.attackAt = -1;
    this.attackType = null;
    this.attackDuration = 0.54;
    this.hitCalled = false;
    this.defeating = false;
    this.defeatAt = -1;
    this.defeatDuration = 0.52;
    this.baseHeight = 0;
    this.highlighted = false;
    this.hovered = false;
    this.feedbackScale = 0;
    this.baseYaw = piece.side === "red" ? Math.PI : 0;
    this.group.rotation.y = this.baseYaw;
    this._allMaterials = materials;
    this.deferSculpt = Boolean(options.deferSculpt);
    this.build(piece, materials);
    setShadow(this.group);
  }

  build(piece, materials) {
    const faction = factionMaterials(materials, piece.side);
    this.materials = faction;
    this.buildBase(piece, faction);
    if (this.deferSculpt) return;
    this.buildSculpt(piece, faction);
  }

  buildSculpt(piece = this.piece, faction = this.materials) {
    if (this.rig.sculpt) return;
    const sculpt = new THREE.Group();
    sculpt.name = "sculpt";
    sculpt.scale.set(0.94, 1.22, 0.94);
    this.group.add(sculpt);
    this.rig.sculpt = sculpt;

    switch (piece.type) {
      case PIECE_TYPES.GENERAL:
        this.buildGeneral(faction, sculpt);
        break;
      case PIECE_TYPES.ADVISOR:
        this.buildAdvisor(faction, sculpt);
        break;
      case PIECE_TYPES.ELEPHANT:
        this.buildElephant(faction, sculpt);
        break;
      case PIECE_TYPES.HORSE:
        this.buildHorse(faction, sculpt);
        break;
      case PIECE_TYPES.CHARIOT:
        this.buildChariot(faction, sculpt);
        break;
      case PIECE_TYPES.CANNON:
        this.buildCannon(faction, sculpt);
        break;
      case PIECE_TYPES.SOLDIER:
        this.buildSoldier(faction, sculpt);
        break;
    }
    setShadow(sculpt);
  }

  buildBase(piece, faction) {
    const base = new THREE.Group();
    base.name = "base";
    // 底座从下到上: 金属外圈 -> 高饱和阵营色环 -> 漆面圆盘 -> 名牌。
    // 之前的底座是"青铜/暗铁 + 一个细圈", 在暖黄沙地上红黑双方整体都偏暗,
    // 远镜头下几乎是同一种颜色。现在把阵营色做成最粗的一圈,
    // 并把外圈抬起一点做出立体台阶, 逆光/俯视也能一眼分清阵营。
    cylinder(base, faction.darkTrim, [0.62, 0.68], 0.1, [0, 0.05, 0], [0, 0, 0], 32);
    // 阵营色环: 用程序化回纹贴图替代纯色 (按阵营缓存的共享材质)。
    // 侧壁是圆柱的弯曲面, 回纹贴上去后近景有细节; 纹样明度差只有 0.34,
    // 缩到几个像素时会糊成一条纯色带, 远景阵营辨识度不受影响。
    cylinder(
      base,
      factionBandMaterial(faction, piece.side),
      [0.6, 0.62],
      0.11,
      [0, 0.155, 0],
      [0, 0, 0],
      32
    );
    cylinder(base, faction.accent, [0.5, 0.57], 0.1, [0, 0.255, 0], [0, 0, 0], 32);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.475, 0.035, 8, 40),
      faction.trim
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.31;
    ring.castShadow = true;
    base.add(ring);

    const labelTexture = makeLabelTexture(pieceGlyph(piece), piece.side);
    labelTexture.userData.ownedTexture = true;
    const labelMaterial = new THREE.MeshBasicMaterial({
      map: labelTexture,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      toneMapped: false,
    });
    labelMaterial.userData.ownedTexture = true;
    const label = new THREE.Mesh(new THREE.CircleGeometry(0.4, 36), labelMaterial);
    label.rotation.x = -Math.PI / 2;
    label.rotation.z = 0;
    label.position.y = 0.315;
    label.renderOrder = 2;
    base.add(label);
    base.scale.setScalar(0.98);
    this.group.add(base);
    this.rig.base = base;

    // Glow ring used for selection / hover feedback. Kept on the base so it
    // never scales with the sculpt and stays readable in top-down views.
    const glow = new THREE.Mesh(
      new THREE.RingGeometry(0.55, 0.72, 40),
      new THREE.MeshBasicMaterial({
        color: piece.side === "red" ? 0xffcf7a : 0x8fd4de,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.028;
    glow.renderOrder = 4;
    this.group.add(glow);
    this.rig.glow = glow;
  }

  setHighlight(value) {
    this.highlighted = Boolean(value);
  }

  setHover(value) {
    this.hovered = Boolean(value);
  }

  buildGeneral(faction, root = this.group) {
    const model = new THREE.Group();
    model.position.y = 0.27;
    cylinder(model, faction.silk, [0.3, 0.44], 0.7, [0, 0.35, 0], [0, 0, 0], 12);
    box(model, this.material("leather"), [0.48, 0.42, 0.28], [0, 0.72, 0]);
    box(model, faction.trim, [0.52, 0.12, 0.3], [0, 0.57, 0]);
    box(model, faction.cloth, [0.16, 0.42, 0.05], [0, 0.73, 0.18]);
    [-0.25, 0, 0.25].forEach((x) => {
      box(model, faction.trim, [0.13, 0.34, 0.08], [x, 0.73, 0.205], [0, 0, x * 0.18]);
    });
    box(model, faction.darkTrim, [0.55, 0.22, 0.34], [0, 0.42, 0]);
    [-0.43, 0.43].forEach((x) => {
      box(model, faction.darkTrim, [0.2, 0.16, 0.22], [x, 0.26, 0.08]);
      box(model, faction.trim, [0.22, 0.06, 0.24], [x, 0.34, 0.08]);
    });

    // 肩吞: 中式甲胄最有辨识度的特征之一 —— 肩头一对兽面圆甲。
    // 俯视时肩部是仅次于头盔的视觉重点, 而原先躯干就是几个方块, 双肩完全空白。
    // 用「扁球(兽面) + 圆锥(兽角) + 圆环(缘口)」三层堆出体量, 全部是现有原语。
    [-1, 1].forEach((side) => {
      const pauldron = new THREE.Group();
      pauldron.position.set(side * 0.29, 0.84, 0.02);
      // 兽面: 压扁的球, 面向外侧
      sphere(pauldron, faction.trim, 0.17, [0, 0, 0], [0.72, 1, 1], 12);
      // 缘口: 一圈暗色滚边, 让肩甲有厚度
      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(0.155, 0.028, 6, 16),
        faction.darkTrim
      );
      rim.rotation.y = Math.PI / 2;
      rim.position.set(side * 0.02, 0, 0);
      rim.castShadow = true;
      pauldron.add(rim);
      // 兽角: 两只小锥体朝外上方翘
      cone(pauldron, faction.accent, 0.042, 0.17, [side * 0.06, 0.14, -0.06], [0, 0, -side * 0.5], 7);
      cone(pauldron, faction.accent, 0.034, 0.13, [side * 0.06, 0.12, 0.07], [0, 0, -side * 0.62], 7);
      // 甲片: 肩下悬垂的两片护肩
      box(pauldron, faction.cloth, [0.15, 0.1, 0.03], [side * 0.02, -0.13, 0.08], [0.18, 0, 0]);
      box(pauldron, faction.cloth, [0.15, 0.1, 0.03], [side * 0.03, -0.13, -0.06], [-0.16, 0, 0]);
      model.add(pauldron);
    });

    // 胸甲分片: 躯干正面原本是一整块平面, 加三道横向甲片压出"札甲"层次。
    // 只抬高 0.01, 靠明暗差读出结构, 不改变整体轮廓。
    [-0.1, 0.02, 0.14].forEach((y, i) => {
      box(
        model,
        i % 2 === 0 ? faction.trim : faction.darkTrim,
        [0.4 - i * 0.03, 0.075, 0.026],
        [0, 0.62 + y, 0.15 - i * 0.004],
        [0.12, 0, 0]
      );
    });

    const cape = new THREE.Group();
    cape.position.set(0, 0.85, -0.09);
    const capeMesh = addMesh(
      cape,
      new THREE.PlaneGeometry(0.72, 1.05, 5, 5),
      faction.silk,
      [0, -0.5, 0],
      [-0.1, 0, 0]
    );
    capeMesh.material = faction.silk;
    const capeBorder = addMesh(
      cape,
      new THREE.PlaneGeometry(0.76, 0.1, 3, 1),
      faction.trim,
      [0, -1.0, 0.006]
    );
    capeBorder.castShadow = false;
    model.add(cape);

    sphere(model, this.material("skin"), 0.19, [0, 1.11, 0], [1, 1.06, 0.95]);

    const helmet = new THREE.Group();
    helmet.position.y = 1.27;
    sphere(helmet, faction.trim, 0.25, [0, 0, 0], [1, 0.78, 1]);
    cone(helmet, faction.accent, 0.14, 0.3, [0, 0.25, 0], [0, 0, 0], 10);
    cone(helmet, faction.trim, 0.035, 0.34, [0, 0.52, 0], [0, 0, 0], 8);
    box(helmet, faction.accent, [0.42, 0.14, 0.2], [0, -0.06, 0.12]);
    [-1, 1].forEach((side) => {
      cone(
        helmet,
        faction.darkTrim,
        0.065,
        0.34,
        [side * 0.23, 0.02, -0.02],
        [0, 0, -side * 1.02],
        8
      );
    });
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 0.27, 24),
      new THREE.MeshBasicMaterial({
        color: 0xffd47a,
        transparent: true,
        opacity: 0.58,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.28;
    helmet.add(halo);
    model.add(helmet);

    const armL = this.makeArm(model, faction, -1);
    const armR = this.makeArm(model, faction, 1);
    const weapon = new THREE.Group();
    weapon.position.set(0.42, 0.72, 0);
    box(weapon, faction.trim, [0.06, 0.78, 0.07], [0, 0.2, 0], [0, 0, -0.18]);
    box(weapon, this.materials.darkTrim ?? faction.darkTrim, [0.055, 0.58, 0.5], [0, -0.15, 0], [0, 0, -0.18]);
    armR.add(weapon);

    root.add(model);
    Object.assign(this.rig, { halo });
    Object.assign(this.rig, {
      model,
      body: model,
      head: helmet,
      cape,
      armL,
      armR,
      weapon,
    });
  }

  buildAdvisor(faction, root = this.group) {
    const model = new THREE.Group();
    model.position.y = 0.27;
    cone(model, faction.silk, 0.48, 0.88, [0, 0.42, 0], [0, 0, 0], 12);
    box(model, faction.cloth, [0.42, 0.48, 0.24], [0, 0.77, 0]);
    box(model, faction.trim, [0.44, 0.08, 0.25], [0, 0.62, 0]);
    [-0.2, 0.2].forEach((x) => {
      box(model, faction.trim, [0.08, 0.52, 0.03], [x, 0.8, 0.15], [0, 0, x * 0.22]);
    });
    cone(model, faction.darkTrim, 0.52, 0.16, [0, 0.09, 0], [0, 0, 0], 12);
    sphere(model, this.material("skin"), 0.18, [0, 1.08, 0]);
    cylinder(model, faction.accent, [0.28, 0.28], 0.12, [0, 1.29, 0], [0, 0, 0], 14);
    cylinder(model, faction.trim, [0.03, 0.03], 0.2, [0, 1.43, 0], [0, 0, 0], 8);
    box(model, faction.silk, [0.34, 0.42, 0.05], [0, 1.0, -0.22], [-0.2, 0, 0]);

    const armL = this.makeSleeve(model, faction, -1);
    const armR = this.makeSleeve(model, faction, 1);
    const fan = new THREE.Group();
    fan.position.set(0.4, 0.74, 0.08);
    fan.rotation.z = -0.35;
    for (let i = 0; i < 7; i += 1) {
      box(
        fan,
        i === 3 ? faction.trim : faction.silk,
        [0.045, 0.35, 0.025],
        [0, 0.18, 0],
        [0, 0, (i - 3) * 0.14]
      );
    }
    box(fan, faction.darkTrim, [0.06, 0.22, 0.06], [0, 0.02, 0]);
    armR.add(fan);

    root.add(model);
    Object.assign(this.rig, { model, body: model, armL, armR, fan });
  }

  buildElephant(faction, root = this.group) {
    const model = new THREE.Group();
    model.position.y = 0.26;
    sphere(model, this.material("elephant"), 0.78, [0, 0.94, 0], [1.16, 1.02, 0.9], 18);
    sphere(model, this.material("elephant"), 0.6, [0, 1.32, 0.66], [1, 1.08, 0.92], 16);
    sphere(model, this.material("elephant"), 0.24, [0, 1.04, 0.92], [0.92, 0.86, 0.9], 14);
    sphere(model, this.material("darkSkin"), 0.075, [-0.25, 1.32, 1.13], [1, 1.1, 0.7], 10);
    sphere(model, this.material("darkSkin"), 0.075, [0.25, 1.32, 1.13], [1, 1.1, 0.7], 10);

    const trunk = new THREE.Group();
    trunk.position.set(0, 1.42, 1.02);
    let parent = trunk;
    for (let i = 0; i < 5; i += 1) {
      const segment = new THREE.Group();
      segment.position.y = i === 0 ? 0 : -0.17;
      cylinder(parent, this.material("elephant"), [0.15 - i * 0.014, 0.18 - i * 0.015], 0.22, [0, 0, 0], [0, 0, 0], 10);
      parent.add(segment);
      parent = segment;
    }

    const earGeometry = new THREE.SphereGeometry(0.36, 12, 10);
    const earL = addMesh(model, earGeometry, this.material("elephant"), [-0.58, 1.4, 0.72], [0, -0.24, -0.2], [0.42, 1.2, 0.82]);
    const earR = addMesh(model, earGeometry, this.material("elephant"), [0.58, 1.4, 0.72], [0, 0.24, 0.2], [0.42, 1.2, 0.82]);

    const tuskL = cone(model, this.material("ivory"), 0.055, 0.65, [-0.28, 1.17, 1.1], [Math.PI / 2.25, 0, -0.2], 10);
    const tuskR = cone(model, this.material("ivory"), 0.055, 0.65, [0.28, 1.17, 1.1], [Math.PI / 2.25, 0, 0.2], 10);

    const legs = [];
    [
      [-0.52, 0.33, 0.46],
      [0.52, 0.33, 0.46],
      [-0.52, 0.33, -0.42],
      [0.52, 0.33, -0.42],
    ].forEach(([x, y, z]) => {
      const leg = new THREE.Group();
      leg.position.set(x, y + 0.34, z);
      cylinder(leg, this.material("elephant"), [0.13, 0.18], 0.76, [0, -0.34, 0], [0, 0, 0], 10);
      box(leg, faction.darkTrim, [0.25, 0.14, 0.32], [0, -0.72, 0.04]);
      model.add(leg);
      legs.push(leg);
    });

    box(model, faction.cloth, [1.42, 0.1, 1.2], [0, 1.78, -0.02]);
    box(model, faction.trim, [1.48, 0.07, 1.26], [0, 1.72, -0.02]);
    cylinder(model, faction.trim, [0.05, 0.05], 0.55, [-0.5, 2.02, -0.05], [0, 0, -0.15], 8);
    cylinder(model, faction.trim, [0.05, 0.05], 0.55, [0.5, 2.02, -0.05], [0, 0, 0.15], 8);
    box(model, faction.silk, [1.16, 0.68, 0.06], [0, 2.22, -0.45], [-0.12, 0, 0]);
    box(model, faction.darkTrim, [1.34, 0.14, 0.24], [0, 1.9, 0.46]);
    [-0.5, 0.5].forEach((x) => {
      box(model, faction.accent, [0.2, 0.36, 0.12], [x, 2.12, -0.03]);
    });

    const tail = new THREE.Group();
    tail.position.set(0, 1.12, -0.82);
    cylinder(tail, this.material("elephant"), [0.035, 0.05], 0.72, [0, -0.31, 0], [0.12, 0, 0], 8);
    model.add(tail);

    root.add(model);
    Object.assign(this.rig, {
      model,
      body: model,
      head: earL.parent,
      trunk,
      earL,
      earR,
      tuskL,
      tuskR,
      legs,
      tail,
    });
  }

  buildHorse(faction, root = this.group) {
    const model = new THREE.Group();
    model.position.y = 0.25;
    sphere(model, this.material("horseBrown"), 0.5, [0, 0.9, 0], [1.35, 0.76, 0.72], 16);
    const neck = new THREE.Group();
    neck.position.set(0, 1.15, 0.45);
    neck.rotation.x = -0.53;
    cylinder(neck, this.material("horseBrown"), [0.19, 0.28], 0.88, [0, 0.38, 0], [0, 0, 0], 10);
    sphere(model, this.material("horseBrown"), 0.3, [0, 1.53, 0.79], [0.86, 0.74, 1.25], 12);
    box(model, this.material("horseBlack"), [0.16, 0.5, 0.26], [0, 1.45, 0.52], [-0.5, 0, 0]);
    cone(model, this.material("horseBrown"), 0.09, 0.28, [-0.17, 1.8, 0.73], [0, 0, -0.12], 8);
    cone(model, this.material("horseBrown"), 0.09, 0.28, [0.17, 1.8, 0.73], [0, 0, 0.12], 8);
    sphere(model, this.material("horseBlack"), 0.075, [-0.27, 1.58, 1.02], [0.8, 0.8, 0.8], 10);
    sphere(model, this.material("horseBlack"), 0.075, [0.27, 1.58, 1.02], [0.8, 0.8, 0.8], 10);
    box(model, faction.darkTrim, [0.68, 0.1, 0.55], [0, 1.2, -0.03]);
    box(model, faction.cloth, [0.54, 0.52, 0.08], [0, 1.19, 0.46], [0.1, 0, 0]);
    box(model, faction.cloth, [0.48, 0.6, 0.08], [0, 1.34, -0.48], [0.18, 0, 0]);

    const legs = [];
    [
      [-0.42, 0.4, 0.38],
      [0.42, 0.4, 0.38],
      [-0.42, 0.4, -0.4],
      [0.42, 0.4, -0.4],
    ].forEach(([x, y, z]) => {
      const leg = new THREE.Group();
      leg.position.set(x, y + 0.25, z);
      cylinder(leg, this.material("horseBrown"), [0.075, 0.12], 0.78, [0, -0.35, 0], [0, 0, 0], 8);
      cylinder(leg, faction.darkTrim, [0.115, 0.115], 0.05, [0, -0.24, 0], [0, 0, 0], 8);
      box(leg, this.materials.darkTrim ?? faction.darkTrim, [0.15, 0.12, 0.2], [0, -0.74, 0.03]);
      model.add(leg);
      legs.push(leg);
    });

    const tail = new THREE.Group();
    tail.position.set(0, 1.0, -0.62);
    cone(tail, this.material("horseBlack"), 0.13, 0.86, [0, -0.38, -0.08], [-0.34, 0, 0], 8);
    model.add(tail);

    const rider = new THREE.Group();
    rider.position.set(0, 1.38, -0.15);
    cylinder(rider, faction.cloth, [0.2, 0.28], 0.52, [0, 0.22, 0], [0, 0, 0], 10);
    box(rider, faction.darkTrim, [0.48, 0.18, 0.32], [0, 0.32, 0]);
    box(rider, faction.trim, [0.5, 0.07, 0.34], [0, 0.42, 0]);
    sphere(rider, this.material("skin"), 0.17, [0, 0.61, 0]);
    cylinder(rider, faction.trim, [0.25, 0.25], 0.09, [0, 0.78, 0], [0, 0, 0], 12);
    cone(rider, faction.accent, 0.13, 0.3, [0, 0.93, 0], [0, 0, 0], 8);
    const arm = this.makeArm(rider, faction, 1);
    arm.position.set(0.25, 0.36, 0);
    const spear = this.makeSpear(faction, 2.1);
    spear.position.set(0.12, 0.15, 0.12);
    spear.rotation.z = -0.38;
    arm.add(spear);
    model.add(rider);

    root.add(model);
    Object.assign(this.rig, {
      model,
      body: model,
      head: model,
      neck,
      legs,
      tail,
      rider,
      arm,
      spear,
    });
  }

  buildChariot(faction, root = this.group) {
    const model = new THREE.Group();
    model.position.y = 0.25;
    const cart = new THREE.Group();
    cart.position.z = -0.35;
    box(cart, this.material("wood"), [1.26, 0.28, 1.55], [0, 0.68, 0]);
    box(cart, faction.darkTrim, [1.36, 0.11, 0.13], [0, 0.9, -0.72]);
    box(cart, faction.darkTrim, [1.36, 0.11, 0.13], [0, 0.9, 0.72]);
    box(cart, faction.accent, [0.12, 0.5, 1.4], [-0.6, 0.98, 0]);
    box(cart, faction.accent, [0.12, 0.5, 1.4], [0.6, 0.98, 0]);
    box(cart, faction.trim, [0.08, 0.1, 1.44], [-0.61, 1.24, 0]);
    box(cart, faction.trim, [0.08, 0.1, 1.44], [0.61, 1.24, 0]);
    box(cart, this.material("wood"), [1.48, 0.13, 0.12], [0, 0.55, 0.78]);
    box(cart, this.material("wood"), [1.48, 0.13, 0.12], [0, 0.55, -0.78]);
    cylinder(cart, faction.trim, [0.045, 0.045], 1.5, [-0.48, 1.55, -0.15], [0, 0, 0], 8);
    cylinder(cart, faction.trim, [0.045, 0.045], 1.5, [0.48, 1.55, -0.15], [0, 0, 0], 8);
    box(cart, faction.silk, [1.18, 0.68, 0.04], [0, 1.42, -0.48], [-0.16, 0, 0]);
    box(cart, faction.trim, [1.24, 0.08, 0.05], [0, 1.08, -0.5]);

    const wheels = [];
    [-0.82, 0.82].forEach((x) => {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.48, -0.32);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.065, 8, 20), this.material("wood"));
      rim.rotation.y = Math.PI / 2;
      wheel.add(rim);
      for (let i = 0; i < 8; i += 1) {
        const spoke = box(wheel, faction.darkTrim, [0.04, 0.78, 0.04], [0, 0, 0], [0, 0, (i * Math.PI) / 4]);
        spoke.rotation.z = (i * Math.PI) / 8;
      }
      model.add(wheel);
      wheels.push(wheel);
    });

    const driver = new THREE.Group();
    driver.position.set(0, 1.0, 0.05);
    cylinder(driver, faction.cloth, [0.21, 0.3], 0.56, [0, 0.26, 0], [0, 0, 0], 10);
    sphere(driver, this.material("skin"), 0.18, [0, 0.67, 0]);
    cylinder(driver, faction.trim, [0.25, 0.25], 0.09, [0, 0.85, 0], [0, 0, 0], 12);
    const armL = this.makeArm(driver, faction, -1);
    const armR = this.makeArm(driver, faction, 1);
    const spear = this.makeSpear(faction, 2.3);
    spear.position.set(0.22, 0.27, 0.12);
    armR.add(spear);
    cart.add(driver);

    const horse = new THREE.Group();
    horse.position.set(0, 0.05, 1.45);
    sphere(horse, this.material("horseBlack"), 0.38, [0, 0.75, 0], [1.1, 0.75, 1.55], 14);
    sphere(horse, this.material("horseBlack"), 0.27, [0, 1.17, 0.5], [0.84, 0.82, 1], 12);
    cone(horse, this.material("horseBlack"), 0.075, 0.24, [-0.14, 1.36, 0.54], [0, 0, -0.08], 8);
    cone(horse, this.material("horseBlack"), 0.075, 0.24, [0.14, 1.36, 0.54], [0, 0, 0.08], 8);
    const horseLegs = [];
    [
      [-0.28, 0.34, 0.38],
      [0.28, 0.34, 0.38],
      [-0.28, 0.34, -0.38],
      [0.28, 0.34, -0.38],
    ].forEach(([x, y, z]) => {
      const leg = new THREE.Group();
      leg.position.set(x, y, z);
      cylinder(leg, this.material("horseBlack"), [0.055, 0.085], 0.6, [0, -0.28, 0], [0, 0, 0], 8);
      horse.add(leg);
      horseLegs.push(leg);
    });
    cart.add(horse);
    model.add(cart);
    root.add(model);

    Object.assign(this.rig, {
      model,
      body: model,
      cart,
      wheels,
      horse,
      horseLegs,
      driver,
      armL,
      armR,
      spear,
    });
  }

  buildCannon(faction, root = this.group) {
    const model = new THREE.Group();
    model.position.y = 0.25;
    box(model, this.material("wood"), [0.72, 0.28, 1.42], [0, 0.52, -0.12]);
    box(model, faction.darkTrim, [0.92, 0.1, 0.18], [0, 0.36, 0.48]);
    box(model, faction.accent, [0.78, 0.22, 0.28], [0, 0.84, -0.48]);
    box(model, faction.trim, [0.82, 0.08, 0.32], [0, 1.0, -0.48]);
    box(model, this.material("darkMetal"), [0.88, 0.12, 0.62], [0, 0.32, 0.1]);

    const barrelPivot = new THREE.Group();
    barrelPivot.position.set(0, 0.82, 0.04);
    barrelPivot.rotation.x = -0.18;
    cylinder(barrelPivot, this.material("darkMetal"), [0.15, 0.22], 1.48, [0, 0, 0.48], [Math.PI / 2, 0, 0], 18);
    cylinder(barrelPivot, faction.trim, [0.25, 0.25], 0.16, [0, 0, 1.22], [Math.PI / 2, 0, 0], 18);
    cylinder(barrelPivot, faction.trim, [0.23, 0.23], 0.1, [0, 0, -0.27], [Math.PI / 2, 0, 0], 18);
    cylinder(barrelPivot, this.material("steel"), [0.165, 0.165], 0.08, [0, 0, 0.75], [Math.PI / 2, 0, 0], 16);
    cylinder(barrelPivot, this.material("steel"), [0.19, 0.19], 0.07, [0, 0, 0.2], [Math.PI / 2, 0, 0], 16);
    model.add(barrelPivot);

    const wheels = [];
    [-0.54, 0.54].forEach((x) => {
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.48, -0.02);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.075, 8, 20), this.material("wood"));
      rim.rotation.y = Math.PI / 2;
      rim.castShadow = true;
      wheel.add(rim);
      for (let i = 0; i < 6; i += 1) {
        const spoke = box(wheel, faction.darkTrim, [0.04, 0.7, 0.04], [0, 0, 0]);
        spoke.rotation.z = (i * Math.PI) / 6;
      }
      model.add(wheel);
      wheels.push(wheel);
    });

    const operator = new THREE.Group();
    operator.position.set(0, 0.95, -0.7);
    cylinder(operator, faction.cloth, [0.17, 0.24], 0.5, [0, 0.23, 0], [0, 0, 0], 10);
    box(operator, faction.darkTrim, [0.4, 0.18, 0.28], [0, 0.22, 0]);
    sphere(operator, this.material("skin"), 0.15, [0, 0.58, 0]);
    cylinder(operator, faction.trim, [0.21, 0.21], 0.08, [0, 0.72, 0], [0, 0, 0], 12);
    const arm = this.makeArm(operator, faction, 1);
    arm.position.set(0.24, 0.38, 0);
    model.add(operator);
    root.add(model);

    Object.assign(this.rig, {
      model,
      body: model,
      barrel: barrelPivot,
      wheels,
      operator,
      arm,
    });
  }

  buildSoldier(faction, root = this.group) {
    const model = new THREE.Group();
    model.position.y = 0.25;
    cylinder(model, faction.cloth, [0.23, 0.31], 0.46, [0, 0.48, 0], [0, 0, 0], 10);
    box(model, faction.darkTrim, [0.46, 0.34, 0.22], [0, 0.78, 0]);
    box(model, faction.accent, [0.48, 0.1, 0.21], [0, 0.66, 0.05]);
    box(model, faction.trim, [0.5, 0.06, 0.23], [0, 0.89, 0.02]);
    box(model, faction.trim, [0.16, 0.4, 0.04], [0, 0.51, 0.25]);
    sphere(model, this.material("skin"), 0.16, [0, 1.06, 0]);
    cylinder(model, faction.trim, [0.23, 0.23], 0.1, [0, 1.23, 0], [0, 0, 0], 12);
    cone(model, faction.accent, 0.12, 0.28, [0, 1.39, 0], [0, 0, 0], 8);

    const legs = [];
    [-0.16, 0.16].forEach((x) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0.3, 0);
      cylinder(leg, this.material("riderLeather"), [0.075, 0.11], 0.48, [0, -0.22, 0], [0, 0, 0], 8);
      cylinder(leg, faction.darkTrim, [0.105, 0.105], 0.055, [0, -0.08, 0], [0, 0, 0], 8);
      box(leg, faction.darkTrim, [0.16, 0.12, 0.24], [0, -0.49, 0.05]);
      model.add(leg);
      legs.push(leg);
    });

    const armL = this.makeArm(model, faction, -1);
    const armR = this.makeArm(model, faction, 1);
    const shield = new THREE.Group();
    shield.position.set(-0.44, 0.76, 0.02);
    shield.rotation.y = Math.PI / 2;
    cylinder(shield, faction.accent, [0.35, 0.35], 0.07, [0, 0, 0], [Math.PI / 2, 0, 0], 16);
    cylinder(shield, faction.trim, [0.22, 0.22], 0.08, [0, 0.02, 0], [Math.PI / 2, 0, 0], 16);
    armL.add(shield);

    const spear = this.makeSpear(faction, 2.35);
    spear.position.set(0.22, 0.34, 0.08);
    spear.rotation.z = -0.32;
    armR.add(spear);

    root.add(model);
    Object.assign(this.rig, {
      model,
      body: model,
      legs,
      armL,
      armR,
      shield,
      spear,
    });
  }

  makeArm(parent, faction, side) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.34, 0.86, 0);
    cylinder(arm, faction.cloth, [0.095, 0.13], 0.56, [0, -0.25, 0], [0, 0, side * 0.08], 8);
    sphere(arm, this.material("skin"), 0.105, [0, -0.56, 0]);
    parent.add(arm);
    return arm;
  }

  makeSleeve(parent, faction, side) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.36, 0.82, 0);
    cylinder(arm, faction.silk, [0.12, 0.27], 0.62, [0, -0.28, 0], [0, 0, side * 0.15], 8);
    sphere(arm, this.material("skin"), 0.1, [0, -0.61, 0]);
    parent.add(arm);
    return arm;
  }

  makeSpear(faction, length = 2.1) {
    const spear = new THREE.Group();
    cylinder(spear, this.material("wood"), [0.025, 0.035], length, [0, length / 2 - 0.15, 0], [0, 0, 0], 8);
    cone(spear, this.material("steel"), 0.07, 0.28, [0, length - 0.12, 0], [0, 0, 0], 8);
    box(spear, faction.trim, [0.14, 0.05, 0.06], [0, length - 0.3, 0]);
    return spear;
  }

  material(name) {
    return this._allMaterials?.[name] ?? MATERIALS_FALLBACK[name];
  }

  setSharedMaterials(materials) {
    this._allMaterials = materials;
  }

  update(time, delta, reducedMotion = false) {
    if (this.defeating) {
      this.updateDefeat(time);
      return;
    }

    const feedbackTarget = this.highlighted ? 1 : this.hovered ? 0.55 : 0;
    const feedbackBlend = 1 - Math.exp(-10 * Math.max(0, delta ?? 0.016));
    this.feedbackScale += (feedbackTarget - this.feedbackScale) * feedbackBlend;
    if (this.rig.glow) {
      this.rig.glow.material.opacity =
        this.feedbackScale * (this.highlighted ? 0.78 : 0.5);
      const pulse = 1 + Math.sin(time * 3.4) * 0.045 * this.feedbackScale;
      this.rig.glow.scale.setScalar(pulse);
      this.rig.glow.rotation.z = time * 0.5 * this.feedbackScale;
    }
    if (this.rig.model && this.feedbackScale > 0.001) {
      this.rig.model.position.y += this.feedbackScale * 0.07;
    }

    const t = time + this.phase;
    const motionScale = reducedMotion ? 0.16 : 1;
    const idle = Math.sin(t * 1.8);
    const breath = Math.sin(t * 2.15);

    if (this.rig.model) {
      this.rig.model.position.y = 0.25 + idle * 0.012 * motionScale;
      this.rig.model.rotation.z = Math.sin(t * 1.1) * 0.008 * motionScale;
    }
    if (this.rig.body && this.rig.body !== this.rig.model) {
      this.rig.body.position.y = 0.27 + breath * 0.018 * motionScale;
    }
    if (this.rig.armL) {
      this.rig.armL.rotation.x = Math.sin(t * 1.6) * 0.07 * motionScale;
    }
    if (this.rig.armR) {
      this.rig.armR.rotation.x = -Math.sin(t * 1.6) * 0.07 * motionScale;
    }
    if (this.rig.cape) {
      this.rig.cape.rotation.x = -0.05 + Math.sin(t * 1.4) * 0.035 * motionScale;
    }
    if (this.rig.legs) {
      this.rig.legs.forEach((leg, index) => {
        leg.rotation.x = Math.sin(t * 1.3 + index * 0.75) * 0.018 * motionScale;
      });
    }
    if (this.rig.tail) {
      this.rig.tail.rotation.z = Math.sin(t * 1.9) * 0.16 * motionScale;
    }
    if (this.rig.trunk) {
      let segment = this.rig.trunk;
      let index = 0;
      while (segment) {
        segment.rotation.z = Math.sin(t * 1.4 + index * 0.45) * 0.035 * motionScale;
        segment = segment.children.find((child) => child.isGroup);
        index += 1;
      }
    }
    if (this.rig.earL) {
      this.rig.earL.rotation.y = -0.24 + Math.sin(t * 1.5) * 0.08 * motionScale;
      this.rig.earR.rotation.y = 0.24 - Math.sin(t * 1.5) * 0.08 * motionScale;
    }
    if (this.rig.sculpt) {
      this.rig.sculpt.rotation.y = Math.sin(t * 0.9) * 0.012 * motionScale;
    }

    if (this.attackAt >= 0) {
      this.updateAttack(time, motionScale);
    }
  }

  attack(type, onHit) {
    // 和 beginDefeat 一样, 基准交给 update() 传进来的 time,
    // 不能自己取 performance.now() —— 那和 THREE.Clock 不是一个时间轴。
    this.attackAt = -1;
    this.attackType = type;
    this.hitCalled = false;
    this.onHit = onHit;
  }

  /**
   * 按兵种设定倒地姿态。
   *
   * 原来所有兵种共用一套固定值(tilt 1.18 / pitch 0.22 / sink 0.34),
   * 于是战象和一个步兵倒下去的幅度完全一样 —— 象那么重的东西轻轻一侧
   * 就"躺平"了, 看着很轻。这里按体态给各自的量:
   *   · 直立的人   —— 侧翻 + 明显前倾, 倒得快
   *   · 有坐骑的   —— 侧翻幅度大(连人带马), 稍慢
   *   · 战象       —— 最慢、下沉最多, 像一座塌下来的塔
   *   · 炮车       —— 结构件, 前倾少、横向翻, 像车架散掉
   */
  setDefeatProfile(type) {
    const profiles = {
      soldier:  { tilt: 1.18, pitch: 0.22, sink: 0.34, dur: 0.60 },
      advisor:  { tilt: 1.10, pitch: 0.30, sink: 0.30, dur: 0.68 },
      general:  { tilt: 1.06, pitch: 0.18, sink: 0.32, dur: 0.72 },
      horse:    { tilt: 1.32, pitch: 0.34, sink: 0.42, dur: 0.78 },
      chariot:  { tilt: 1.24, pitch: 0.26, sink: 0.46, dur: 0.84 },
      cannon:   { tilt: 1.14, pitch: 0.20, sink: 0.50, dur: 0.80 },
      elephant: { tilt: 1.28, pitch: 0.12, sink: 0.62, dur: 1.05 },
    };
    const p = profiles[type] || profiles.soldier;
    this.defeatProfile = p;
    // defeatActor 用这个值决定"等多久才移除棋子", 必须和实际倒地时长一致
    this.defeatDuration = p.dur;
  }

  beginDefeat(duration = 0.76) {
    if (this.defeating) return;
    this.defeating = true;
    // 时间基准必须和 updateDefeat 收到的 time 是同一个钟。
    //
    // 踩过的坑: 这里原来用 performance.now()/1000(页面加载起算), 但
    // update() 传进来的 time 是 THREE.Clock 的 elapsedTime(时钟创建起算),
    // 两者差一个恒定偏移(约几千毫秒)。于是 progress 会算出几千,
    // eased 变成天文数字, 棋子瞬间被甩到几米外 —— 实测 rotation.z 到了
    // +984、位置 Y 到了 -283。
    // 修正做法是把基准交给 scene 每帧传进来的 time, 不自己取时钟。
    this.defeatAt = -1;
    this.defeatDuration = duration;
    this.attackAt = -1;
    this.attackType = null;
  }

  updateDefeat(time) {
    // 第一帧才确定基准, 保证和 update() 用的是同一个时间轴
    if (this.defeatAt < 0) this.defeatAt = time;
    const progress = Math.min(1, (time - this.defeatAt) / this.defeatDuration);
    const eased = progress * progress * (3 - 2 * progress);
    const direction = this.group.rotation.y > Math.PI / 2 ? -1 : 1;
    const p = this.defeatProfile || { tilt: 1.18, pitch: 0.22, sink: 0.34 };
    this.group.rotation.z = direction * eased * p.tilt;
    this.group.rotation.x = eased * p.pitch;
    this.group.position.y = this.baseHeight - eased * p.sink;
    const scale = 1 - Math.max(0, progress - 0.68) * 0.75;
    this.group.scale.setScalar(scale);
  }

  updateAttack(time, motionScale) {
    if (this.attackAt < 0) this.attackAt = time;
    const elapsed = time - this.attackAt;
    const progress = Math.min(1, elapsed / this.attackDuration);
    const strike = Math.sin(progress * Math.PI);
    const windUp = Math.sin(Math.min(progress * 2.2, 1) * Math.PI * 0.5);
    const lunge = Math.sin(Math.min(progress * 1.35, 1) * Math.PI);

    switch (this.attackType) {
      case PIECE_TYPES.SOLDIER:
        if (this.rig.armR) this.rig.armR.rotation.x = -1.45 * lunge * motionScale;
        if (this.rig.spear) this.rig.spear.rotation.x = -0.35 * lunge * motionScale;
        if (this.rig.model) {
          this.rig.model.position.z = 0.4 * lunge * motionScale;
          this.rig.model.rotation.x = -0.08 * lunge * motionScale;
        }
        if (this.rig.shield) this.rig.shield.rotation.y = 0.5 * lunge * motionScale;
        break;
      case PIECE_TYPES.HORSE:
        if (this.rig.model) {
          this.rig.model.position.z = 0.62 * lunge * motionScale;
          this.rig.model.rotation.x = -0.22 * lunge * motionScale;
        }
        if (this.rig.legs) {
          this.rig.legs.forEach((leg, i) => {
            leg.rotation.x = (i < 2 ? -0.95 : 0.62) * lunge * motionScale;
          });
        }
        if (this.rig.arm) this.rig.arm.rotation.x = -1.3 * lunge * motionScale;
        if (this.rig.spear) this.rig.spear.rotation.x = -0.4 * lunge * motionScale;
        if (this.rig.rider) this.rig.rider.rotation.x = 0.12 * lunge * motionScale;
        break;
      case PIECE_TYPES.ELEPHANT:
        if (this.rig.model) {
          this.rig.model.position.z = 0.44 * lunge * motionScale;
          this.rig.model.rotation.x = -0.09 * lunge * motionScale;
        }
        if (this.rig.trunk) {
          this.rig.trunk.rotation.x = -1.15 * lunge * motionScale;
          this.rig.trunk.rotation.z = Math.sin(progress * Math.PI * 3) * 0.24 * motionScale;
        }
        if (this.rig.tuskL) this.rig.tuskL.rotation.z = -0.2 - 0.28 * lunge * motionScale;
        if (this.rig.legs) {
          this.rig.legs.forEach((leg, i) => {
            leg.rotation.x = (i < 2 ? -0.55 : 0.4) * lunge * motionScale;
          });
        }
        break;
      case PIECE_TYPES.CHARIOT:
        if (this.rig.model) {
          this.rig.model.position.z = 0.86 * lunge * motionScale;
          this.rig.model.rotation.x = -0.06 * lunge * motionScale;
        }
        if (this.rig.wheels) {
          this.rig.wheels.forEach((wheel) => {
            wheel.rotation.x += 0.4 * motionScale;
          });
        }
        if (this.rig.horseLegs) {
          this.rig.horseLegs.forEach((leg, i) => {
            leg.rotation.x = Math.sin(progress * Math.PI * 2 + i * 1.4) * 0.72 * motionScale;
          });
        }
        if (this.rig.spear) this.rig.spear.rotation.x = -0.5 * lunge * motionScale;
        break;
      case PIECE_TYPES.CANNON:
        if (this.rig.barrel) this.rig.barrel.rotation.x = -0.18 - windUp * 0.3 * motionScale;
        if (this.rig.model) {
          this.rig.model.position.z = -0.42 * strike * motionScale;
          this.rig.model.rotation.x = 0.09 * windUp * motionScale;
        }
        if (this.rig.wheels) {
          this.rig.wheels.forEach((wheel) => {
            wheel.rotation.x -= 0.12 * strike * motionScale;
          });
        }
        break;
      case PIECE_TYPES.ADVISOR:
        if (this.rig.fan) {
          this.rig.fan.rotation.y = strike * Math.PI * 1.2 * motionScale;
          this.rig.fan.rotation.x = -0.3 * strike * motionScale;
        }
        if (this.rig.model) {
          this.rig.model.rotation.z = Math.sin(progress * Math.PI * 2) * 0.07 * motionScale;
          this.rig.model.position.z = 0.18 * lunge * motionScale;
        }
        break;
      case PIECE_TYPES.GENERAL:
        if (this.rig.weapon) {
          this.rig.weapon.rotation.z = -0.18 - 1.55 * lunge * motionScale;
          this.rig.weapon.rotation.x = -0.4 * lunge * motionScale;
        }
        if (this.rig.model) {
          this.rig.model.position.z = 0.42 * lunge * motionScale;
          this.rig.model.rotation.x = -0.1 * lunge * motionScale;
        }
        if (this.rig.cape) this.rig.cape.rotation.x = -0.05 - 0.35 * lunge * motionScale;
        break;
    }

    if (progress > 0.42 && !this.hitCalled) {
      this.hitCalled = true;
      this.onHit?.();
    }
    if (progress >= 1) {
      this.attackAt = -1;
      this.attackType = null;
      this.onHit = null;
    }
  }
}

const MATERIALS_FALLBACK = {
  leather: new THREE.MeshStandardMaterial({ color: 0x553728, roughness: 0.84 }),
  skin: new THREE.MeshStandardMaterial({ color: 0xb77e58, roughness: 0.82 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x394244, roughness: 0.28, metalness: 0.78 }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8c9998, roughness: 0.25, metalness: 0.82 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x68452b, roughness: 0.68 }),
  horseBrown: new THREE.MeshStandardMaterial({ color: 0x5b3425, roughness: 0.8 }),
  horseBlack: new THREE.MeshStandardMaterial({ color: 0x201c1b, roughness: 0.76 }),
  elephant: new THREE.MeshStandardMaterial({ color: 0x59615c, roughness: 0.88 }),
  ivory: new THREE.MeshStandardMaterial({ color: 0xd7cbac, roughness: 0.56 }),
  riderLeather: new THREE.MeshStandardMaterial({ color: 0x341f1d, roughness: 0.78 }),
};

function materialsNotProvided(name) {
  return MATERIALS_FALLBACK[name];
}

function pieceGlyph(piece) {
  const glyphs = {
    red: {
      [PIECE_TYPES.GENERAL]: "帅",
      [PIECE_TYPES.ADVISOR]: "仕",
      [PIECE_TYPES.ELEPHANT]: "相",
      [PIECE_TYPES.HORSE]: "马",
      [PIECE_TYPES.CHARIOT]: "车",
      [PIECE_TYPES.CANNON]: "炮",
      [PIECE_TYPES.SOLDIER]: "兵",
    },
    black: {
      [PIECE_TYPES.GENERAL]: "将",
      [PIECE_TYPES.ADVISOR]: "士",
      [PIECE_TYPES.ELEPHANT]: "象",
      [PIECE_TYPES.HORSE]: "马",
      [PIECE_TYPES.CHARIOT]: "车",
      [PIECE_TYPES.CANNON]: "砲",
      [PIECE_TYPES.SOLDIER]: "卒",
    },
  };
  return glyphs[piece.side][piece.type];
}

export function createPieceActor(piece, materials) {
  const actor = new PieceActor(piece, materials);
  actor.setSharedMaterials(materials);
  return actor;
}

export function faceDirection(group, direction, immediate = false) {
  if (!direction || direction.lengthSq() < 0.0001) return;
  const yaw = Math.atan2(direction.x, direction.z);
  if (immediate) {
    group.rotation.y = yaw;
    return;
  }
  const current = group.rotation.y;
  let delta = yaw - current;
  delta = Math.atan2(Math.sin(delta), Math.cos(delta));
  group.rotation.y += delta * 0.2;
}

export { TEMP_FORWARD };
