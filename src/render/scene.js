import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
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

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.environmentMap = pmrem.fromScene(new RoomEnvironment(), 0.02).texture;
    this.scene.environment = this.environmentMap;
    this.scene.environmentIntensity = 0.22;
    pmrem.dispose();

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

  setupLights() {
    const hemi = new THREE.HemisphereLight(0x93a89f, 0x4a3623, 0.5);
    this.scene.add(hemi);

    const ambient = new THREE.AmbientLight(0xa88f66, 0.13);
    this.scene.add(ambient);

    this.sun = new THREE.DirectionalLight(0xffc987, 4.1);
    this.sun.position.set(-11, 15.5, 9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(
      this.quality === "high" ? 2048 : 1024,
      this.quality === "high" ? 2048 : 1024
    );
    this.sun.shadow.camera.left = -15;
    this.sun.shadow.camera.right = 15;
    this.sun.shadow.camera.top = 14;
    this.sun.shadow.camera.bottom = -14;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 38;
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

  async attachExternalModel(actor, piece) {
    const key = piece.side === SIDES.BLACK ? `${piece.type}-black` : piece.type;
    const model = await cloneModel(key);
    if (actor.defeating || !actor.group.parent) return;
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
    actor.group.add(scene);
    if (fallback) fallback.parent?.remove(fallback);
    actor.externalModel = scene;
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
    const duration = options.duration ?? (actor.piece.type === PIECE_TYPES.HORSE ? 0.46 : 0.4);
    const startTime = performance.now() / 1000;
    const direction = end.clone().sub(start);
    actor.group.rotation.y = Math.atan2(direction.x, direction.z);
    const isHorse = actor.piece.type === PIECE_TYPES.HORSE;

    return new Promise((resolve) => {
      const animate = () => {
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
          actor.group.position.copy(end);
          actor.group.rotation.y = actor.baseYaw;
          resolve();
        }
      };
      requestAnimationFrame(animate);
    });
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
    if (actor.mixer) {
      const action = playActorAction(actor, "defeat", { clamp: true, fade: 0.14 });
      if (action) {
        const durationMs = Math.max(duration, action.getClip().duration * 1000 * 0.7);
        actor.defeating = true;
        this.retiringIds.add(id);
        return new Promise((resolve) => {
          window.setTimeout(() => {
            this.retiringIds.delete(id);
            this.removeActor(id);
            resolve();
          }, durationMs);
        });
      }
    }
    actor.beginDefeat(duration / 1000);
    this.retiringIds.add(id);
    return new Promise((resolve) => {
      window.setTimeout(() => {
        this.retiringIds.delete(id);
        this.removeActor(id);
        resolve();
      }, duration);
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
