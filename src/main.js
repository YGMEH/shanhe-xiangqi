import "./styles.css";
import { GameController } from "./game/controller.js";
import { AudioEngine } from "./audio/audio-engine.js";
import { createMaterialLibrary } from "./render/materials.js";
import { GameScene } from "./render/scene.js";
import { GameUI } from "./ui/ui.js";
import { SIDES } from "./game/constants.js";
import { clearGame, hasSavedGame, loadGame } from "./game/save.js";
import {
  createCampaignProgress,
  evaluateCampaign,
  getCampaignLevel,
} from "./game/campaigns.js";

const canvas = document.getElementById("battlefield");
const ui = new GameUI();
const audio = new AudioEngine();
const SETTINGS_KEY = "shanhe-xiangqi-settings-v1";
const CAMPAIGN_KEY = "shanhe-xiangqi-campaign-v1";
let scene;
let controller;
let gameStarted = false;
let muted = false;
let manualMode = "ai";
let currentView = "red";
let startMode = "quick";
let campaignProgress = createCampaignProgress();
let activeCampaignLevel = null;

async function boot() {
  try {
    restoreSettings(ui.elements);
    campaignProgress = loadCampaignProgress();
    const requestedQuality = ui.elements.qualitySelect.value;
    const quality =
      requestedQuality === "auto" ? detectQuality() : requestedQuality;
    ui.setLoadingLabel("正在运入石木");
    const materials = await createMaterialLibrary({
      capabilities: { getMaxAnisotropy: () => 8 },
    });
    ui.setLoadingLabel("正在部署两军");
    scene = new GameScene(canvas, materials, {
      quality,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    });
    controller = new GameController({ scene, ui, audio });
    controller.onCampaignResult = recordCampaignResult;
    controller.attach();
    ui.setContinueAvailable(hasSavedGame());
    ui.renderCampaign(campaignProgress, startCampaignLevel);
    ui.setStartMode(startMode);
    window.__SHANHE_DEBUG__ = {
      controller,
      scene,
      ui,
      screenPositionForSquare: (x, y) => scene.screenPositionForSquare(x, y),
      boardState: () => scene.boardStateForDebug(),
    };

    bindInterface();
    bindSettingPersistence();
    bindCanvasInput();
    bindKeyboard();
    bindVisibility();

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotion.addEventListener?.("change", (event) => {
      scene.setReducedMotion(event.matches);
    });
    window.setTimeout(() => ui.hideLoading(), 280);
  } catch (error) {
    ui.setLoadingLabel("战场载入失败");
    showFatalError(error);
    ui.hideLoading();
  }
}

function detectQuality() {
  const memory = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mobile = window.matchMedia("(pointer: coarse)").matches;
  return mobile || memory < 4 || cores < 4 ? "balanced" : "high";
}

function startGame() {
  if (!controller) return;
  if (startMode === "campaign") {
    ui.toggleCampaign(true);
    return;
  }
  audio.unlock();
  const playerSide = ui.elements.sideSelect.value;
  const difficulty = Number(ui.elements.difficultySelect.value);
  saveSettings(ui.elements, manualMode, muted);
  clearGame();
  controller.configure({ playerSide, difficulty, mode: manualMode });
  activeCampaignLevel = null;
  ui.setModeLabel(manualMode, playerSide);
  ui.hideStart();
  gameStarted = true;
  scene.setView(playerSide === SIDES.BLACK ? "black" : "red");
  currentView = playerSide === SIDES.BLACK ? "black" : "red";
  ui.renderTurn(controller.state.turn, "请选择一枚棋子");
  if (manualMode === "ai" && controller.state.turn === controller.aiSide) {
    controller.makeAiMove();
  }
}

function startCampaignLevel(levelId) {
  const level = getCampaignLevel(levelId);
  if (!level || !controller) return;
  audio.unlock();
  clearGame();
  manualMode = "ai";
  activeCampaignLevel = level;
  controller.configure({
    playerSide: level.playerSide,
    difficulty: level.difficulty,
    mode: "ai",
    pieces: level.board,
    campaign: level,
  });
  ui.setModeLabel("ai", level.playerSide);
  ui.hideStart();
  ui.toggleCampaign(false);
  gameStarted = true;
  scene.setView(level.playerSide === SIDES.BLACK ? "black" : "red");
  currentView = level.playerSide === SIDES.BLACK ? "black" : "red";
  ui.renderTurn(controller.state.turn, "战役目标已载入");
}

function continueGame() {
  if (!controller) return;
  const save = loadGame();
  if (!save) {
    ui.setContinueAvailable(false);
    ui.showToast("没有可继续的棋局");
    return;
  }
  audio.unlock();
  controller.configure({
    playerSide: save.playerSide,
    difficulty: save.difficulty,
    mode: save.mode,
  });
  controller.restore(save);
  activeCampaignLevel = save.campaign ?? null;
  controller.autoSaveEnabled = true;
  manualMode = save.mode;
  ui.setModeLabel(save.mode, save.playerSide);
  ui.hideStart();
  gameStarted = true;
  scene.setView(save.playerSide === SIDES.BLACK ? "black" : "red");
  currentView = save.playerSide === SIDES.BLACK ? "black" : "red";
}

function bindInterface() {
  ui.elements.quickMatchButton.addEventListener("click", () => {
    startMode = "quick";
    ui.setStartMode(startMode);
  });
  ui.elements.campaignButton.addEventListener("click", () => {
    startMode = "campaign";
    ui.setStartMode(startMode);
    ui.toggleCampaign(true);
  });
  ui.elements.closeCampaign.addEventListener("click", () => {
    ui.toggleCampaign(false);
  });
  ui.elements.campaignPanel.addEventListener("click", (event) => {
    if (event.target === ui.elements.campaignPanel) ui.toggleCampaign(false);
  });
  ui.elements.startButton.addEventListener("click", startGame);
  ui.elements.continueButton.addEventListener("click", continueGame);

  ui.elements.view.addEventListener("click", () => {
    currentView =
      currentView === "red"
        ? "black"
        : currentView === "black"
          ? "low"
          : currentView === "low"
            ? "top"
            : "red";
    scene.setView(currentView);
    const names = {
      red: "蜀军视角",
      black: "魏军视角",
      low: "营寨近景",
      top: "战场俯瞰",
    };
    ui.showToast(names[currentView], 900);
  });

  ui.elements.cameraZoomIn?.addEventListener("click", () => scene.zoomBy(0.82));
  ui.elements.cameraZoomOut?.addEventListener("click", () => scene.zoomBy(1.22));
  ui.elements.cameraRotateLeft?.addEventListener("click", () => scene.rotateBy(-0.22));
  ui.elements.cameraRotateRight?.addEventListener("click", () => scene.rotateBy(0.22));
  ui.elements.cameraReset?.addEventListener("click", () => {
    scene.setView(currentView);
    ui.showToast("镜头已复位", 800);
  });

  ui.elements.sound.addEventListener("click", () => {
    muted = !muted;
    audio.setMuted(muted);
    ui.elements.sound.classList.toggle("is-muted", muted);
    ui.elements.sound.setAttribute("aria-label", muted ? "开启声音" : "关闭声音");
    ui.elements.sound.title = muted ? "开启声音" : "关闭声音";
    saveSettings(ui.elements, manualMode, muted);
  });

  ui.elements.help.addEventListener("click", () => ui.toggleHelp(true));
  ui.elements.closeHelp.addEventListener("click", () => ui.toggleHelp(false));
  ui.elements.helpPanel.addEventListener("click", (event) => {
    if (event.target === ui.elements.helpPanel) ui.toggleHelp(false);
  });

  ui.elements.mode.addEventListener("click", () => {
    manualMode = manualMode === "ai" ? "local" : "ai";
    ui.setModeLabel(manualMode, ui.elements.sideSelect.value);
    ui.showToast(manualMode === "ai" ? "已切换人机对弈" : "已切换双人演武", 1000);
    saveSettings(ui.elements, manualMode, muted);
    if (gameStarted) restartGame();
  });

  ui.elements.restart.addEventListener("click", restartGame);
  ui.elements.resultRestart.addEventListener("click", restartGame);
  ui.elements.resultClose.addEventListener("click", () => ui.hideResult());
  ui.elements.undo.addEventListener("click", () => controller.undo());

  ui.elements.sideSelect.addEventListener("change", () => {
    persistSelection();
    if (gameStarted) restartGame();
  });
  ui.elements.difficultySelect.addEventListener("change", () => {
    persistSelection();
    if (gameStarted) restartGame();
  });
  ui.elements.qualitySelect.addEventListener("change", () => {
    persistSelection();
    const selected = ui.elements.qualitySelect.value;
    scene.setQuality(selected === "auto" ? detectQuality() : selected);
    ui.showToast("画面品质已更新", 1000);
  });
}

function saveCampaignProgress() {
  try {
    window.localStorage.setItem(CAMPAIGN_KEY, JSON.stringify(campaignProgress));
  } catch {
    // Storage can be unavailable.
  }
}

function loadCampaignProgress() {
  try {
    const value = JSON.parse(window.localStorage.getItem(CAMPAIGN_KEY) ?? "null");
    if (
      value?.version === campaignProgress.version &&
      value.completed &&
      typeof value.completed === "object"
    ) {
      return value;
    }
  } catch {
    // Fall through to a fresh progression record.
  }
  return campaignProgress;
}

function recordCampaignResult() {
  if (!activeCampaignLevel || !controller?.gameOver) return;
  const result = evaluateCampaign(
    controller.state,
    controller,
    activeCampaignLevel
  );
  if (!result.achieved) return;
  const previous = campaignProgress.completed[activeCampaignLevel.id];
  campaignProgress.completed[activeCampaignLevel.id] = {
    achieved: true,
    stars: result.stars,
    bestPlies: Math.min(
      previous?.bestPlies ?? Number.POSITIVE_INFINITY,
      controller.moveHistory.length
    ),
  };
  saveCampaignProgress();
  ui.renderCampaign(campaignProgress, startCampaignLevel);
}

function persistSelection() {
  saveSettings(ui.elements, manualMode, muted);
}

function bindSettingPersistence() {
  document.addEventListener("change", (event) => {
    if (
      event.target?.id === "side-select" ||
      event.target?.id === "difficulty-select" ||
      event.target?.id === "quality-select"
    ) {
      persistSelection();
    }
  });
}

function restartGame() {
  if (!gameStarted) return;
  const playerSide = ui.elements.sideSelect.value;
  const difficulty = Number(ui.elements.difficultySelect.value);
  clearGame();
  controller.configure({ playerSide, difficulty, mode: manualMode });
  ui.setModeLabel(manualMode, playerSide);
  ui.renderTurn(controller.state.turn, "请选择一枚棋子");
  scene.setView(playerSide === SIDES.BLACK ? "black" : "red");
  currentView = playerSide === SIDES.BLACK ? "black" : "red";
  ui.showToast("新局已展开", 900);
  if (manualMode === "ai" && controller.state.turn === controller.aiSide) {
    controller.makeAiMove();
  }
}

function bindCanvasInput() {
  let down = null;
  let moved = false;

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    down = { x: event.clientX, y: event.clientY, time: performance.now() };
    moved = false;
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7) {
      moved = true;
    }
  });

  canvas.addEventListener("pointerup", async (event) => {
    if (!down || event.button !== 0 || moved) {
      down = null;
      return;
    }
    const elapsed = performance.now() - down.time;
    down = null;
    if (elapsed > 650 || !controller || !gameStarted) return;
    const square = scene.squareAtPointer(event);
    if (!square) return;
    await controller.squareClicked(square.x, square.y);
  });

  canvas.addEventListener("dblclick", (event) => {
    if (!controller || !gameStarted) return;
    const square = scene.squareAtPointer(event);
    if (square) scene.focusSquare(square.x, square.y, { distance: 12 });
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!controller || !gameStarted) return;
      event.preventDefault();
    },
    { passive: false }
  );
}

function bindKeyboard() {
  const panKeys = new Set(["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"]);
  const pressed = new Set();
  let panFrame = null;

  const stepPan = () => {
    if (!pressed.size) {
      panFrame = null;
      return;
    }
    const speed = 0.16;
    let x = 0;
    let z = 0;
    if (pressed.has("arrowleft") || pressed.has("a")) x -= speed;
    if (pressed.has("arrowright") || pressed.has("d")) x += speed;
    if (pressed.has("arrowup") || pressed.has("w")) z -= speed;
    if (pressed.has("arrowdown") || pressed.has("s")) z += speed;
    scene.panBy({ x, z });
    panFrame = requestAnimationFrame(stepPan);
  };

  window.addEventListener("keyup", (event) => {
    pressed.delete(event.key.toLowerCase());
  });

  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (gameStarted && panKeys.has(key)) {
      event.preventDefault();
      if (!pressed.has(key)) {
        pressed.add(key);
        if (panFrame === null) panFrame = requestAnimationFrame(stepPan);
      }
      return;
    }
    if (event.repeat) return;
    if (event.key === "Escape") {
      if (ui.elements.helpPanel.classList.contains("is-open")) {
        ui.toggleHelp(false);
      } else {
        controller?.clearSelection();
      }
      return;
    }
    if (!gameStarted) return;
    if (key === "q") scene.rotateBy(-0.22);
    if (key === "e") scene.rotateBy(0.22);
    if (event.key === "+" || event.key === "=") scene.zoomBy(0.85);
    if (event.key === "-" || event.key === "_") scene.zoomBy(1.18);
    if (key === "u") controller.undo();
    if (key === "r") restartGame();
    if (event.key === " ") {
      event.preventDefault();
      currentView =
        currentView === "red" ? "black" : currentView === "black" ? "low" : "red";
      scene.setView(currentView);
    }
  });
}

function bindVisibility() {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) audio.setMuted(true);
    else audio.setMuted(muted);
  });
}

function showFatalError(error) {
  console.error(error);
  ui.elements.start.innerHTML = `
    <div class="start-card">
      <p class="start-kicker">战场载入失败</p>
      <h2>未能建立山河</h2>
      <p class="start-copy">${escapeHtml(error?.message ?? "未知错误")}</p>
      <button class="primary-button" type="button" onclick="location.reload()">重新载入</button>
    </div>
  `;
  ui.elements.start.classList.add("is-visible");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function saveSettings(elements, mode, soundMuted) {
  try {
    const side = elements.sideSelect.value;
    const difficulty = elements.difficultySelect.value;
    const quality = elements.qualitySelect.value;
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        side,
        difficulty,
        quality,
        mode,
        muted: soundMuted,
      })
    );
  } catch {
    // Private browsing can disable localStorage.
  }
}

function restoreSettings(elements) {
  let settings = null;
  try {
    settings = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null");
  } catch {
    settings = null;
  }
  if (!settings) return;
  if (settings.side && ["red", "black"].includes(settings.side)) {
    elements.sideSelect.value = settings.side;
  }
  if (settings.difficulty && ["1", "2", "3"].includes(String(settings.difficulty))) {
    elements.difficultySelect.value = String(settings.difficulty);
  }
  if (settings.quality && ["auto", "high", "balanced"].includes(settings.quality)) {
    elements.qualitySelect.value = settings.quality;
  }
  if (settings.mode && ["ai", "local"].includes(settings.mode)) {
    manualMode = settings.mode;
    ui.setModeLabel(manualMode, elements.sideSelect.value);
  }
  if (settings.muted === true) {
    muted = true;
    audio.setMuted(true);
    elements.sound.classList.add("is-muted");
    elements.sound.setAttribute("aria-label", "开启声音");
    elements.sound.title = "开启声音";
  }
}

boot();
