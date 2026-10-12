import type { Api } from 'chessground/api';
import type { Key } from 'chessground/types';

const FILES = 'abcdefgh';
const EMPTY_BOARD = '8/8/8/8/8/8/8/8';

const randomSquare = (): Key => `${FILES[Math.floor(Math.random() * 8)]}${Math.floor(Math.random() * 8) + 1}` as Key;

interface TrainerElements {
  /** Under the board: the square to find. */
  prompt: HTMLElement;
  status: HTMLElement;
  replay: HTMLButtonElement;
}

/** Coordinates trainer: a square is named under the board and the player clicks it. One wrong click ends the round. */
export class CoordinateTrainer {
  active = false;
  private target: Key = 'a1';
  private score = 0;
  private missed: Key | null = null;

  constructor(
    private ground: Api,
    private els: TrainerElements,
  ) {}

  /** Clear the board and start a round from a score of zero. */
  start() {
    this.active = true;
    this.score = 0;
    this.missed = null;
    this.ground.selectSquare(null);
    this.ground.set({
      fen: EMPTY_BOARD,
      lastMove: undefined,
      check: false,
      movable: { color: undefined, dests: new Map() },
    });
    this.next();
  }

  stop() {
    this.active = false;
    this.ground.set({ highlight: { custom: new Map() } });
  }

  /** Every square clicked on the board, in any mode. */
  click(key: Key) {
    if (!this.active || this.missed) return;
    if (key === this.target) {
      this.score++;
      this.next();
      return;
    }
    this.missed = key;
    this.ground.set({
      highlight: {
        custom: new Map([
          [this.target, 'coord-answer'],
          [key, 'coord-miss'],
        ]),
      },
    });
    this.render();
  }

  private next() {
    let square: Key;
    do square = randomSquare();
    while (square === this.target);
    this.target = square;
    this.ground.set({ highlight: { custom: new Map() } });
    this.render();
  }

  private render() {
    this.els.prompt.textContent = this.target;
    this.els.status.textContent = this.missed
      ? `Wrong — you clicked ${this.missed}. Final score: ${this.score}`
      : `Score: ${this.score}`;
    this.els.status.classList.toggle('over', !!this.missed);
    this.els.replay.hidden = !this.missed;
  }
}
