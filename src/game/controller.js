import {
  MAX_HISTORY,
  PIECE_LABELS,
  PIECE_NAMES,
  PIECE_TYPES,
  SIDES,
  algebraic,
  oppositeSide,
} from "./constants.js";
import { BoardState, createInitialBoard, createPiece } from "./board.js";
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
    this.lastMove = null;
    this.aiTimer = null;
    this.aiGeneration = 0;
    this.autoSaveEnabled = true;
    this.positionKeys = [];
    this.campaign = null;
    this.lastWinner = null;
  }

  restore(save) {
    if (!save) return false;
    this.cancelPendingAi();
    this.playerSide = save.playerSide;
    this.aiSide = save.aiSide;
    this.difficulty = save.difficulty;
    this.mode = save.mode;
    this.state = new BoardState(save.pieces, save.turn, []);
    this.moveHistory = save.history ?? [];
    // 从着法史重建战利品, 而不是直接信任存档里的 captures 字段。
    // 旧版本把吃子记到了对方名下(captures[被吃方] 而非 captures[吃子方]),
    // 直接沿用会让读档后的兵力与俘获栏继续错一位; history[].side/captured
    // 始终是可信的, 顺手也就完成了旧存档迁移。
    this.captures = rebuildCaptures(this.moveHistory, save.captures);
    this.lastMove = save.lastMove ?? null;
    this.scene.setLastMove?.(this.lastMove);
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
    this.ui.renderCaptures(this.captures, this.state);
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
      this.scheduleAiMove(540);
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
    this.cancelPendingAi();
    this.playerSide = playerSide;
    this.aiSide = oppositeSide(playerSide);
    this.difficulty = difficulty;
    this.mode = mode;
    // 残局/战役剧本传入的棋子往往没有 id(剧本只写 type/side/x/y),
    // 旧代码原样塞给 BoardState, 导致 state 里所有棋子 id 全是 undefined:
    // pieceById 永远找不到目标、渲染层 actors 全挂在 null 键上互相覆盖,
    // 实测残局下整盘只剩一枚棋子可以点。这里统一补 id。
    const normalizedPieces = pieces
      ? pieces.map((piece) => (piece.id ? piece : createPiece(piece.type, piece.side, piece.x, piece.y, piece)))
      : createInitialBoard();
    this.state = new BoardState(normalizedPieces);
    this.selected = null;
    this.selectedMoves = [];
    this.undoStack = [];
    this.moveHistory = [];
    this.captures = { red: [], black: [] };
    this.busy = false;
    this.gameOver = false;
    this.resultDismissed = false;
    this.lastMove = null;
    this.scene.setLastMove?.(null);
    this.positionKeys = [positionKey(this.state.pieces, this.state.turn)];
    this.campaign = campaign;
    this.lastWinner = null;
    this.scene.syncBoard(this.state);
    this.scene.setSelected(null);
    this.scene.hideCheck();
    this.ui.renderTurn(this.state.turn, "请选择一枚棋子");
    this.ui.renderCaptures(this.captures, this.state);
    this.ui.renderHistory(this.moveHistory);
    this.ui.hideResult();
    this.ui.hideInspector();
  }

  isHumanTurn() {
    return this.mode === "local" || this.state.turn === this.playerSide;
  }

  cancelPendingAi() {
    if (this.aiTimer !== null) window.clearTimeout(this.aiTimer);
    this.aiTimer = null;
    this.aiGeneration += 1;
  }

  scheduleAiMove(delay) {
    this.cancelPendingAi();
    const generation = this.aiGeneration;
    this.aiTimer = window.setTimeout(() => {
      this.aiTimer = null;
      this.makeAiMove(generation);
    }, delay);
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
      // 已选中棋子时点了一枚吃不掉的敌子。
      // 旧实现直接交给 selectPiece(), 而 selectPiece 会因"对方阵营"弹
      // "尚未轮到该军行动" —— 可这时明明轮到玩家, 提示是错的, 玩家会以为
      // 轮次坏了。这里按"落点非法"处理。
      if (target.side !== this.state.turn) {
        this.ui.showToast("该落点不符合行棋规则");
        this.audio.cancel();
        return;
      }
      this.selectPiece(target);
    } else {
      this.clearSelection();
      this.audio.cancel();
    }
  }

  async performMove(move, { byAi = false, skipSync = false } = {}) {
    if (this.busy || this.gameOver) return false;
    const movingPiece = this.state.pieceById(move.pieceId);
    if (!movingPiece) {
      this.ui.showToast("行棋目标已失效");
      return false;
    }
    const legalMove = isMoveLegal(this.state, movingPiece.id, move.x, move.y);
    if (!legalMove) {
      this.ui.showToast(
        movingPiece.side === this.state.turn
          ? "该落点不符合行棋规则"
          : "尚未轮到该军行动"
      );
      return false;
    }
    this.busy = true;
    this.clearSelection();
    try {
      await this.runMove(
        { ...legalMove, pieceId: movingPiece.id },
        { byAi, skipSync, movingPiece }
      );
      return true;
    } catch (error) {
      // 关键: 这里面的动画/音效都是 await 的, 任意一步抛错都会让 busy 永远
      // 停在 true, 之后所有点击都被开头的 if (this.busy) 拦掉, 表现为
      // "点了没反应、棋子不动", 尤其容易发生在炮吃子这条分支上。
      // 用一个兜底释放, 保证一局里不会因为一次动画异常而彻底锁死。
      console.error("行棋过程出错, 已恢复可下子状态:", error);
      this.ui.showToast("行棋动作异常, 已恢复");
      this.scene.syncBoard(this.state);
      return false;
    } finally {
      this.busy = false;
    }
  }

  async runMove(move, { byAi = false, skipSync = false, movingPiece } = {}) {
    const captured = this.state.pieceAt(move.x, move.y);
    const from = { x: movingPiece.x, y: movingPiece.y };
    const to = { x: move.x, y: move.y };

    const attackKind = movingPiece.type;
    const isCannon = attackKind === PIECE_TYPES.CANNON;
    const isCapture = Boolean(captured);

    if (isCannon && isCapture) {
      this.audio.cannon();
      await this.scene.cannonShot(from, to);
    } else {
      // 把兵种传下去, 让战象踩地和骑兵马蹄听起来不一样。
      // 原来这里不传参, 所有兵种共用一套走子音效。
      this.audio.move(attackKind);
    }

    const attackDelay = isCannon && isCapture ? 0 : 95;

    // 动作分层: 走路就播走路, 吃子才播攻击。
    // 早先这里对"任何一步"都调 playAttack, 结果所有棋子一到移动就摆攻击姿势,
    // 四条腿/车轮的行走动画根本没机会播 —— 实测"象走子时 clip -> Attack"。
    // 行走动作由 scene.animateMove 在位移开始时自己起, 这里只管吃子。
    if (isCapture) {
      if (isCannon && captured) {
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
      } else {
        this.scene.playAttack(movingPiece, attackKind, () => {
          this.audio.capture(attackKind);
          this.scene.killAt(to.x, to.y, false);
          this.scene.killFocus(to.x, to.y, {
            distance: 10.5,
            hold: 360,
          });
        });
      }
    }

    await wait(attackDelay);
    if (!isCannon || !isCapture) {
      await this.scene.animateMove(movingPiece, from, to);
    } else {
      await this.scene.animateMove(movingPiece, from, to, { duration: 0.3 });
    }

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

    this.state.move(movingPiece.id, to.x, to.y, captured);
    this.scene.syncBoard(this.state, { skipPosition: true });
    const actor = this.scene.actors.get(movingPiece.id);
    if (actor) {
      const position = boardPosition(movingPiece.x, movingPiece.y);
      actor.group.position.set(position.x, actor.baseHeight, position.z);
    }
    if (captured) {
      // captures[side] 统一表示"该方俘获的战利品"(棋子归属方为对方),
      // 与 index.html 的"蜀军俘获/魏军俘获"和 ui.renderCaptures 的
      // 渲染口径一致。旧实现写入 oppositeSide(...) 是把它当成"该方的损失",
      // 结果红方吃子会记到黑方名下, 兵力也扣错一边。
      this.captures[movingPiece.side].push(captured);
      // 吃子让配乐紧张起来: 每吃一子抬一档, 到 1.0 封顶。
      // 直接数双方战利品总数 = 本局已吃子数, 比用 32 减存活数更稳:
      // 残局战役开局就不足 32 子, 旧算法会让配乐一上来就顶到最大强度。
      const eaten = this.captures.red.length + this.captures.black.length;
      this.audio.setMusicIntensity?.(0.6 + eaten * 0.045);
      try {
        await this.scene.defeatActor(captured.id);
      } catch (error) {
        console.error("吃子退场动画失败, 已按当前棋局重新同步:", error);
        this.scene.syncBoard(this.state);
      }
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
    // side 用于渲染"上一手"标记的配色(红方暖色/黑方冷色), 旧存档没有该字段时渲染层会退回默认配色。
    this.lastMove = { from, to, pieceId: movingPiece.id, side: movingPiece.side };
    this.scene.setLastMove?.(this.lastMove);
    this.ui.renderCaptures(this.captures, this.state);
    this.ui.renderHistory(this.moveHistory);

    this.state.turn = oppositeSide(movingPiece.side);
    this.positionKeys.push(positionKey(this.state.pieces, this.state.turn));

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
      // 将军是全局最紧张的时刻, 直接把配乐推到满
      this.audio.setMusicIntensity?.(1);
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
      this.scheduleAiMove(260);
    }
  }

  async makeAiMove(generation = this.aiGeneration) {
    if (
      generation !== this.aiGeneration ||
      this.busy ||
      this.gameOver ||
      this.mode !== "ai" ||
      this.state.turn !== this.aiSide
    ) return false;
    const stateAtStart = this.state;
    this.busy = true;
    this.ui.renderTurn(this.aiSide, "敌军推演中");
    await wait(220);
    if (
      generation !== this.aiGeneration ||
      this.state !== stateAtStart ||
      this.gameOver ||
      this.mode !== "ai" ||
      this.state.turn !== this.aiSide
    ) {
      if (generation === this.aiGeneration) this.busy = false;
      return false;
    }
    const move = chooseAiMove(this.state, this.aiSide, this.difficulty);
    this.busy = false;
    if (!move) {
      this.resolveTurnState();
      return false;
    }
    return this.performMove(move, { byAi: true });
  }

  undo() {
    if (this.busy || this.undoStack.length === 0) {
      this.ui.showToast("暂无可撤回的行棋");
      this.audio.cancel();
      return;
    }

    this.cancelPendingAi();
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
    this.scene.setLastMove?.(this.lastMove);
    this.positionKeys = snapshot.positionKeys ?? [
      positionKey(this.state.pieces, this.state.turn),
    ];
    this.gameOver = false;
    this.resultDismissed = false;
    this.busy = false;
    this.selected = null;
    this.selectedMoves = [];
    this.scene.syncBoard(this.state);
    this.scene.setSelected(null);
    this.scene.hideCheck();
    this.ui.renderCaptures(this.captures, this.state);
    this.ui.renderHistory(this.moveHistory);
    this.ui.hideResult();
    this.ui.hideInspector();
    this.ui.renderTurn(this.state.turn, "棋局已回退");
    this.audio.cancel();
    if (this.mode === "ai" && this.state.turn === this.aiSide) {
      this.scheduleAiMove(420);
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

/**
 * 按"吃子方持有战利品"的口径重建 captures。
 * 只有当着法史缺失或为空(老存档/异常数据)时才退回存档里的原始字段。
 */
function rebuildCaptures(history, fallback) {
  const empty = { red: [], black: [] };
  if (!Array.isArray(history) || history.length === 0) {
    return fallback ?? empty;
  }
  const captures = { red: [], black: [] };
  history.forEach((move) => {
    if (!move?.captured || !captures[move.side]) return;
    captures[move.side].push(move.captured);
  });
  return captures;
}
