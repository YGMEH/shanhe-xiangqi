import {
  PIECE_DESCRIPTIONS,
  PIECE_LABELS,
  PIECE_NAMES,
  SIDES,
} from "../game/constants.js";
import { CAMPAIGN_CHAPTERS } from "../game/campaigns.js";

const TURN_LABELS = {
  [SIDES.RED]: "赤壁军行棋",
  [SIDES.BLACK]: "玄甲军行棋",
};

export class GameUI {
  constructor() {
    this.elements = {
      subtitle: get("battle-subtitle"),
      loading: get("loading-layer"),
      loadingLabel: get("loading-label"),
      redStrength: get("red-strength"),
      blackStrength: get("black-strength"),
      redCaptures: get("red-captures"),
      blackCaptures: get("black-captures"),
      redArmy: document.querySelector(".red-army"),
      blackArmy: document.querySelector(".black-army"),
      turnEmblem: get("turn-emblem"),
      turnLabel: get("turn-label"),
      turnHint: get("turn-hint"),
      undo: get("undo-button"),
      restart: get("restart-button"),
      mode: get("mode-button"),
      modeLabel: get("mode-label"),
      view: get("view-button"),
      cameraZoomIn: get("camera-zoom-in"),
      cameraZoomOut: get("camera-zoom-out"),
      cameraRotateLeft: get("camera-rotate-left"),
      cameraRotateRight: get("camera-rotate-right"),
      cameraReset: get("camera-reset"),
      sound: get("sound-button"),
      help: get("help-button"),
      inspector: get("inspector"),
      inspectorGlyph: get("inspector-glyph"),
      inspectorName: get("inspector-name"),
      inspectorDetail: get("inspector-detail"),
      history: get("move-history"),
      lastEvent: get("last-event"),
      toast: get("toast"),
      start: get("start-screen"),
      startButton: get("start-button"),
      continueButton: get("continue-button"),
      sideSelect: get("side-select"),
      difficultySelect: get("difficulty-select"),
      qualitySelect: get("quality-select"),
      helpPanel: get("help-panel"),
      closeHelp: get("close-help"),
      result: get("result-panel"),
      resultRibbon: get("result-ribbon"),
      resultTitle: get("result-title"),
      resultCopy: get("result-copy"),
      resultRestart: get("result-restart"),
      resultClose: get("result-close"),
      resultStars: get("result-stars"),
      campaignPanel: get("campaign-panel"),
      campaignChapters: get("campaign-chapters"),
      closeCampaign: get("close-campaign"),
      campaignButton: get("campaign-button"),
      quickMatchButton: get("quick-match-button"),
    };
    this.toastTimer = null;
  }

  renderTurn(side, hint) {
    const isRed = side === SIDES.RED;
    this.elements.turnEmblem.textContent = isRed ? "蜀" : "魏";
    this.elements.turnEmblem.className = `turn-emblem ${isRed ? "red" : "black"}`;
    this.elements.turnLabel.textContent = TURN_LABELS[side] ?? "战局已定";
    this.elements.turnHint.textContent = hint;
    this.elements.redArmy.classList.toggle("is-active", isRed);
    this.elements.blackArmy.classList.toggle("is-active", !isRed);
  }

  renderCaptures(captures) {
    renderCaptureRow(this.elements.redCaptures, captures.red, "black");
    renderCaptureRow(this.elements.blackCaptures, captures.black, "red");
    this.elements.redStrength.textContent = `${16 - captures.black.length} 子`;
    this.elements.blackStrength.textContent = `${16 - captures.red.length} 子`;
  }

  renderInspector(piece, moveCount) {
    if (!piece) {
      this.hideInspector();
      return;
    }
    this.elements.inspector.classList.add("is-visible");
    this.elements.inspectorGlyph.textContent = PIECE_LABELS[piece.side][piece.type];
    this.elements.inspectorGlyph.style.color =
      piece.side === SIDES.RED ? "#ff8177" : "#c4d8d3";
    this.elements.inspectorName.textContent = PIECE_NAMES[piece.type];
    this.elements.inspectorDetail.textContent =
      moveCount > 0
        ? `${PIECE_DESCRIPTIONS[piece.type]} · ${moveCount} 处可行`
        : "当前没有合法着法";
  }

  hideInspector() {
    this.elements.inspector.classList.remove("is-visible");
  }

  renderHistory(history) {
    const rows = [];
    for (let i = 0; i < history.length; i += 2) {
      const red = history[i]?.side === SIDES.RED ? history[i] : history[i + 1];
      const black = history[i]?.side === SIDES.BLACK ? history[i] : history[i + 1];
      rows.push(`
        <div class="history-row">
          <span>${Math.floor(i / 2) + 1}</span>
          <span class="red-move">${red?.notation ?? ""}</span>
          <span class="black-move">${black?.notation ?? ""}</span>
        </div>
      `);
    }
    this.elements.history.innerHTML = rows.slice(-6).join("");
    const latest = history.at(-1);
    if (latest) {
      this.elements.lastEvent.textContent = `${latest.side === SIDES.RED ? "蜀军" : "魏军"}：${latest.notation}`;
    }
  }

  showToast(message, duration = 1400) {
    window.clearTimeout(this.toastTimer);
    this.elements.toast.textContent = message;
    this.elements.toast.classList.add("is-visible");
    this.toastTimer = window.setTimeout(() => {
      this.elements.toast.classList.remove("is-visible");
    }, duration);
  }

  showStart() {
    this.elements.start.classList.add("is-visible");
  }

  setContinueAvailable(available) {
    this.elements.continueButton.hidden = !available;
  }

  hideStart() {
    this.elements.start.classList.remove("is-visible");
  }

  toggleHelp(visible) {
    const next =
      typeof visible === "boolean"
        ? visible
        : !this.elements.helpPanel.classList.contains("is-open");
    this.elements.helpPanel.classList.toggle("is-open", next);
    this.elements.helpPanel.setAttribute("aria-hidden", String(!next));
  }

  showResult({ title, ribbon, copy, playerWon, outcome = "win" }) {
    if (outcome === "draw") {
      this.elements.resultRibbon.textContent = `和 · ${ribbon}`;
    } else {
      this.elements.resultRibbon.textContent = playerWon
        ? `胜 · ${ribbon}`
        : `负 · ${ribbon}`;
    }
    this.elements.resultTitle.textContent = title;
    this.elements.resultCopy.textContent = copy;
    if (typeof arguments[0].stars !== "undefined") {
      this.renderResultStars(arguments[0].stars);
    } else {
      this.elements.resultStars.innerHTML = "";
    }
    this.elements.result.classList.add("is-visible");
    this.elements.result.setAttribute("aria-hidden", "false");
  }

  renderResultStars(stars) {
    this.elements.resultStars.innerHTML = stars
      .map((earned) => `<span class="${earned ? "is-earned" : ""}">★</span>`)
      .join("");
  }

  renderCampaign(progress, onSelect) {
    const completed = progress?.completed ?? {};
    const levels = CAMPAIGN_CHAPTERS.flatMap((chapter) => chapter.levels);
    this.elements.campaignChapters.innerHTML = CAMPAIGN_CHAPTERS.map(
      (chapter, chapterIndex) => {
        const previousLevels = levels.slice(0, chapterIndex * 4);
        const chapterUnlocked =
          chapterIndex === 0 ||
          previousLevels.slice(-1).every((level) => completed[level.id]?.achieved);
        return `
          <section class="campaign-chapter">
            <header>
              <h3>${chapter.title}</h3>
              <span>${chapter.subtitle}</span>
            </header>
            <div class="level-list">
              ${chapter.levels
                .map((level) => {
                  const saved = completed[level.id];
                  const index = levels.findIndex((item) => item.id === level.id);
                  const unlocked =
                    chapterUnlocked &&
                    (index === 0 || completed[levels[index - 1].id]?.achieved);
                  const earned = saved?.stars ?? [false, false, false];
                  return `
                    <button class="level-card" type="button" data-level="${level.id}" ${
                      unlocked ? "" : "disabled"
                    }>
                      <span class="level-number">${String(level.number).padStart(2, "0")}</span>
                      <span class="level-copy">
                        <strong>${level.title}</strong>
                        <small>${level.objective}</small>
                      </span>
                      <span class="level-stars">${earned
                        .map((value) => `<span class="${value ? "is-earned" : ""}">★</span>`)
                        .join("")}</span>
                    </button>
                    <p class="campaign-objective">${unlocked ? level.briefing : "完成前一关后解锁。"}</p>
                  `;
                })
                .join("")}
            </div>
          </section>
        `;
      }
    ).join("");
    this.elements.campaignChapters.querySelectorAll("[data-level]").forEach((button) => {
      button.addEventListener("click", () => onSelect(button.dataset.level));
    });
  }

  toggleCampaign(visible) {
    const next =
      typeof visible === "boolean"
        ? visible
        : !this.elements.campaignPanel.classList.contains("is-open");
    this.elements.campaignPanel.classList.toggle("is-open", next);
    this.elements.campaignPanel.setAttribute("aria-hidden", String(!next));
  }

  setStartMode(mode) {
    this.elements.campaignButton.classList.toggle("is-active", mode === "campaign");
    this.elements.quickMatchButton.classList.toggle("is-active", mode !== "campaign");
    this.elements.startButton.textContent =
      mode === "campaign" ? "进入战役" : "展开对局";
  }

  hideResult() {
    this.elements.result.classList.remove("is-visible");
    this.elements.result.setAttribute("aria-hidden", "true");
  }

  setModeLabel(mode, playerSide) {
    this.elements.modeLabel.textContent = mode === "local" ? "双人演武" : "人机对弈";
    this.elements.sideSelect.disabled = mode === "local";
    if (mode === "local") {
      this.elements.subtitle.textContent = "楚河改道 · 双军对阵";
    } else {
      const sideName = playerSide === SIDES.RED ? "蜀军" : "魏军";
      this.elements.subtitle.textContent = `楚河改道 · 执${sideName}作战`;
    }
  }

  setBusy(busy) {
    this.elements.undo.disabled = busy;
  }

  setLoadingLabel(message) {
    this.elements.loadingLabel.textContent = message;
  }

  hideLoading() {
    this.elements.loading.classList.add("is-hidden");
  }

  showLoading(message = "正在铺开地形") {
    this.elements.loadingLabel.textContent = message;
    this.elements.loading.classList.remove("is-hidden");
  }

  setQualityLabel(quality) {
    this.elements.view.title =
      quality === "balanced" ? "切换视角（当前为性能模式）" : "切换视角";
  }
}

function renderCaptureRow(container, pieces, originalSide) {
  container.innerHTML = pieces
    .map(
      (piece) =>
        `<span class="capture-token ${originalSide}">${
          PIECE_LABELS[piece.side][piece.type]
        }</span>`
    )
    .join("");
}

function get(id) {
  return document.getElementById(id);
}
