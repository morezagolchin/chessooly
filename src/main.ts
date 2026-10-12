import { Chess, SQUARES, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Color, Key } from 'chessground/types';

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';

import { CoordinateTrainer } from './coordinates';
import { KnightsTour } from './knights-tour';
import { Online, inviteIdFromUrl, inviteLink, type Message, type Variant } from './online';

type PromotionPiece = 'q' | 'r' | 'b' | 'n';
type Side = 'w' | 'b';
type Training = 'coordinates' | 'knights-tour';

const EMPTY_BOARD = '8/8/8/8/8/8/8/8';

/** The points game: what each event is worth, and how long a peek shows the pieces. */
const PEEK_POINTS = 1;
const ILLEGAL_POINTS = 2;
const MATE_POINTS = 10;
const PEEK_MS = 3000;

/** A training game from the sidebar. It takes over the board and panel while it's open. */
interface Trainer {
  start(): void;
  stop(): void;
  /** A square clicked on the board. */
  click?(key: Key): void;
  /** A piece moved on the board. */
  move?(orig: Key, dest: Key): void;
}

const chess = new Chess();

/** Game state beyond the position. In local mode both sides are played on this device. */
const state = {
  mode: 'local' as 'local' | 'online',
  variant: 'classic' as Variant,
  /** The open training game, if any. The chess game is kept as it was underneath. */
  training: null as Training | null,
  role: null as 'host' | 'guest' | null,
  myColor: 'w' as Side,
  resigned: null as Side | null,
  /** Disguised modes: an illegal move that was tried, which loses the game for that side. */
  illegal: null as { side: Side; from: Square; to: Square } | null,
  /** Invisible mode: the square clicked as the start of a move, waiting for its destination. */
  picked: null as Square | null,
  /** The points game: each side's score from the opponent's peeks and illegal moves. Checkmate's points come on top. */
  points: { w: 0, b: 0 } as Record<Side, number>,
  /** The points game: the last peek or illegal move, shown until the position changes. */
  notice: null as { text: string; fen: string } | null,
  /** The points game: the position the pieces are being shown in. Making a move ends the peek. */
  peekFen: null as string | null,
  disconnected: false,
};

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const boardEl = $<HTMLDivElement>('#board');
const statusEl = $<HTMLParagraphElement>('#status');
const movesEl = $<HTMLOListElement>('#moves');
const autoFlipEl = $<HTMLInputElement>('#auto-flip');
const promotionEl = $<HTMLDivElement>('#promotion');
const modeEl = $<HTMLSpanElement>('#mode');
const onlineIdleEl = $<HTMLDivElement>('#online-idle');
const onlineInviteEl = $<HTMLDivElement>('#online-invite');
const inviteLinkEl = $<HTMLInputElement>('#invite-link');
const onlineInfoEl = $<HTMLParagraphElement>('#online-info');
const pointsEl = $<HTMLParagraphElement>('#points');
const peekEl = $<HTMLButtonElement>('#peek');
const modeButtons = document.querySelectorAll<HTMLButtonElement>('.mode-option');
const trainerEls = document.querySelectorAll<HTMLElement>('.trainer-ui');

const ground: Api = Chessground(boardEl, {
  movable: {
    free: false,
    showDests: true,
    events: { after: onBoardMove },
  },
  premovable: { enabled: false },
  highlight: { lastMove: true, check: true },
  events: {
    select(key) {
      if (state.training) trainers[state.training].click?.(key);
      else if (clickToMove()) pickSquare(key as Square);
    },
  },
});

const coordinates = new CoordinateTrainer(ground, {
  prompt: $('#coord-prompt'),
  status: $('#coord-status'),
  replay: $<HTMLButtonElement>('#coord-replay'),
});
const knightsTour = new KnightsTour(ground, $('#tour-status'));
const trainers: Record<Training, Trainer> = { coordinates, 'knights-tour': knightsTour };
const trainingTitles: Record<Training, string> = { coordinates: 'coordinates', 'knights-tour': "knight's tour" };

const colorName = (side: Side): Color => (side === 'w' ? 'white' : 'black');
const turnColor = (): Color => colorName(chess.turn());
const opposite = (side: Side): Side => (side === 'w' ? 'b' : 'w');
const isOver = () => chess.isGameOver() || state.resigned !== null || state.illegal !== null;
/** Whether the person at this board may make a move now. */
const canPlay = () =>
  !isOver() && !(state.mode === 'online' && (state.disconnected || chess.turn() !== state.myColor));
/** Modes where the pieces can't be seen: moves are made by clicking squares, never by dragging pieces. */
const clickToMove = () => state.variant === 'invisible' || state.variant === 'points';
const peeking = () => state.peekFen === chess.fen();
const sideName = (side: Side) => (side === 'w' ? 'White' : 'Black');
let peekTimer = 0;

/** Legal destinations for every piece of the side to move, in chessground's format. */
function legalDests(): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const move of chess.moves({ verbose: true })) {
    const list = dests.get(move.from) ?? [];
    list.push(move.to);
    dests.set(move.from, list);
  }
  return dests;
}

/** Disguised modes: any piece of the side to move may go to any square not holding one of its own pieces. */
function anyDests(): Map<Key, Key[]> {
  const own = SQUARES.filter((sq) => chess.get(sq)?.color === chess.turn());
  const others = SQUARES.filter((sq) => chess.get(sq)?.color !== chess.turn());
  return new Map(own.map((sq) => [sq, others]));
}

/**
 * The sides whose pieces are hidden from whoever is at the board: drawn as pawns, or in Invisible mode not
 * drawn at all. Everything is revealed once the game ends.
 */
function hiddenSides(): Side[] {
  if (isOver()) return [];
  // In pass and play, "you" are the side to move.
  const me = state.mode === 'online' ? state.myColor : chess.turn();
  switch (state.variant) {
    case 'classic':
      return [];
    case 'disguised':
      return ['w', 'b'];
    case 'disguised-opponent':
      return [opposite(me)];
    case 'disguised-self':
      return [me];
    case 'invisible':
      return ['w', 'b'];
    case 'points':
      return peeking() ? [] : ['w', 'b'];
  }
}

/** The position in FEN with the given sides' pieces shown as pawns of their colour. */
function disguise(fen: string, sides: Side[]): string {
  let board = fen.split(' ')[0];
  if (sides.includes('w')) board = board.replace(/[NBRQK]/g, 'P');
  if (sides.includes('b')) board = board.replace(/[nbrqk]/g, 'p');
  return board;
}

function onBoardMove(orig: Key, dest: Key) {
  if (state.training) return trainers[state.training].move?.(orig, dest);
  tryMove(orig as Square, dest as Square);
}

/** Invisible modes: with no pieces to drag, a move is the square clicked first and then its destination. */
function pickSquare(square: Square) {
  if (!canPlay()) return;
  const from = state.picked;
  if (from && from !== square) {
    state.picked = null;
    tryMove(from, square);
  } else {
    // The first click, or the same square again to cancel.
    state.picked = from ? null : square;
    sync();
  }
}

function tryMove(from: Square, to: Square) {
  const candidates = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);

  if (!candidates.length) {
    // Only reachable in the disguised and invisible modes, where the board offers every square.
    if (state.mode === 'online') online.send({ type: 'illegal', from, to });
    illegalMove(chess.turn(), from, to);
    sync();
  } else if (candidates.some((m) => m.promotion)) {
    askPromotion(from, to);
  } else {
    play(chess.move({ from, to }).san);
  }
}

/** `side` tried an illegal move. That loses the game, except in the points game, where it gives the opponent points. */
function illegalMove(side: Side, from: Square, to: Square) {
  if (state.variant !== 'points') {
    state.illegal = { side, from, to };
    return;
  }
  const move = `${from}–${to}`;
  state.points[opposite(side)] += ILLEGAL_POINTS;
  notify(
    state.mode !== 'online'
      ? `${sideName(side)} tried an illegal move (${move}): +${ILLEGAL_POINTS} for ${sideName(opposite(side))}`
      : side === state.myColor
        ? `Illegal move (${move}): +${ILLEGAL_POINTS} for your opponent`
        : `Your opponent tried an illegal move (${move}): +${ILLEGAL_POINTS} for you`,
  );
}

/** The points game: show the pieces for a few seconds, for a point to the opponent. */
function startPeek() {
  if (state.variant !== 'points' || !canPlay() || peeking()) return;
  if (state.mode === 'online') online.send({ type: 'peek' });
  peeked(chess.turn());
  state.peekFen = chess.fen();
  clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => {
    state.peekFen = null;
    sync();
  }, PEEK_MS);
  sync();
}

function peeked(side: Side) {
  state.points[opposite(side)] += PEEK_POINTS;
  notify(
    state.mode !== 'online'
      ? `${sideName(side)} peeked: +${PEEK_POINTS} for ${sideName(opposite(side))}`
      : side === state.myColor
        ? `You peeked: +${PEEK_POINTS} for your opponent`
        : `Your opponent peeked: +${PEEK_POINTS} for you`,
  );
}

const notify = (text: string) => (state.notice = { text, fen: chess.fen() });

/** The points game: each side's score, including checkmate's points for the winner. */
function finalPoints(): Record<Side, number> {
  const points = { ...state.points };
  if (chess.isCheckmate()) points[opposite(chess.turn())] += MATE_POINTS;
  return points;
}

/** The points game once it's over: how it ended on the board, and who won on points. */
function pointsResult(): string {
  const online = state.mode === 'online';
  const points = finalPoints();
  const mater = opposite(chess.turn());
  const ending = chess.isCheckmate()
    ? `Checkmate: +${MATE_POINTS} for ${online ? (mater === state.myColor ? 'you' : 'your opponent') : sideName(mater)}`
    : `Game over by ${drawReason()}`;
  const score = `${Math.max(points.w, points.b)}–${Math.min(points.w, points.b)}`;

  if (points.w === points.b) return `${ending}. Tied on points, ${score}`;
  const winner: Side = points.w > points.b ? 'w' : 'b';
  if (!online) return `${ending}. ${sideName(winner)} wins on points, ${score}`;
  return winner === state.myColor ? `${ending}. You win on points, ${score}!` : `${ending}. You lose on points, ${score}`;
}

/** Why the game is drawn on the board, if it is. */
function drawReason(): string | null {
  if (chess.isStalemate()) return 'stalemate';
  if (chess.isInsufficientMaterial()) return 'insufficient material';
  if (chess.isThreefoldRepetition()) return 'threefold repetition';
  if (chess.isDraw()) return 'the 50-move rule';
  return null;
}

/** A move made on this device: show it, and send it to the opponent when online. */
function play(san: string) {
  if (state.mode === 'online') online.send({ type: 'move', san });
  sync();
}

function askPromotion(from: Square, to: Square) {
  const color = chess.turn() === 'w' ? 'white' : 'black';
  const choices = promotionEl.querySelector<HTMLDivElement>('.promotion-choices')!;
  const pieces: [PromotionPiece, string][] = [
    ['q', 'queen'],
    ['r', 'rook'],
    ['b', 'bishop'],
    ['n', 'knight'],
  ];

  choices.replaceChildren(
    ...pieces.map(([piece, role]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'promotion-piece cg-wrap';
      button.setAttribute('aria-label', role);
      button.innerHTML = `<piece class="${color} ${role}"></piece>`;
      button.addEventListener('click', () => {
        promotionEl.hidden = true;
        play(chess.move({ from, to, promotion: piece }).san);
      });
      return button;
    }),
  );
  promotionEl.hidden = false;
}

function statusText(): string {
  const side = chess.turn() === 'w' ? 'White' : 'Black';
  const other = chess.turn() === 'w' ? 'Black' : 'White';
  const online = state.mode === 'online';

  if (state.resigned) {
    if (online) return state.resigned === state.myColor ? 'You resigned' : 'Your opponent resigned — you win';
    return `${state.resigned === 'w' ? 'White' : 'Black'} resigned`;
  }
  if (state.illegal) {
    const { side: mover, from, to } = state.illegal;
    const move = `${from}–${to}`;
    if (online) {
      return mover === state.myColor
        ? `Illegal move (${move}) — you lose`
        : `Your opponent tried an illegal move (${move}) — you win!`;
    }
    return `Illegal move by ${mover === 'w' ? 'White' : 'Black'} (${move}) — ${mover === 'w' ? 'Black' : 'White'} wins`;
  }
  if (state.variant === 'points' && chess.isGameOver()) return pointsResult();
  if (chess.isCheckmate()) {
    if (online) return chess.turn() === state.myColor ? 'Checkmate — you lose' : 'Checkmate — you win!';
    return `Checkmate — ${other} wins`;
  }
  const draw = drawReason();
  if (draw) return `Draw by ${draw}`;
  if (online && state.disconnected) return 'Your opponent disconnected';

  const notice = state.notice?.fen === chess.fen() ? `${state.notice.text}. ` : '';
  if (online) {
    const whose = chess.turn() === state.myColor ? 'Your move' : "Opponent's move";
    return notice + (chess.inCheck() ? `${whose} — check!` : whose);
  }
  return notice + (chess.inCheck() ? `${side} to move — check!` : `${side} to move`);
}

function renderMoves() {
  // Standard notation names the pieces, so disguised games list squares only.
  const hidden = hiddenSides().length > 0;
  const history = chess
    .history({ verbose: true })
    .map((m) => (hidden ? `${m.from}${m.captured ? '×' : '–'}${m.to}` : m.san));
  const rows: HTMLLIElement[] = [];
  for (let i = 0; i < history.length; i += 2) {
    const li = document.createElement('li');
    li.innerHTML = `<span>${history[i]}</span><span>${history[i + 1] ?? ''}</span>`;
    rows.push(li);
  }
  movesEl.replaceChildren(...rows);
  movesEl.scrollTop = movesEl.scrollHeight;
}

/** Push the current game state from chess.js to the board and side panel. */
function sync() {
  const online = state.mode === 'online';

  document.body.classList.toggle('is-online', online);
  if (state.training) document.body.dataset.training = state.training;
  else delete document.body.dataset.training;
  document.body.dataset.variant = state.variant;
  for (const el of trainerEls) el.hidden = el.dataset.training !== state.training;
  for (const button of modeButtons) {
    const active = state.training
      ? button.dataset.training === state.training
      : button.dataset.variant === state.variant;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = online;
  }
  modeEl.textContent = state.training
    ? `Training · ${trainingTitles[state.training]}`
    : online
      ? `Online game · you play ${state.myColor === 'w' ? 'White' : 'Black'}`
      : 'Local game · pass and play';

  // Training games draw their own board; the chess game is left as it was until the player comes back to it.
  if (state.training) return;

  const last = chess.history({ verbose: true }).at(-1);
  const color = turnColor();
  const canMove = canPlay();
  const classic = state.variant === 'classic';
  const invisible = clickToMove();
  const hidden = hiddenSides();

  ground.set({
    fen: invisible && hidden.length ? EMPTY_BOARD : disguise(chess.fen(), hidden),
    turnColor: color,
    // Highlighting the checked square would give away where a hidden king is.
    check: chess.inCheck() && !hidden.includes(chess.turn()) ? color : false,
    lastMove: state.illegal ? [state.illegal.from, state.illegal.to] : last ? [last.from, last.to] : undefined,
    movable: {
      color: canMove && !invisible ? color : undefined,
      dests: canMove ? (classic ? legalDests() : anyDests()) : new Map(),
      showDests: classic,
    },
    highlight: { custom: new Map<Key, string>(state.picked && canMove ? [[state.picked, 'selected']] : []) },
    ...(!online && autoFlipEl.checked ? { orientation: color } : {}),
  });

  statusEl.textContent = statusText();
  statusEl.classList.toggle('over', isOver() || (online && state.disconnected));
  if (state.variant === 'points') {
    const points = finalPoints();
    pointsEl.textContent = online
      ? `Points — you ${points[state.myColor]} · opponent ${points[opposite(state.myColor)]}`
      : `Points — White ${points.w} · Black ${points.b}`;
    peekEl.disabled = !canMove || peeking();
    peekEl.textContent = peeking()
      ? 'Peeking…'
      : `Peek (+${PEEK_POINTS} for ${online ? 'your opponent' : sideName(opposite(chess.turn()))})`;
  }
  renderMoves();
}

// --- Online play -----------------------------------------------------------

const online = new Online({
  onOpen() {
    if (state.role !== 'host') return;
    // The host picks colours at random and tells the guest which side they play.
    const guestColor: Side = Math.random() < 0.5 ? 'w' : 'b';
    startOnlineGame(opposite(guestColor));
    online.send({ type: 'hello', guestColor, pgn: chess.pgn(), variant: state.variant });
  },
  onMessage: handleMessage,
  onClose() {
    if (state.mode !== 'online') return;
    state.disconnected = true;
    sync();
  },
  onError(text) {
    if (state.mode === 'online') {
      // The signalling server may drop while the direct connection to the opponent is still fine.
      if (online.connected) return;
      state.disconnected = true;
      sync();
    } else {
      showOnlineIdle();
    }
    onlineInfoEl.textContent = text;
  },
});

function startOnlineGame(myColor: Side, pgn = '') {
  stopTraining();
  state.mode = 'online';
  state.myColor = myColor;
  clearGameState();
  state.disconnected = false;
  promotionEl.hidden = true;
  if (pgn) chess.loadPgn(pgn);
  else chess.reset();
  onlineInfoEl.textContent = '';
  // Drop the invite from the address bar so a reload doesn't try to rejoin.
  history.replaceState(null, '', location.pathname + location.search);
  ground.set({ orientation: colorName(myColor) });
  sync();
}

function handleMessage(msg: Message) {
  switch (msg.type) {
    case 'hello':
      if (state.role !== 'guest') break;
      state.variant = msg.variant;
      startOnlineGame(msg.guestColor, msg.pgn);
      break;
    case 'move':
      if (state.mode !== 'online' || chess.turn() === state.myColor) break;
      try {
        chess.move(msg.san);
      } catch {
        onlineInfoEl.textContent = 'Received an invalid move — the games may be out of sync.';
      }
      sync();
      break;
    case 'illegal':
      if (state.mode !== 'online' || chess.turn() === state.myColor) break;
      illegalMove(opposite(state.myColor), msg.from, msg.to);
      sync();
      break;
    case 'peek':
      if (state.mode !== 'online' || chess.turn() === state.myColor) break;
      peeked(opposite(state.myColor));
      sync();
      break;
    case 'resign':
      state.resigned = opposite(state.myColor);
      sync();
      break;
    case 'rematch-offer':
      if (confirm('Your opponent offers a rematch (colours swap). Accept?')) {
        online.send({ type: 'rematch-accept' });
        startOnlineGame(opposite(state.myColor));
      } else {
        online.send({ type: 'rematch-decline' });
      }
      break;
    case 'rematch-accept':
      startOnlineGame(opposite(state.myColor));
      break;
    case 'rematch-decline':
      statusEl.textContent = 'Your opponent declined the rematch';
      break;
  }
}

function showOnlineIdle() {
  onlineIdleEl.hidden = false;
  onlineInviteEl.hidden = true;
}

function leaveOnline() {
  const wasPlaying = state.mode === 'online';
  online.close();
  state.mode = 'local';
  state.role = null;
  state.disconnected = false;
  onlineInfoEl.textContent = '';
  showOnlineIdle();
  history.replaceState(null, '', location.pathname + location.search);
  // Cancelling an invite keeps the local game going; leaving an online game starts a fresh one.
  if (wasPlaying) {
    chess.reset();
    clearGameState();
    ground.set({ orientation: 'white' });
  }
  sync();
}

/** Forget everything about the current game beyond the position itself. */
function clearGameState() {
  state.resigned = null;
  state.illegal = null;
  state.picked = null;
  state.points = { w: 0, b: 0 };
  state.notice = null;
  state.peekFen = null;
}

function resetGame() {
  chess.reset();
  clearGameState();
  promotionEl.hidden = true;
  sync();
}

function switchVariant(variant: Variant) {
  if (state.mode === 'online') return;
  if (variant === state.variant) {
    // Back from training to the game that was left there.
    if (state.training) {
      stopTraining();
      sync();
    }
    return;
  }
  if (chess.history().length && !isOver() && !confirm('Switch game mode? The current game will be lost.')) return;
  stopTraining();
  state.variant = variant;
  resetGame();
}

function startTraining(training: Training) {
  if (state.mode === 'online' || training === state.training) return;
  stopTraining();
  promotionEl.hidden = true;
  state.training = training;
  trainers[training].start();
  sync();
}

function stopTraining() {
  if (state.training) trainers[state.training].stop();
  state.training = null;
}

const actions: Record<string, () => void> = {
  new() {
    if (chess.history().length && !confirm('Start a new game?')) return;
    resetGame();
  },
  undo() {
    // An illegal move never reached the position, so taking it back just cancels the loss.
    if (state.illegal) state.illegal = null;
    else chess.undo();
    state.picked = null;
    sync();
  },
  flip() {
    ground.toggleOrientation();
  },
  async invite() {
    state.role = 'host';
    onlineIdleEl.hidden = true;
    onlineInfoEl.textContent = 'Creating invite link…';
    const id = await online.host();
    inviteLinkEl.value = inviteLink(id);
    onlineInviteEl.hidden = false;
    onlineInfoEl.textContent = '';
  },
  async 'copy-link'() {
    inviteLinkEl.select();
    try {
      await navigator.clipboard.writeText(inviteLinkEl.value);
      onlineInfoEl.textContent = 'Link copied.';
    } catch {
      onlineInfoEl.textContent = 'Press Ctrl+C (or long-press) to copy the link.';
    }
  },
  leave() {
    if (state.mode === 'online' && !isOver() && !state.disconnected && !confirm('Leave this game?')) return;
    leaveOnline();
  },
  resign() {
    if (isOver() || state.disconnected || !confirm('Resign this game?')) return;
    state.resigned = state.myColor;
    online.send({ type: 'resign' });
    sync();
  },
  rematch() {
    if (state.disconnected) return;
    if (!isOver() && !confirm('Offer a rematch? The current game will be abandoned if accepted.')) return;
    online.send({ type: 'rematch-offer' });
    statusEl.textContent = 'Rematch offered — waiting for your opponent…';
  },
  peek() {
    startPeek();
  },
  replay() {
    coordinates.start();
  },
  'tour-undo'() {
    knightsTour.undo();
  },
  'tour-restart'() {
    if (knightsTour.visited > 1 && !confirm('Start a new tour?')) return;
    knightsTour.start();
  },
  'cancel-promotion'() {
    promotionEl.hidden = true;
    sync(); // snap the pawn back
  },
};

document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action) actions[action]?.();
  const variant = target.closest<HTMLElement>('.mode-option[data-variant]')?.dataset.variant;
  if (variant) switchVariant(variant as Variant);
  const training = target.closest<HTMLElement>('.mode-option[data-training]')?.dataset.training;
  if (training) startTraining(training as Training);
});

window.addEventListener('beforeunload', () => online.close());

autoFlipEl.addEventListener('change', sync);

sync();

const inviteId = inviteIdFromUrl();
if (inviteId) {
  state.role = 'guest';
  onlineIdleEl.hidden = true;
  onlineInfoEl.textContent = 'Connecting to your friend…';
  online.join(inviteId);
}
