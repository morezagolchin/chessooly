import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';

const FILES = 'abcdefgh';
const JUMPS = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2],
];

function knightJumps(key: Key): Key[] {
  const file = FILES.indexOf(key[0]);
  const rank = +key[1];
  return JUMPS.map(([df, dr]) => [file + df, rank + dr])
    .filter(([f, r]) => f >= 0 && f < 8 && r >= 1 && r <= 8)
    .map(([f, r]) => `${FILES[f]}${r}` as Key);
}

/** FEN of an otherwise empty board with a white knight on `key`. */
function knightFen(key: Key | undefined): string {
  const rows: string[] = [];
  for (let rank = 8; rank >= 1; rank--) {
    if (key && +key[1] === rank) {
      const file = FILES.indexOf(key[0]);
      rows.push(`${file || ''}N${7 - file || ''}`);
    } else {
      rows.push('8');
    }
  }
  return rows.join('/');
}

/** The visit number drawn in the middle of a visited square. */
const visitLabel = (n: number) =>
  `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="38" font-weight="700" fill="#000" fill-opacity="0.45">${n}</text>`;

/** Knight's tour: place a knight anywhere, then visit every square exactly once. */
export class KnightsTour {
  /** Squares in the order they were visited; the knight stands on the last one. */
  private path: Key[] = [];

  constructor(
    private ground: Api,
    private status: HTMLElement,
  ) {}

  get visited(): number {
    return this.path.length;
  }

  start() {
    this.path = [];
    this.ground.selectSquare(null);
    this.render();
  }

  stop() {
    this.ground.selectSquare(null);
    this.ground.set({ highlight: { custom: new Map() } });
    this.ground.setAutoShapes([]);
  }

  /** Before the tour starts, clicking a square places the knight there. */
  click(key: Key) {
    if (this.path.length) return;
    this.path.push(key);
    this.render();
  }

  move(_orig: Key, dest: Key) {
    this.path.push(dest);
    this.render();
  }

  undo() {
    this.path.pop();
    this.render();
  }

  private render() {
    const knight = this.path.at(-1);
    const behind = this.path.slice(0, -1);
    const reachable = knight ? knightJumps(knight).filter((k) => !this.path.includes(k)) : [];

    this.ground.set({
      fen: knightFen(knight),
      turnColor: 'white',
      lastMove: undefined,
      check: false,
      movable: {
        color: 'white',
        dests: knight ? new Map([[knight, reachable]]) : new Map(),
        showDests: true,
      },
      highlight: { custom: new Map(behind.map((k) => [k, 'tour-visited'])) },
    });
    this.ground.setAutoShapes(behind.map((k, i) => ({ orig: k, customSvg: { html: visitLabel(i + 1) } })));

    const stuck = !!knight && this.path.length < 64 && !reachable.length;
    this.status.textContent = !knight
      ? 'Click any square to place your knight'
      : this.path.length === 64
        ? 'Tour complete — all 64 squares visited!'
        : stuck
          ? `Stuck — no unvisited square in reach. ${this.path.length} of 64 visited.`
          : `${this.path.length} of 64 squares visited`;
    this.status.classList.toggle('over', stuck);
  }
}
