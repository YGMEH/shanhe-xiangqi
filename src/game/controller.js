import {
  MAX_HISTORY,
  PIECE_LABELS,
  PIECE_NAMES,
  PIECE_TYPES,
  SIDES,
  algebraic,
  oppositeSide,
} from "./constants.js";
import { BoardState } from "./board.js";
import {
  gameStatus,
  getLegalMoves,
  isMoveLegal,
} from "./rules.js";
import { chooseAiMove } from "./ai.js";
import { boardPosition } from "../render/terrain.js";
import { clearGame, saveGame } from "./save.js";
import { positionKey } from "./board.js";
import { evaluateCampaign } from "./campaigns.js";

const NATURAL_DRAW_PLIES = 120;

export class GameController {
  constructor({ scene, ui, audio }) {
    this.scene = scene;
    this.ui = ui;
    this.audio = audio;
    this.state = new BoardState();
    this.selected = null;
    this.selectedMoves = [];
    this.playerSide = SIDES.RED;
    this.aiSide = SIDES.BLACK;
    this.difficulty = 2;
    this.mode = "ai";
    this.busy = false;
    this.gameOver = false;
    this.resultDismissed = false;
    this.undoStack = [];
    this.moveHistory = [];
    this.captures = {
      red: [],
      black: [],
    };
    this.flyingMove = false;
    this.lastMove = null;
    this.aiTimer = null;
    this.autoSaveEnabled = true;
    this.positionKeys = [];
    this.campaign = null;
    this.lastWinner = null;
  }

  restore(save) {
    if (!save) return false;
    this.playerSide = save.playerSide;
    this.aiSide = save.aiSide;
    this.difficulty = save.difficulty;
    this.mode = save.mode;
    this.state = new BoardState(save.pieces, save.turn, []);
    this.captures = save.captures ?? { red: [], black: [] };
    this.moveHistory = save.history ?? [];
    this.lastMove = save.lastMove ?? null;
    this.positionKeys = Array.isArray(save.positionKeys)
      ? save.positionKeys
      : [positionKey(this.state.pieces, this.state.turn)];
    this.campaign = save.campaign ?? null;
    this.lastWinner = save.lastWinner ?? null;
    this.undoStack = [];
    this.selected = null;
    this.selectedMoves = [];
    this.busy = false;
    this.gameOver = false;
    this.scene.syncBoard(this.state);
    this.scene.setSelected(null);
    this.scene.hideCheck();
    this.ui.renderCaptures(this.captures);
    this.ui.renderHistory(this.moveHistory);
    this.ui.hideResult();
    this.ui.hideInspector();
    const status = gameStatus(this.state);
    if (status.inCheck) this.scene.showCheck([this.state.turn]);
    this.ui.renderTurn(
      this.state.turn,
      status.inCheck ? "将帅受危，必须解围" : "上局已续接"
    );
    if (this.mode === "ai" && this.state.turn === this.aiSide) {
      this.busy = true;
      this.aiTimer = window.setTimeout(() => this.makeAiMove(), 540);
    }
    return true;
  }

  commit() {
    if (!this.autoSaveEnabled) return;
    if (this.gameOver) clearGame();
    else saveGame(this);
  }

  attach() {
    this.scene.attachGame(this);
    this.scene.syncBoard(this.state);
  }

  configure({
    playerSide = SIDES.RED,
    difficulty = 2,
    mode = "ai",
    pieces,
    campaign = null,
  } = {}) {
    this.playerSide = playerSide;
    this.aiSide = oppositeSide(playerSide);
    this.difficulty = difficulty;
    this.mode = mode;
    this.state = new BoardState(pieces);
    this.selected = null;
    this.selectedMoves = [];
    this.undoStack = [];
    this.moveHistory = [];
    this.captures = { red: [], black: [] };
    this.busy = false;
    this.gameOver = false;
    this.resultDismissed = false;
    this.lastMove = null;
    this.positionKeys = [positionKey(this.state.pieces, this.state.turn)];
    this.campaign = campaign;
    this.lastWinner = null;
    window.clearTimeout(this.aiTimer);
    this.scene.syncBoard(this.state);
    this.scene.setSelected(null);
    this.scene.hideCheck();
    this.ui.renderTurn(this.state.turn, "请选择一枚棋子");
    this.ui.renderCaptures(this.captures);
    this.ui.renderHistory(this.moveHistory);
    this.ui.hideResult();
    this.ui.hideInspector();
  }

  isHumanTurn() {
    return this.mode === "local" || this.state.turn === this.playerSide;
  }

  selectPiece(piece) {
    if (
      this.busy ||
      this.gameOver ||
      !piece ||
      piece.side !== this.state.turn ||
      !this.isHumanTurn()
    ) {
      if (piece && piece.side !== this.state.turn) {
        this.ui.showToast("尚未轮到该军行动");
        this.audio.cancel();
      }
      return false;
    }

    if (this.selected?.id === piece.id) {
      this.clearSelection();
      return false;
    }

    this.selected = piece;
    this.selectedMoves = getLegalMoves(this.state, piece);
    this.scene.setSelected(piece, this.selectedMoves);
    this.ui.renderInspector(piece, this.selectedMoves.length);
    this.audio.select();
    return true;
  }

  clearSelection() {
    this.selected = null;
    this.selectedMoves = [];
    this.scene.setSelected(null);
    this.ui.hideInspector();
  }

  async squareClicked(x, y) {
    if (this.busy || this.gameOver || !this.isHumanTurn()) return;
    const target = this.state.pieceAt(x, y);
    if (!this.selected) {
      if (target) this.selectPiece(target);
      return;
    }

    const move = isMoveLegal(this.state, this.selected.id, x, y);
    if (move) {
      await this.performMove(
        { ...move, pieceId: this.selected.id },
        { byHuman: true }
      );
      return;
    }

    if (target) {
      this.selectPiece(target);
    } else {
      this.clearSelection();
      this.audio.cancel();
    }
  }

  async performMove(move, { byAi = false, skipSync = false } = {}) {
    if ((this.busy && !byAi) || this.gameOver) return;
    const movingPiece = this.state.pieceById(move.pieceId);
    if (!movingPiece) {
      this.busy = false;
      this.ui.showToast("行棋目标已失效");
      return;
    }
    this.busy = true;
    this.clearSelection();
    const captured = this.state.pieceAt(move.x, move.y);
    const from = { x: movingPiece.x, y: movingPiece.y };
    const to = { x: move.x, y: move.y };

    const snapshot = {
      pieces: this.state.serialize(),
      turn: this.state.turn,
      captures: {
        red: [...this.captures.red],
        black: [...this.captures.black],
      },
      history: [...this.moveHistory],
      lastMove: this.lastMove,
      positionKeys: [...this.positionKeys],
    };
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();

    const attackKind = movingPiece.type;
    const isCannon = attackKind === PIECE_TYPES.CANNON;
    const isCapture = Boolean(captured);

    if (isCannon && isCapture) {
      this.audio.cannon();
      await this.scene.cannonShot(from, to);
    } else {
      this.audio.move();
    }

    const attackDelay = isCannon && isCapture ? 0 : 95;

    if (isCannon && isCapture && captured) {
      this.scene.playAttack(
        movingPiece,
        attackKind,
        () => {
          this.audio.capture(attackKind);
          this.scene.killAt(to.x, to.y, true);
          this.scene.killFocus(to.x, to.y, {
            distance: 12.5,
            hold: 520,
          });
        }
      );
    } else if (captured) {
      this.scene.playAttack(movingPiece, attackKind, () => {
        this.audio.capture(attackKind);
        this.scene.killAt(to.x, to.y, false);
        this.scene.killFocus(to.x, to.y, {
          distance: 10.5,
          hold: 360,
        });
      });
    } else {
      this.scene.playAttack(movingPiece, attackKind);
    }

    await wait(attackDelay);
    if (!isCannon || !isCapture) {
      await this.scene.animateMove(movingPiece, from, to);
    } else {
      await this.scene.animateMove(movingPiece, from, to, { duration: 0.3 });
    }

    this.state.move(movingPiece.id, to.x, to.y, captured);
    this.scene.syncBoard(this.state, { skipPosition: true });
    const actor = this.scene.actors.get(movingPiece.id);
    if (actor) {
      const position = boardPosition(movingPiece.x, movingPiece.y);
      actor.group.position.set(position.x, actor.baseHeight, position.z);
    }
    if (captured) {
      this.captures[oppositeSide(movingPiece.side)].push(captured);
      await this.scene.defeatActor(captured.id);
    }

    const notation = this.formatMove(movingPiece, from, to, captured);
    this.moveHistory.push({
      side: movingPiece.side,
      notation,
      from,
      to,
      captured,
      at: Date.now(),
    });
    this.lastMove = { from, to, pieceId: movingPiece.id };
    this.ui.renderCaptures(this.captures);
    this.ui.renderHistory(this.moveHistory);

    this.state.turn = oppositeSide(movingPiece.side);
    this.positionKeys.push(positionKey(this.state.pieces, this.state.turn));
    this.busy = false;

    if (!skipSync) this.resolveTurnState();
    this.commit();
  }

  resolveTurnState() {
    const status = gameStatus(this.state);
    if (status.over) {
      this.gameOver = true;
      this.selected = null;
      this.scene.setSelected(null);
      const winner = status.winner;
      this.lastWinner = winner;
      const playerWon = winner === this.playerSide;
      this.ui.renderTurn(winner, status.reason === "checkmate" ? "将死" : "困毙");
      this.ui.showResult({
        title: winner === SIDES.RED ? "赤壁军胜" : "玄甲军胜",
        ribbon: status.reason === "checkmate" ? "绝杀" : "兵困",
        copy:
          status.reason === "checkmate"
            ? "敌将已无路可退。"
            : "敌军已无任何合法着法。",
        playerWon,
        winner,
      });
      if (playerWon) this.audio.victory();
      else this.audio.defeat();
      if (this.campaign && playerWon) this.onCampaignResult?.();
      return;
    }

    if (this.campaign) {
      const campaignResult = evaluateCampaign(this.state, this, this.campaign);
      if (campaignResult.achieved) {
        this.gameOver = true;
        this.selected = null;
        this.scene.setSelected(null);
        this.ui.renderTurn(this.state.turn, "战役目标达成");
        this.ui.showResult({
          title: this.campaign.title,
          ribbon: "战役达成",
          copy: this.campaign.objective,
          outcome: "campaign",
          playerWon: true,
          stars: campaignResult.stars,
        });
        this.audio.victory();
        this.onCampaignResult?.();
        this.commit();
        return;
      }
    }

    if (status.inCheck) {
      this.audio.check();
      this.scene.showCheck([this.state.turn]);
      this.ui.renderTurn(this.state.turn, "将帅受危，必须解围");
      this.ui.showToast("将军");
    } else {
      this.scene.hideCheck();
      this.ui.renderTurn(this.state.turn, "请选择一枚棋子");
    }

    const repetitionCount = this.positionKeys.filter(
      (key) => key === this.positionKeys.at(-1)
    ).length;
    if (repetitionCount >= 3) {
      this.finishDraw("三次相同局面，双方均无法取得进展。", "同势");
      return;
    }

    const recentMoves = this.moveHistory.slice(-NATURAL_DRAW_PLIES);
    if (
      recentMoves.length === NATURAL_DRAW_PLIES &&
      recentMoves.every((move) => !move.captured)
    ) {
      this.finishDraw("连续六十回合未发生吃子，战局自然成和。", "限着");
      return;
    }

    if (this.mode === "ai" && this.state.turn === this.aiSide) {
      this.aiTimer = window.setTimeout(() => this.makeAiMove(), 260);
    }
  }

  async makeAiMove() {
    if (this.gameOver || this.mode !== "ai") return;
    this.ui.renderTurn(this.aiSide, "敌军推演中");
    await wait(220);
    const move = chooseAiMove(this.state, this.aiSide, this.difficulty);
    if (!move) {
      this.busy = false;
      this.resolveTurnState();
      return;
    }
    this.busy = false;
    await this.performMove(move, { byAi: true });
  }

  undo() {
    if (this.busy || this.undoStack.length === 0) {
      this.ui.showToast("暂无可撤回的行棋");
      this.audio.cancel();
      return;
    }

    let snapshot = this.undoStack.pop();
    if (
      this.mode === "ai" &&
      snapshot.turn === this.aiSide &&
      this.undoStack.length > 0
    ) {
      snapshot = this.undoStack.pop();
    }

    this.state = new BoardState(snapshot.pieces, snapshot.turn, []);
    this.captures = snapshot.captures;
    this.moveHistory = snapshot.history;
    this.lastMove = snapshot.lastMove;
    this.positionKeys = snapshot.positionKeys ?? [
      positionKey(this.state.pieces, this.state.turn),
    ];
    this.gameOver = false;
    this.resultDismissed = false;
    this.busy = false;
    this.selected = null;
    this.scene.syncBoard(this.state);
    this.scene.setSelected(null);
    this.scene.hideCheck();
    this.ui.renderCaptures(this.captures);
    this.ui.renderHistory(this.moveHistory);
    this.ui.hideResult();
    this.ui.hideInspector();
    this.ui.renderTurn(this.state.turn, "棋局已回退");
    this.audio.cancel();
    if (this.mode === "ai" && this.state.turn === this.aiSide) {
      this.aiTimer = window.setTimeout(() => this.makeAiMove(), 420);
    }
    this.commit();
  }

  finishDraw(copy, ribbon = "和局") {
    this.gameOver = true;
    this.selected = null;
    this.busy = false;
    this.scene.setSelected(null);
    this.ui.renderTurn(this.state.turn, "和局");
    this.ui.showResult({
      title: "山河和局",
      ribbon,
      copy,
      outcome: "draw",
      playerWon: true,
    });
    this.audio.cancel();
  }

  formatMove(piece, from, to, captured) {
    const label = PIECE_LABELS[piece.side][piece.type];
    const captureText = captured
      ? `取${PIECE_LABELS[captured.side][captured.type]}`
      : "";
    return `${label}${algebraic(from.x, from.y, piece.side)}至${algebraic(
      to.x,
      to.y,
      piece.side
    )}${captureText}`;
  }

  getPieceDisplayName(piece) {
    return `${PIECE_NAMES[piece.type]} · ${PIECE_LABELS[piece.side][piece.type]}`;
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
