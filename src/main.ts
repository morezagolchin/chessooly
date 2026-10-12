import { Chess, type Square } from 'chess.js';
import { Chessground } from 'chessground';
import type { Api } from 'chessground/api';
import type { Color, Key } from 'chessground/types';

import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.brown.css';
import 'chessground/assets/chessground.cburnett.css';
import './style.css';

import { Online, inviteIdFromUrl, inviteLink, type Message } from './online';

type PromotionPiece = 'q' | 'r' | 'b' | 'n';
type Side = 'w' | 'b';

const chess = new Chess();

/** Online game state. In local mode both sides are played on this device. */
const state = {
  mode: 'local' as 'local' | 'online',
  role: null as 'host' | 'guest' | null,
  myColor: 'w' as Side,
  resigned: null as Side | null,
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

const ground: Api = Chessground(boardEl, {
  movable: {
    free: false,
    showDests: true,
    events: { after: onBoardMove },
  },
  premovable: { enabled: false },
  highlight: { lastMove: true, check: true },
});

const colorName = (side: Side): Color => (side === 'w' ? 'white' : 'black');
const turnColor = (): Color => colorName(chess.turn());
const opposite = (side: Side): Side => (side === 'w' ? 'b' : 'w');
const isOver = () => chess.isGameOver() || state.resigned !== null;

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

function onBoardMove(orig: Key, dest: Key) {
  const from = orig as Square;
  const to = dest as Square;
  const isPromotion = chess
    .moves({ square: from, verbose: true })
    .some((m) => m.to === to && m.promotion);

  if (isPromotion) {
    askPromotion(from, to);
  } else {
    play(chess.move({ from, to }).san);
  }
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
  if (chess.isCheckmate()) {
    if (online) return chess.turn() === state.myColor ? 'Checkmate — you lose' : 'Checkmate — you win!';
    return `Checkmate — ${other} wins`;
  }
  if (chess.isStalemate()) return 'Draw by stalemate';
  if (chess.isInsufficientMaterial()) return 'Draw by insufficient material';
  if (chess.isThreefoldRepetition()) return 'Draw by threefold repetition';
  if (chess.isDraw()) return 'Draw by the 50-move rule';
  if (online && state.disconnected) return 'Your opponent disconnected';
  if (online) {
    const whose = chess.turn() === state.myColor ? 'Your move' : "Opponent's move";
    return chess.inCheck() ? `${whose} — check!` : whose;
  }
  if (chess.inCheck()) return `${side} to move — check!`;
  return `${side} to move`;
}

function renderMoves() {
  const history = chess.history();
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
  const last = chess.history({ verbose: true }).at(-1);
  const color = turnColor();
  const online = state.mode === 'online';
  const canMove = !isOver() && !(online && (state.disconnected || chess.turn() !== state.myColor));

  ground.set({
    fen: chess.fen(),
    turnColor: color,
    check: chess.inCheck() ? color : false,
    lastMove: last ? [last.from, last.to] : undefined,
    movable: {
      color: canMove ? color : undefined,
      dests: canMove ? legalDests() : new Map(),
    },
    ...(!online && autoFlipEl.checked ? { orientation: color } : {}),
  });

  document.body.classList.toggle('is-online', online);
  modeEl.textContent = online
    ? `Online game · you play ${state.myColor === 'w' ? 'White' : 'Black'}`
    : 'Local game · pass and play';
  statusEl.textContent = statusText();
  statusEl.classList.toggle('over', isOver() || (online && state.disconnected));
  renderMoves();
}

// --- Online play -----------------------------------------------------------

const online = new Online({
  onOpen() {
    if (state.role !== 'host') return;
    // The host picks colours at random and tells the guest which side they play.
    const guestColor: Side = Math.random() < 0.5 ? 'w' : 'b';
    startOnlineGame(opposite(guestColor));
    online.send({ type: 'hello', guestColor, pgn: chess.pgn() });
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
  state.mode = 'online';
  state.myColor = myColor;
  state.resigned = null;
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
      if (state.role === 'guest') startOnlineGame(msg.guestColor, msg.pgn);
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
  state.resigned = null;
  state.disconnected = false;
  onlineInfoEl.textContent = '';
  showOnlineIdle();
  history.replaceState(null, '', location.pathname + location.search);
  if (wasPlaying) {
    chess.reset();
    ground.set({ orientation: 'white' });
  }
  sync();
}

const actions: Record<string, () => void> = {
  new() {
    if (chess.history().length && !confirm('Start a new game?')) return;
    chess.reset();
    state.resigned = null;
    sync();
  },
  undo() {
    chess.undo();
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
  'cancel-promotion'() {
    promotionEl.hidden = true;
    sync(); // snap the pawn back
  },
};

document.addEventListener('click', (e) => {
  const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action) actions[action]?.();
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
