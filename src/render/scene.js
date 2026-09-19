import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  BOARD_COLUMNS,
  BOARD_ROWS,
  PIECE_TYPES,
  SIDES,
} from "../game/constants.js";
import { createPieceActor } from "./pieces.js";
import {
  BOARD_SPACING,
  boardPosition,
  createBoundaryDetails,
  createBridges,
  createDistantRidges,
  createGroundSkirt,
  createRiver,
  createTerrain,
  terrainHeightAt,
  updateBoundaryDetails,
  updateRiver,
} from "./terrain.js";
import {
  clearMoveMarkers,
  createBoardVisuals,
  installTerrainHeightSampler,
  nodePosition,
  showMoveMarkers,
} from "./board-visuals.js";
import { EffectsSystem } from "./effects.js";
import { cloneModel } from "./asset-loader.js";

installTerrainHeightSampler(terrainHeightAt);

export class GameScene {
  constructor(canvas, materials, options = {}) {
    this.canvas = canvas;
    this.materials = materials;
    this.reducedMotion = options.reducedMotion ?? false;
    this.quality = options.quality ?? "high";
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x849b95);
    this.scene.fog = new THREE.FogExp2(0x93a89f, 0.0115);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.quality === "high" ? 2 : 1.35)
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    // 环境贴图(IBL): 决定金属/盔甲/水面的环境反射。
    // 原来默认用 three.js 自带的 RoomEnvironment(室内影棚), 金属会显得很"假",
    // 也不符合"黄昏沙场"的题材。现在默认就用程序化生成的黄昏战场天空,
    // 如果日后往 assets/env/ 放了真 HDRI, 会自动覆盖成它。
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.environmentMap = this.buildBattlefieldEnvironment(pmrem);
    this.scene.environment = this.environmentMap;
    // 室外天空的照度远高于室内影棚, 但直接用满会让甲片发白,
    // 0.42 是"看得出天光反射、又不冲淡固有色"的位置。
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();
    this.applyHdriEnvironment(pmrem);

    this.camera = new THREE.PerspectiveCamera(
      32,
      window.innerWidth / window.innerHeight,
      0.1,
      190
    );
    this.camera.position.set(0, 20.5, 27.5);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.085;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = false;
    this.controls.panSpeed = 0.85;
    this.controls.minDistance = 8.5;
    this.controls.maxDistance = 72;
    this.controls.minPolarAngle = 0.18;
    this.controls.maxPolarAngle = Math.PI / 2.12;
    this.controls.zoomSpeed = 0.95;
    this.controls.rotateSpeed = 0.42;
    this.controls.target.set(0, 0.5, 0.4);
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    this.controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    this.controls.enableZoom = true;

    this.clock = new THREE.Clock();
    this.actors = new Map();
    this.pendingEffects = [];
    this.effects = new EffectsSystem(this.scene, materials);
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hovered = null;
    this.selectedActor = null;
    this.game = null;
    this.animationId = null;
    this.currentView = "red";
    this.retiringIds = new Set();
    this.killCam = null;
    this.timeScale = 1;
    this.timeScaleTarget = 1;
    this.timeScaleBlend = 6;
    this.sceneTime = 0;

    this.createSky();
    this.setupLights();
    this.buildWorld();
    this.bindEvents();
    this.start();
  }

  createSky() {
    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x294d59) },
        horizonColor: { value: new THREE.Color(0xa9b7a3) },
        lowColor: { value: new THREE.Color(0x475d55) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 lowColor;
        varying vec3 vWorldPosition;
        void main() {
          float height = normalize(vWorldPosition).y;
          vec3 upper = mix(horizonColor, topColor, smoothstep(0.03, 0.76, height));
          vec3 color = mix(lowColor, upper, smoothstep(-0.28, 0.12, height));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(72, 40, 24), skyMaterial);
    this.sky.name = "sky-dome";
    this.scene.add(this.sky);
  }

  /**
   * 程序化生成"黄昏战场"环境贴图。
   *
   * 为什么需要: 默认环境是 three 自带的 RoomEnvironment —— 一个室内影棚,
   * 它的反射是白色墙板和顶灯。用在沙场、铁甲、水面上会显得"棚拍",
   * 金属缺少天空的冷调和地面的暖调。而 assets/env/ 里并没有 HDRI 文件,
   * 所以这里直接搭一个小型天空场景, 交给 PMREMGenerator 烘成环境贴图。
   *
   * 做法: 自上而下渐变的天空球(天顶偏青、地平线偏橙) + 一圈地平线亮带
   * (模拟低角度落日) + 一个太阳亮盘。这样盔甲高光会带一点黄昏的金色,
   * 甲片暗部反射天空的青灰, 水面映出地平线的暖光。
   */
  buildBattlefieldEnvironment(pmrem) {
    const sky = new THREE.Scene();

    // 天空球: 用顶点色做垂直渐变
    const domeGeometry = new THREE.SphereGeometry(60, 32, 24);
    const position = domeGeometry.attributes.position;
    const colors = [];
    const top = new THREE.Color(0x5d7d96);      // 天顶: 冷青
    const horizon = new THREE.Color(0xe8a465);  // 地平线: 落日橙
    const bottom = new THREE.Color(0x6b5a44);   // 地面: 暖土色
    for (let i = 0; i < position.count; i += 1) {
      const y = position.getY(i) / 60;          // -1 ~ 1
      const color = new THREE.Color();
      if (y >= 0) {
        // 天顶到地平线: 用 pow 让暖色更集中在地平线附近
        color.copy(top).lerp(horizon, Math.pow(1 - y, 2.4));
      } else {
        color.copy(horizon).lerp(bottom, Math.min(1, -y * 2.2));
      }
      colors.push(color.r, color.g, color.b);
    }
    domeGeometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const dome = new THREE.Mesh(
      domeGeometry,
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })
    );
    sky.add(dome);

    // 地平线亮带: 模拟落日附近最亮的一条窄光带, 决定高光方向
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(58, 32, 12, 0, Math.PI * 2, Math.PI * 0.38, Math.PI * 0.16),
      new THREE.MeshBasicMaterial({
        color: 0xffc98a,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    sky.add(glow);

    // 太阳: 一个亮盘, 让金属上有一处明确的主高光
    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0 })
    );
    sun.position.set(-26, 15, -34);
    sky.add(sun);

    const env = pmrem.fromScene(sky, 0.04).texture;

    domeGeometry.dispose();
    dome.material.dispose();
    glow.geometry.dispose();
    glow.material.dispose();
    sun.geometry.dispose();
    sun.material.dispose();

    return env;
  }

  /**
   * 如果 assets/env/ 下存在黄昏战场 HDRI, 就用它替换程序化天空。
   * 找不到文件就静默跳过, 保持程序化环境, 不影响任何现有表现。
   *
   * 放置文件: public/assets/env/battlefield-dusk.hdr
   *
   * 注意: Vite 的 dev server 对不存在的路径会返回 200 + index.html(SPA 回退),
   * 所以不能用"HTTP 是否成功"判断文件在不在, 必须查 Content-Type。
   */
  applyHdriEnvironment(pmrem) {
    const url = "assets/env/battlefield-dusk.hdr";
    fetch(url, { method: "HEAD" })
      .then((response) => {
        if (!response.ok) return null;
        const type = (response.headers.get("content-type") || "").toLowerCase();
        // 真正的 HDR 文件不会是 text/html
        if (type.includes("text/html")) return null;
        return import("three/addons/loaders/HDRLoader.js");
      })
      .then((module) => {
        const Loader = module?.HDRLoader;
        if (!Loader) return;
        new Loader().load(
          url,
          (texture) => {
            texture.mapping = THREE.EquirectangularReflectionMapping;
            const env = pmrem.fromEquirectangular(texture).texture;
            this.scene.environment = env;
            this.scene.environmentIntensity = 0.62;
            texture.dispose();
          },
          undefined,
          () => {}
        );
      })
      .catch(() => {
        // 没有文件 / 加载失败都保持默认环境, 不影响游戏
      });
  }

  setupLights() {
    const hemi = new THREE.HemisphereLight(0x93a89f, 0x4a3623, 0.5);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xa88f66, 0.13);
    this.scene.add(ambient);

    this.sun = new THREE.DirectionalLight(0xffc987, 4.1);
    this.sun.position.set(-11, 15.5, 9);
    this.sun.castShadow = true;
    // 阴影贴图跟着视锥一起放大, 否则覆盖范围翻倍会让每个棋子的影子
    // 变成锯齿块。3072/2048 是在 52 米视锥下仍能保住棋子影子的档位。
    this.sun.shadow.mapSize.set(
      this.quality === "high" ? 3072 : 2048,
      this.quality === "high" ? 3072 : 2048
    );
    // 阴影相机必须覆盖到营地(z 最远约 21), 否则远处帐篷没有影子。
    //
    // 原来只到 ±15/±14, 刚好只盖住棋盘。结果是营地帐篷全都没有投影,
    // 在玩家默认的俯视视角下看着像"浮在空中" —— 一开始我以为是帐篷
    // 坐标没贴地, 实测底部 gap 是 0.00, 真正缺的是影子。
    this.sun.shadow.camera.left = -26;
    this.sun.shadow.camera.right = 26;
    this.sun.shadow.camera.top = 26;
    this.sun.shadow.camera.bottom = -26;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 62;
    this.sun.shadow.bias = -0.00018;
    this.sun.shadow.normalBias = 0.025;
    this.scene.add(this.sun);

    this.rim = new THREE.DirectionalLight(0x46808f, 0.72);
    this.rim.position.set(7, 5, -9);
    this.scene.add(this.rim);

    const warmFill = new THREE.PointLight(0xe0954e, 3.4, 15, 1.8);
    warmFill.position.set(-7, 2.5, 5.5);
    this.scene.add(warmFill);
  }

  buildWorld() {
    this.groundSkirt = createGroundSkirt(this.materials);
    this.scene.add(this.groundSkirt);

    this.distantRidges = createDistantRidges(this.materials, this.quality);
    this.scene.add(this.distantRidges);

    this.terrain = createTerrain(this.materials, this.quality);
    this.scene.add(this.terrain);

    this.river = createRiver(this.materials);
    this.scene.add(this.river.group);

    this.bridges = createBridges(this.materials);
    this.scene.add(this.bridges);

    this.boundary = createBoundaryDetails(this.materials, this.quality);
    this.scene.add(this.boundary);

    this.boardVisuals = createBoardVisuals(this.materials);
    this.scene.add(this.boardVisuals.group);

    this.pieceLayer = new THREE.Group();
    this.pieceLayer.name = "piece-layer";
    this.scene.add(this.pieceLayer);
  }

  bindEvents() {
    this.onResize = () => this.resize();
    window.addEventListener("resize", this.onResize);
    this.controls.addEventListener("start", () => {
      this.cameraTween = null;
    });
    this.canvas.addEventListener("pointermove", (event) => {
      this.updatePointer(event);
      this.hoverAtPointer(event);
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hovered = null;
      this.canvas.style.cursor = "default";
    });
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, this.quality === "high" ? 2 : 1.35)
    );
    this.renderer.setSize(width, height, false);
    this.applyView(this.currentView, true);
  }

  attachGame(game) {
    this.game = game;
  }

  syncBoard(state, options = {}) {
    const activeIds = new Set(state.pieces.map((piece) => piece.id));
    for (const [id, actor] of this.actors) {
      if (!activeIds.has(id) && !actor.defeating) {
        actor.group.parent?.remove(actor.group);
        this.actors.delete(id);
      }
    }

    state.pieces.forEach((piece) => {
      let actor = this.actors.get(piece.id);
      if (!actor) {
        actor = createPieceActor(piece, this.materials, { deferSculpt: true });
        this.pieceLayer.add(actor.group);
        this.actors.set(piece.id, actor);
        this.attachExternalModel(actor, piece);
      }
      actor.piece = piece;
      const position = boardPosition(piece.x, piece.y);
      const height = terrainHeightAt(position.x, position.z) + 0.05;
      if (!options.skipPosition) {
        actor.group.position.set(position.x, height, position.z);
      }
      actor.baseHeight = height;
    });
  }

  async attachExternalModel(actor, piece, attempt = 0) {
    const key = piece.side === SIDES.BLACK ? `${piece.type}-black` : piece.type;
    const model = await cloneModel(key);
    if (actor.defeating) return;
    // actor 可能是"上一次 syncBoard 建好、这一次才轮到挂模型"的状态。
    // 早先这里直接 return, 结果是棋子既没有外部模型、也没有程序化模型
    // (创建时用了 deferSculpt: true), 变成隐形棋子 —— 实测表现为
    // "红方 5 个老兵全都没有模型, 黑方 5 个正常"。
    // 现在改成: 还没入场景就稍后重试, 重试若干次仍不行才退回程序化模型,
    // 保证任何情况下棋子都看得见。
    if (!actor.group.parent) {
      if (attempt < 12) {
        window.setTimeout(() => {
          this.attachExternalModel(actor, piece, attempt + 1);
        }, 60);
        return;
      }
    }
    if (!model || !model.animations?.length) {
      actor.buildSculpt();
      return;
    }
    const fallback = actor.rig.model;
    const { scene, animations } = model;
    scene.name = `external-${piece.id}`;
    scene.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.rotation.y = Math.PI;

    // 按"目标高度 / 模型原始高度"反推缩放, 而不是给每个兵种手填系数。
    //
    // 为什么改: 原来是一张手写的 scaleByType 表(1.0~1.12), 但各兵种模型的
    // 原始高度并不一致 —— 人形绑骨脚本归一到 4.30, 四足归一到 3.30,
    // 军师 2.35。同一张系数表乘上去, 结果就是战象比人还矮、军师比老兵高一截。
    // 改成按目标高度反推后, 任何新模型替换进来都会自动落在正确尺寸上。
    const targetHeight = {
      [PIECE_TYPES.ELEPHANT]: 3.85,
      [PIECE_TYPES.CHARIOT]: 3.05,
      [PIECE_TYPES.HORSE]: 3.15,
      [PIECE_TYPES.GENERAL]: 2.95,
      [PIECE_TYPES.ADVISOR]: 2.80,
      [PIECE_TYPES.SOLDIER]: 2.62,
      [PIECE_TYPES.CANNON]: 1.85,
    };
    // 各模型绑骨后的原始高度(世界单位), 用来换算缩放
    const rawHeight = {
      [PIECE_TYPES.ELEPHANT]: 3.30,
      [PIECE_TYPES.CHARIOT]: 3.30,
      [PIECE_TYPES.HORSE]: 3.30,
      [PIECE_TYPES.GENERAL]: 3.30,
      [PIECE_TYPES.ADVISOR]: 2.35,
      [PIECE_TYPES.SOLDIER]: 3.30,
      [PIECE_TYPES.CANNON]: 1.75,
    };
    const target = targetHeight[piece.type] ?? 3.0;
    const raw = rawHeight[piece.type] ?? 3.3;
    scene.scale.setScalar(target / raw);

    actor.group.add(scene);
    if (fallback) fallback.parent?.remove(fallback);
    actor.externalModel = scene;

    // 落地校正: 把模型的最低点抬到刚好贴住地面。
    // 绑骨脚本的"底面贴地"是骨骼绑定之前做的, 蒙皮权重建立后顶点位置
    // 会随骨骼初始姿态偏移, 再加上棋子本身还有一个地形高度补偿,
    // 结果就是有的棋子悬空、有的沉进地里(实测战象 -0.16, 骑兵 +0.47)。
    //
    // 必须先 updateMatrixWorld —— 上面刚改过 scene.scale, 矩阵还是旧的,
    // 不改的话 Box3.setFromObject 会按未缩放时的尺寸算, 校正量直接算错,
    // 表现成"所有模型都沉进地里"。
    actor.group.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    this.groundModel(actor, scene);

    if (animations.length) {
      const mixer = new THREE.AnimationMixer(scene);
      const byName = new Map();
      animations.forEach((clip) => {
        const action = mixer.clipAction(clip);
        byName.set(clip.name, action);
      });
      const find = (...names) => {
        for (const name of names) {
          const exact = byName.get(name);
          if (exact) return exact;
          const insensitive = [...byName.entries()].find(([key]) =>
            key.toLowerCase().includes(name.toLowerCase())
          );
          if (insensitive) return insensitive[1];
        }
        return null;
      };
      const idle = find("idle", "待机");
      const move = find("move", "walk", "移动");
      const attack = find("attack", "击杀", "攻击");
      const defeat = find("defeat", "death", "阵亡");
      actor.mixer = mixer;
      actor.actions = { idle, move, attack, defeat };
      if (actor.currentAction && actor.currentAction !== idle) {
        actor.currentAction.fadeOut(0.1);
        actor.currentAction = null;
      }
      if (idle) {
        idle.setLoop(THREE.LoopRepeat, Infinity);
        idle.play();
        actor.currentAction = idle;
      }
    }

    // 必须放在动画装配之后 —— 它依赖 actor.rig.base 已经就位
    this.flattenBase(actor);
  }

  /**
   * 把 AI 模型的底面精确贴到棋子所在地面。
   *
   * 关键难点: 这些模型是 SkinnedMesh, 而 THREE.Box3.setFromObject 用的是
   * 几何体自身的 boundingBox —— 对蒙皮网格来说那是**绑定姿态的归一化盒子**
   * (实测 piece-mesh 的 geoY 恒为 [-1.00, 1.00]), 跟模型真实占位没关系。
   * 用它算落地校正, 得到的结果是"校正量为 0", 模型照旧陷在土里。
   *
   * 所以这里改成直接读**顶点在骨骼变换后的真实位置**:
   * 对每个 SkinnedMesh 取 geometry 的 position 属性, 用
   * boneTransform(顶点索引) 把顶点变换到骨骼空间, 再乘 mesh 的 matrixWorld,
   * 得到真正会被渲染出来的范围, 用它的 minY 做校正。
   *
   * 只动 Y, 不碰 X/Z: 模型 X/Z 中心在绑骨脚本里已经居中过, 实测偏移 0.00。
   */
  groundModel(actor, model) {
    if (!model || model.userData.grounded) return;
    actor.group.updateMatrixWorld(true);

    const minY = this.lowestRenderedY(model);
    if (!Number.isFinite(minY)) {
      // 非蒙皮模型: 退回普通包围盒
      const box = new THREE.Box3().setFromObject(model);
      if (!Number.isFinite(box.min.y)) return;
      const toLocal = new THREE.Matrix4().copy(actor.group.matrixWorld).invert();
      const localBox = box.clone().applyMatrix4(toLocal);
      model.position.y += -localBox.min.y;
      model.userData.grounded = true;
      actor.group.updateMatrixWorld(true);
      return;
    }

    // minY 是世界坐标下的最低点, 换算到 group 局部空间的 Y
    const toLocal = new THREE.Matrix4().copy(actor.group.matrixWorld).invert();
    const localPoint = new THREE.Vector3(0, minY, 0).applyMatrix4(toLocal);
    const offset = -localPoint.y;
    model.position.y += offset;
    model.userData.grounded = true;
    model.userData.groundOffset = offset;
    actor.group.updateMatrixWorld(true);
  }

  /**
   * 返回模型在**当前骨骼姿态**下、世界坐标里的最低 Y。
   *
   * 用 boneTransform 把每个顶点按其蒙皮权重变换到骨骼空间 —— 这是
   * three.js 内部渲染时走的同一条路径, 所以结果就是玩家真正看到的底面。
   * 顶点多的时候要限流, 否则 32 枚棋子 × 上万顶点会卡住首帧。
   */
  lowestRenderedY(model) {
    const bone = new THREE.Vector3();
    let lowest = Infinity;
    let found = false;
    model.traverse((mesh) => {
      if (!mesh.isSkinnedMesh || !mesh.geometry?.attributes?.position) return;
      found = true;
      const position = mesh.geometry.attributes.position;
      const count = position.count;
      // 顶点太多时隔点采样: 底面是由大量密集顶点共同定义的,
      // 隔点采样不会漏掉最低那一排, 但能把开销减半。
      const stride = count > 12000 ? 3 : count > 4000 ? 2 : 1;
      for (let i = 0; i < count; i += stride) {
        bone.fromBufferAttribute(position, i);
        mesh.applyBoneTransform(i, bone);
        bone.applyMatrix4(mesh.matrixWorld);
        if (bone.y < lowest) lowest = bone.y;
      }
    });
    // 同时兼顾非蒙皮的附属件(武器/旗帜等)
    model.traverse((mesh) => {
      if (mesh.isSkinnedMesh || !mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      const corner = new THREE.Vector3();
      for (let xi = 0; xi < 2; xi += 1) {
        for (let yi = 0; yi < 2; yi += 1) {
          for (let zi = 0; zi < 2; zi += 1) {
            corner.set(
              xi ? bb.max.x : bb.min.x,
              yi ? bb.max.y : bb.min.y,
              zi ? bb.max.z : bb.min.z
            );
            corner.applyMatrix4(mesh.matrixWorld);
            if (corner.y < lowest) {
              lowest = corner.y;
              found = true;
            }
          }
        }
      }
    });
    return found ? lowest : NaN;
  }

  /**
   * 用了 AI 模型就把装饰性底座压成一枚贴地光环。
   *
   * 底座原本是给程序化棋子用的三层圆柱 + 铭牌。人形/战象踩在这样一个
   * 圆盘上非常出戏, 但整个底座又不能直接删掉 —— 铭牌写着兵种汉字,
   * 阵营色也是分清红黑的关键。所以做法是:
   *   · 两层圆柱压扁到几乎贴地(保留阵营色, 变成光环)
   *   · 铭牌保持朝上、略微抬高一点, 免得和地面 z-fighting
   *   · 选中用的 glow 环不动
   */
  flattenBase(actor) {
    const base = actor.rig?.base;
    if (!base || base.userData.flattened) return;
    base.userData.flattened = true;
    base.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry?.type === "CircleGeometry") {
        // 铭牌: 留在贴近地面的位置, 稍微抬高避免闪烁
        child.position.y = 0.012;
        return;
      }
      if (child.geometry?.type === "TorusGeometry") {
        child.position.y = 0.02;
        child.scale.set(1, 1, 0.25);
        return;
      }
      // 圆柱底座: 压扁成光环
      child.scale.y = 0.03;
      child.position.y = 0.006;
    });

    // 大体积棋子要把整圈底座放大, 否则会踩住自己的铭牌。
    //
    // 底座原尺寸是按程序化棋子(占地约 1.1)定的: 外圈半径 0.6、铭牌半径 0.4。
    // 换成 AI 模型后, 战象的横向占地到了 1.44(半宽 0.72), 已经超过外圈 0.6,
    // 于是象腿直接把铭牌压住, "象"字只剩一半露在外面。
    const model = actor.externalModel;
    if (model) {
      // 横向半宽用和 groundModel 同一套"真实渲染范围"算法。
      // 不能用 Box3.setFromObject: 蒙皮网格的 boundingBox 是绑定姿态的
      // 归一化盒子(恒为 [-1,1]), 算出来的宽度和模型实际占位无关。
      const halfWidth = this.renderedHalfWidth(model);
      // 外圈基准半径 0.6, 留 12% 余量让光环露在模型外面
      const needed = (halfWidth * 1.12) / 0.6;
      if (Number.isFinite(needed) && needed > 1) {
        base.scale.setScalar(0.94 * Math.min(needed, 1.65));
      }
    }
  }

  /**
   * 返回模型在**当前骨骼姿态**下的世界横向半宽(相对自身中心)。
   * 和 lowestRenderedY 同一套原理, 只是取 X/Z 而不是 Y。
   */
  renderedHalfWidth(model) {
    const point = new THREE.Vector3();
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let found = false;
    model.traverse((mesh) => {
      if (mesh.isSkinnedMesh && mesh.geometry?.attributes?.position) {
        found = true;
        const position = mesh.geometry.attributes.position;
        const count = position.count;
        const stride = count > 12000 ? 3 : count > 4000 ? 2 : 1;
        for (let i = 0; i < count; i += stride) {
          point.fromBufferAttribute(position, i);
          mesh.applyBoneTransform(i, point);
          point.applyMatrix4(mesh.matrixWorld);
          if (point.x < minX) minX = point.x;
          if (point.x > maxX) maxX = point.x;
          if (point.z < minZ) minZ = point.z;
          if (point.z > maxZ) maxZ = point.z;
        }
        return;
      }
      if (!mesh.isMesh || !mesh.geometry) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox;
      for (let xi = 0; xi < 2; xi += 1) {
        for (let zi = 0; zi < 2; zi += 1) {
          for (let yi = 0; yi < 2; yi += 1) {
            point.set(
              xi ? bb.max.x : bb.min.x,
              yi ? bb.max.y : bb.min.y,
              zi ? bb.max.z : bb.min.z
            );
            point.applyMatrix4(mesh.matrixWorld);
            if (point.x < minX) minX = point.x;
            if (point.x > maxX) maxX = point.x;
            if (point.z < minZ) minZ = point.z;
            if (point.z > maxZ) maxZ = point.z;
            found = true;
          }
        }
      }
    });
    if (!found) return NaN;
    // 必须减去棋子自身的世界位置。
    // renderedHalfWidth 量的是世界坐标, 而棋子站在棋盘各处(比如 soldier 在
    // x=-7.92), 直接取 max(|minX|,|maxX|) 会把"棋子离原点的距离"当成
    // "模型的半宽" —— 实测读出来 8.5, 远超格子宽度 1.98, 于是底座被一路
    // 放大到上限, 表现为所有大棋子的光环都大了一圈。
    const center = new THREE.Vector3();
    model.getWorldPosition(center);
    // 只用横向(X)半宽, 不用纵深(Z): 战象/战车/骑兵都是长条形
    // (纵深 2.4~2.7, 横向只有 1.0~1.5)。把纵深算进来会把光环撑到近两倍,
    // 横向白白多出一大圈, 反而挤到左右邻格。真正踩铭牌的是横向的腿/轮。
    return Math.max(Math.abs(minX - center.x), Math.abs(maxX - center.x));
  }

  setSelected(piece, moves = []) {
    clearMoveMarkers(this.boardVisuals);
    this.selectedActor?.setHighlight?.(false);
    this.selectedActor = null;
    if (!piece) return;
    const actor = this.actors.get(piece.id);
    if (!actor) return;
    this.selectedActor = actor;
    actor.setHighlight?.(true);
    const markerPosition = nodePosition(piece.x, piece.y, 0.075);
    this.boardVisuals.selectionRing.visible = true;
    this.boardVisuals.selectionRing.position.copy(markerPosition);
    if (moves.length) showMoveMarkers(this.boardVisuals, moves);
  }

  showCheck(sides) {
    const checkedSides = Array.isArray(sides) ? sides : [sides];
    this.boardVisuals.warningRings.forEach((ring, index) => {
      const side = checkedSides[index];
      const actor = side
        ? [...this.actors.values()].find(
            (candidate) =>
              candidate.piece.side === side &&
              candidate.piece.type === PIECE_TYPES.GENERAL
          )
        : null;
      ring.visible = Boolean(actor);
      if (actor) {
        ring.position.copy(nodePosition(actor.piece.x, actor.piece.y, 0.08));
      }
    });
  }

  hideCheck() {
    this.boardVisuals.warningRings.forEach((ring) => (ring.visible = false));
  }

  setHovered(piece) {
    this.hovered = piece;
    this.actors.forEach((actor) => {
      const isHovered = piece && actor.piece?.id === piece.id;
      actor.setHover?.(isHovered);
    });
    if (!piece) {
      this.canvas.style.cursor = "default";
      return;
    }
    this.canvas.style.cursor =
      piece.side === this.game?.state?.turn ? "pointer" : "help";
  }

  updatePointer(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  raycast() {
    const screenSquare = this.squareFromScreen();
    if (screenSquare) return screenSquare;

    this.raycaster.setFromCamera(this.pointer, this.camera);
    const pickables = [this.terrain];
    this.actors.forEach((actor) => {
      if (this.retiringIds.has(actor.piece.id)) return;
      pickables.push(actor.group);
    });
    const intersects = this.raycaster.intersectObjects(pickables, true);
    if (!intersects.length) return null;
    const hit = intersects[0];
    const actor = findActorFromObject(hit.object);
    if (actor) {
      return { x: actor.piece.x, y: actor.piece.y };
    }
    const point = hit.point;
    let nearest = null;
    const nearestDistanceLimit = Math.max(
      BOARD_SPACING.x,
      BOARD_SPACING.y
    ) * 0.62;
    let nearestDistance = nearestDistanceLimit;
    for (let y = 0; y < BOARD_ROWS; y += 1) {
      for (let x = 0; x < BOARD_COLUMNS; x += 1) {
        const node = nodePosition(x, y, 0.12);
        const distance = node.distanceTo(point);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = { x, y };
        }
      }
    }
    return nearest;
  }

  squareFromScreen() {
    if (!this._screenProjection) {
      this._screenProjection = [];
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    const pointerX = ((this.pointer.x + 1) / 2) * width;
    const pointerY = ((1 - this.pointer.y) / 2) * height;
    const cacheKey = `${this.camera.position.x.toFixed(2)},${this.camera.position.y.toFixed(2)},${this.camera.position.z.toFixed(2)},${this.controls.target.x.toFixed(2)},${this.controls.target.y.toFixed(2)},${this.controls.target.z.toFixed(2)},${width},${height}`;
    if (this._screenCacheKey !== cacheKey) {
      this.camera.updateMatrixWorld(true);
      const projected = [];
      for (let y = 0; y < BOARD_ROWS; y += 1) {
        for (let x = 0; x < BOARD_COLUMNS; x += 1) {
          const world = nodePosition(x, y, 0.15);
          const point = world.clone().project(this.camera);
          projected.push({
            x,
            y,
            px: ((point.x + 1) / 2) * width,
            py: ((1 - point.y) / 2) * height,
            behind: point.z > 1,
          });
        }
      }
      this._screenProjection = projected;
      this._screenCacheKey = cacheKey;
    }

    let nearest = null;
    let nearestDistance = Infinity;
    let nearestNeighbor = Infinity;
    for (const entry of this._screenProjection) {
      if (entry.behind) continue;
      const distance = Math.hypot(entry.px - pointerX, entry.py - pointerY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = entry;
      }
    }
    if (!nearest) return null;
    for (const entry of this._screenProjection) {
      if (entry.behind || entry === nearest) continue;
      const distance = Math.hypot(entry.px - nearest.px, entry.py - nearest.py);
      if (distance > 1 && distance < nearestNeighbor) nearestNeighbor = distance;
    }
    const reach = Number.isFinite(nearestNeighbor)
      ? Math.max(24, nearestNeighbor * 0.66)
      : 48;
    if (nearestDistance > reach) return null;
    return { x: nearest.x, y: nearest.y };
  }

  hoverAtPointer(event) {
    if (!this.game?.state) return;
    if (event.pointerType === "touch") return;
    const square = this.raycast();
    if (!square) {
      this.setHovered(null);
      return;
    }
    const piece = this.game.state.pieceAt(square.x, square.y);
    this.setHovered(piece ?? null);
  }

  squareAtPointer(event) {
    this.updatePointer(event);
    return this.raycast();
  }

  screenPositionForSquare(x, y) {
    this.camera.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    const world = nodePosition(x, y, 0.15);
    const projected = world.clone().project(this.camera);
    return {
      x: ((projected.x + 1) / 2) * window.innerWidth,
      y: ((1 - projected.y) / 2) * window.innerHeight,
    };
  }

  boardStateForDebug() {
    return {
      turn: this.game?.state?.turn ?? null,
      selected: this.game?.selected
        ? {
            id: this.game.selected.id,
            type: this.game.selected.type,
            x: this.game.selected.x,
            y: this.game.selected.y,
          }
        : null,
      moves: (this.game?.selectedMoves ?? []).map((move) => ({
        x: move.x,
        y: move.y,
      })),
      historyLength: this.game?.moveHistory?.length ?? 0,
      busy: this.game?.busy ?? false,
    };
  }

  animateMove(piece, from, to, options = {}) {
    const actor = this.actors.get(piece.id);
    if (!actor) return Promise.resolve();
    const fromPosition = boardPosition(from.x, from.y);
    const toPosition = boardPosition(to.x, to.y);
    const start = new THREE.Vector3(
      fromPosition.x,
      terrainHeightAt(fromPosition.x, fromPosition.z) + 0.05,
      fromPosition.z
    );
    const end = new THREE.Vector3(
      toPosition.x,
      terrainHeightAt(toPosition.x, toPosition.z) + 0.05,
      toPosition.z
    );
    // 各兵种位移速度不同: 骑兵冲锋最快, 战象/炮车最慢。
    // 统一 0.4s 会让轻骑兵显得拖着步子走、重装单位显得瞬移。
    const moveDurationByType = {
      [PIECE_TYPES.ELEPHANT]: 0.68,
      [PIECE_TYPES.CANNON]: 0.62,
      [PIECE_TYPES.GENERAL]: 0.52,
      [PIECE_TYPES.CHARIOT]: 0.5,
      [PIECE_TYPES.ADVISOR]: 0.5,
      [PIECE_TYPES.SOLDIER]: 0.46,
      [PIECE_TYPES.HORSE]: 0.44,
    };
    const duration =
      options.duration ?? moveDurationByType[actor.piece.type] ?? 0.46;
    const startTime = performance.now() / 1000;
    const direction = end.clone().sub(start);
    actor.group.rotation.y = Math.atan2(direction.x, direction.z);
    const isHorse = actor.piece.type === PIECE_TYPES.HORSE;

    // 走路动作交给模型自带的 Move 片段。
    // 早先这里从不播 Move —— controller 对"任何一步"都调 playAttack,
    // 结果所有棋子一到移动就摆攻击姿势, 走路的 clip 从来没被用过。
    if (!options.noWalk) this.playMove(piece, { seconds: duration });

    return new Promise((resolve) => {
      let settled = false;
      let guard = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(guard);
        actor.group.position.copy(end);
        actor.group.rotation.y = actor.baseYaw;
        // 走到位置后收步态, 否则棋子会僵在迈步姿势上原地踏步
        this.stopMove(actor.piece);
        resolve();
      };
      const animate = () => {
        if (settled) return;
        const now = performance.now() / 1000;
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / duration);
        const eased = t * t * (3 - 2 * t);
        actor.group.position.lerpVectors(start, end, eased);
        if (isHorse || actor.piece.type === PIECE_TYPES.CHARIOT) {
          const hop = Math.sin(t * Math.PI) * (isHorse ? 0.22 : 0.07);
          actor.group.position.y += hop;
          if (actor.rig.legs) {
            actor.rig.legs.forEach((leg, index) => {
              leg.rotation.x = Math.sin(t * Math.PI * 2 + index) * 0.45;
            });
          }
        }
        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          finish();
        }
      };
      // 兜底: requestAnimationFrame 在页面切到后台、渲染循环被节流时
      // 会长时间不触发。没有这个定时器, 棋子会永远停在半路,
      // 而且 controller 会因为 await 不到而一直 busy, 表现成"点击没反应"。
      guard = window.setTimeout(finish, duration * 1000 + 600);
      requestAnimationFrame(animate);
    });
  }

  /**
   * 播走路的循环动作。返回一个步态周期的秒数, 0 表示没有可用的 walk clip。
   *
   * 循环次数按"位移时间 / 一个步态周期"折算, 这样走得远的步数会多迈几步,
   * 而不是一个周期走完全程(那样像是在滑行)。
   */
  playMove(piece, options = {}) {
    const actor = this.actors.get(piece?.id);
    if (actor?.actions?.move) {
      const action = playActorAction(actor, "move", { fade: 0.12 });
      if (action) {
        const clipSeconds = Math.max(0.2, action.getClip().duration);
        const travelSeconds = options.seconds ?? 0.4;
        action.setLoop(
          THREE.LoopRepeat,
          Math.max(1, Math.round(travelSeconds / clipSeconds))
        );
        action.timeScale = options.timeScale ?? 1;
        actor.moving = true;
        return clipSeconds;
      }
    }
    // 没有行走 clip 的旧资源: 退回原来的程序化摆动
    actor?.move?.(options);
    return 0;
  }

  stopMove(piece) {
    const actor = this.actors.get(piece?.id);
    if (!actor) return;
    actor.moving = false;
    if (actor.actions?.move && actor.currentAction === actor.actions.move) {
      playActorAction(actor, "idle", { fade: 0.18 });
    }
  }

  playAttack(piece, kind, onHit) {
    const actor = this.actors.get(piece.id);
    if (actor?.mixer) {
      const action = playActorAction(actor, "attack");
      if (action && onHit) {
        const durationMs = Math.max(120, action.getClip().duration * 1000);
        window.setTimeout(() => {
          if (actor.group.parent) onHit();
        }, durationMs * 0.44);
      }
      return;
    }
    actor?.attack(kind, onHit);
  }

  impactAt(x, y, heavy = false) {
    this.effects.impact(nodePosition(x, y, 0.34), heavy);
  }

  killAt(x, y, heavy = false, shake = true) {
    const impactPoint = nodePosition(x, y, 0.3);
    this.effects.killBurst(impactPoint, heavy);
    this.effects.impact(impactPoint, heavy);
    this.effects.dust(
      impactPoint,
      heavy ? 0x5c5046 : 0x7d7161,
      heavy ? 2.1 : 1.35
    );
    if (shake && !this.reducedMotion) this.shakeCamera(heavy ? 0.34 : 0.19, heavy ? 420 : 300);
    if (!this.reducedMotion) {
      this.timeScaleTarget = heavy ? 0.22 : 0.38;
      this.timeScaleBlend = 14;
      window.clearTimeout(this.killCamTimer);
      this.killCamTimer = window.setTimeout(() => {
        this.timeScaleTarget = 1;
        this.timeScaleBlend = 4.2;
      }, heavy ? 340 : 230);
    }
  }

  shakeCamera(intensity = 0.18, duration = 320) {
    const baseTarget = this.controls.target.clone();
    const startedAt = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - startedAt) / duration);
      const decay = (1 - t) * intensity;
      this.controls.target.set(
        baseTarget.x + (Math.random() - 0.5) * decay,
        baseTarget.y + (Math.random() - 0.5) * decay * 0.6,
        baseTarget.z + (Math.random() - 0.5) * decay
      );
      if (t < 1) requestAnimationFrame(step);
      else this.controls.target.copy(baseTarget);
    };
    requestAnimationFrame(step);
  }

  defeatActor(id, duration = 520) {
    const actor = this.actors.get(id);
    if (!actor) return Promise.resolve();

    // 倒地由 actor.beginDefeat() 统一驱动, 按兵种给不同的翻倒姿态。
    //
    // 走过的弯路: 我一开始在这里另写了一套 defeatChoreography, 想按兵种
    // 差异化。但它和 actor.update() 里的 updateDefeat() 打架 —— 只要
    // actor.defeating 为真, update() 每帧都会用固定值覆盖 group.rotation
    // (z=1.18, x=0.22) 和 position.y, 我写的角度根本留不住。实测七个兵种
    // 倒下后 rz 全是 1.180, 就是被这里覆盖的。
    //
    // 正确做法是让倒地只有一个写入者: 差异化做进 PieceActor 自己的
    // defeatProfile(见 pieces.js), 这里只负责"叫它倒、等它倒完、再移除"。
    actor.setDefeatProfile?.(actor.piece?.type);

    // 模型自带的 Defeat 片段仍然播 —— 它是"人倒下过程中的挣扎/姿态",
    // 叠在刚体倒地之上, 比纯刚体自然。没有这个片段也不影响倒地。
    if (actor.mixer) {
      playActorAction(actor, "defeat", { clamp: true, fade: 0.14 });
    }
    actor.beginDefeat(actor.defeatDuration || 0.76);
    actor.defeating = true;
    this.retiringIds.add(id);

    // 等倒地播完再移除, 否则会"倒一半突然消失"
    const holdMs = Math.max(duration, (actor.defeatDuration || 0.76) * 1000 + 110);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.retiringIds.delete(id);
        this.removeActor(id);
        resolve();
      }, holdMs);
    });
  }

  cannonShot(from, to, onImpact) {
    const fromPosition = boardPosition(from.x, from.y);
    const toPosition = boardPosition(to.x, to.y);
    const start = new THREE.Vector3(
      fromPosition.x,
      terrainHeightAt(fromPosition.x, fromPosition.z) + 0.05,
      fromPosition.z
    );
    const end = new THREE.Vector3(
      toPosition.x,
      terrainHeightAt(toPosition.x, toPosition.z) + 0.05,
      toPosition.z
    );
    return this.effects.cannonTrail(start, end, onImpact);
  }

  removeActor(id) {
    const actor = this.actors.get(id);
    if (!actor) return;
    // 取消可能还在跑的倒地帧, 免得它继续持有已经脱离场景的 group
    if (actor.defeatRaf) {
      window.cancelAnimationFrame(actor.defeatRaf);
      actor.defeatRaf = 0;
    }
    actor.group.parent?.remove(actor.group);
    this.actors.delete(id);
  }

  setView(view) {
    this.currentView = view;
    this.applyView(view);
  }

  applyView(view, immediate = false) {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const portrait = aspect < 0.78;
    const narrow = aspect < 1.08;
    const fit = portrait ? 1.52 : narrow ? 1.22 : 1;
    const lift = portrait ? 1.1 : narrow ? 0.5 : 0;
    const presets = {
      red: {
        target: [0, 0.55 + lift, 0.4],
        position: [-3.2, 21.4, 28.6],
      },
      black: {
        target: [0, 0.55 + lift, -0.4],
        position: [3.2, 21.4, -28.6],
      },
      low: {
        target: [-0.8, 0.9 + lift, 2.4],
        position: [-11.8, 10.4, 21.4],
      },
      top: {
        target: [0, 0.45 + lift, 0],
        position: [0.01, 40.5, 6.2],
      },
    };
    const preset = presets[view] ?? presets.red;
    const target = new THREE.Vector3(preset.target[0], preset.target[1], preset.target[2]);
    const position = new THREE.Vector3(
      preset.position[0] * (portrait ? 0.76 : 1),
      preset.position[1] * fit,
      preset.position[2] * fit
    );
    this.camera.up.set(0, 1, 0);
    this.controls.minDistance = view === "top" ? 13 : 8.5;
    this.controls.maxDistance = view === "top" ? 62 : 72;
    if (immediate) {
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.cameraTween = null;
      this.controls.update();
      return;
    }
    this.cameraTween = {
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromPosition: this.camera.position.clone(),
      toPosition: position,
      startedAt: performance.now(),
      duration: 720,
    };
  }

  focusSquare(x, y, options = {}) {
    const position = boardPosition(x, y);
    const height = terrainHeightAt(position.x, position.z);
    const target = new THREE.Vector3(position.x, height + 0.5, position.z);
    const distance = options.distance ?? Math.min(this.camera.position.distanceTo(this.controls.target), 19);
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    if (!Number.isFinite(direction.x)) direction.set(0, 0.72, 0.7).normalize();
    direction.y = Math.max(0.46, direction.y);
    direction.normalize();
    const cameraTarget = target.clone().addScaledVector(direction, distance);

    this.cameraTween = {
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromPosition: this.camera.position.clone(),
      toPosition: cameraTarget,
      startedAt: performance.now(),
      duration: options.immediate ? 0 : (options.duration ?? 620),
    };
  }

  /**
   * Short cinematic beat for captures: frame the victim from just above the
   * board, hold briefly, then hand control back where the player left it.
   */
  killFocus(x, y, options = {}) {
    if (this.reducedMotion) return;
    const position = boardPosition(x, y);
    const height = terrainHeightAt(position.x, position.z);
    const target = new THREE.Vector3(position.x, height + 0.62, position.z);
    const distance = options.distance ?? 11.5;
    const bearing = this.camera.position
      .clone()
      .sub(this.controls.target)
      .setY(0);
    if (bearing.lengthSq() < 0.001) bearing.set(0, 0, 1);
    bearing.normalize();
    bearing.applyAxisAngle(new THREE.Vector3(0, 1, 0), options.orbit ?? -0.42);
    const cameraTarget = target
      .clone()
      .addScaledVector(bearing, distance)
      .add(new THREE.Vector3(0, distance * 0.72, 0));

    const returnTarget = this.controls.target.clone();
    const returnPosition = this.camera.position.clone();
    this.cameraTween = {
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      fromPosition: this.camera.position.clone(),
      toPosition: cameraTarget,
      startedAt: performance.now(),
      duration: options.inDuration ?? 260,
    };
    window.clearTimeout(this.killReturnTimer);
    this.killReturnTimer = window.setTimeout(() => {
      this.cameraTween = {
        fromTarget: this.controls.target.clone(),
        toTarget: returnTarget,
        fromPosition: this.camera.position.clone(),
        toPosition: returnPosition,
        startedAt: performance.now(),
        duration: options.outDuration ?? 520,
      };
    }, options.hold ?? 620);
  }

  zoomBy(factor) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(
      offset.length() * factor,
      this.controls.minDistance,
      this.controls.maxDistance
    );
    offset.setLength(distance);
    this.cameraTween = {
      fromTarget: this.controls.target.clone(),
      toTarget: this.controls.target.clone(),
      fromPosition: this.camera.position.clone(),
      toPosition: this.controls.target.clone().add(offset),
      startedAt: performance.now(),
      duration: 260,
    };
  }

  rotateBy(angle) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.cameraTween = {
      fromTarget: this.controls.target.clone(),
      toTarget: this.controls.target.clone(),
      fromPosition: this.camera.position.clone(),
      toPosition: this.controls.target.clone().add(offset),
      startedAt: performance.now(),
      duration: 300,
    };
  }

  panBy(delta) {
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, new THREE.Vector3());
    right.y = 0;
    right.normalize();
    const forward = new THREE.Vector3().crossVectors(right, new THREE.Vector3(0, 1, 0));
    const shift = right.multiplyScalar(delta.x).add(forward.multiplyScalar(delta.z));
    this.controls.target.add(shift);
    this.camera.position.add(shift);
  }

  updateCameraTween(now) {
    const tween = this.cameraTween;
    if (!tween) return;
    const raw = tween.duration > 0 ? (now - tween.startedAt) / tween.duration : 1;
    const t = Math.min(1, Math.max(0, raw));
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.controls.target.lerpVectors(tween.fromTarget, tween.toTarget, eased);
    this.camera.position.lerpVectors(tween.fromPosition, tween.toPosition, eased);
    if (t >= 1) this.cameraTween = null;
  }

  setReducedMotion(value) {
    this.reducedMotion = value;
  }

  setQuality(quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    const high = quality === "high";
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, high ? 2 : 1.25)
    );
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.sun.shadow.mapSize.set(high ? 2048 : 1024, high ? 2048 : 1024);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.scene.fog.density = high ? 0.022 : 0.028;
  }

  start() {
    const frame = () => {
      this.animationId = requestAnimationFrame(frame);
      const rawDelta = Math.min(0.05, this.clock.getDelta());
      const blend = 1 - Math.exp(-this.timeScaleBlend * rawDelta);
      this.timeScale += (this.timeScaleTarget - this.timeScale) * blend;
      const delta = rawDelta * this.timeScale;
      const time = this.clock.elapsedTime;
      this.sceneTime += delta;
      const scaledTime = this.sceneTime;
      this.updateCameraTween(performance.now());
      this.controls.update();
      updateRiver(this.river, this.reducedMotion ? scaledTime * 0.25 : scaledTime);
      updateBoundaryDetails(
        this.boundary,
        this.reducedMotion ? scaledTime * 0.2 : scaledTime
      );
      this.boardVisuals.update(scaledTime);
      this.actors.forEach((actor) => {
        actor.mixer?.update(delta);
        actor.update(scaledTime, delta, this.reducedMotion);
      });
      this.effects.update(delta);
      this.renderer.render(this.scene, this.camera);
    };
    frame();
  }

  dispose() {
    cancelAnimationFrame(this.animationId);
    window.removeEventListener("resize", this.onResize);
    this.controls.dispose();
    this.renderer.dispose();
  }
}

function findActorFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.actor) return current.userData.actor;
    current = current.parent;
  }
  return null;
}

function playActorAction(actor, slot, options = {}) {
  const action = actor.actions?.[slot];
  if (!action) return null;
  const previous = actor.currentAction;
  if (previous && previous !== action) previous.fadeOut(options.fade ?? 0.12);
  action.reset();
  action.enabled = true;
  action.setEffectiveWeight(1);
  action.setLoop(options.clamp ? THREE.LoopOnce : THREE.LoopRepeat, options.clamp ? 1 : Infinity);
  action.clampWhenFinished = Boolean(options.clamp);
  action.fadeIn(options.fade ?? 0.1);
  action.play();
  actor.currentAction = action;
  if (slot !== "defeat") {
    window.setTimeout(() => {
      if (!actor.group.parent || actor.currentAction === action) {
        playActorAction(actor, "idle", { fade: 0.2 });
      }
    }, Math.max(60, action.getClip().duration * 1000 - 120));
  }
  return action;
}
