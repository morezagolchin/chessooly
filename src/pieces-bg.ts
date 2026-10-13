// Fills the fixed background with random chess pieces, like the DNA letters on morezagolchin.github.io.

// U+FE0E keeps the pawn a plain glyph: some systems draw ♟ alone as an emoji.
const PIECES = ['♚', '♛', '♜', '♝', '♞', '♟\uFE0E'];

const bg = document.querySelector<HTMLElement>('.pieces-bg');
// The pieces go in an inner box wider than the window, so each row runs past
// the right edge instead of stopping at the last whole piece that fits.
const el = bg?.appendChild(document.createElement('div'));
let text = '';
let count = 0;

// Measure one piece in the background's font to work out how many fit.
function cellSize() {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap';
  probe.textContent = PIECES[0].repeat(50);
  el!.append(probe);
  const rect = probe.getBoundingClientRect();
  probe.remove();
  const lineHeight = parseFloat(getComputedStyle(el!).lineHeight) || rect.height;
  return { width: rect.width / 50, height: lineHeight };
}

// Only ever extend the text, so the pattern doesn't reshuffle on resize.
function fill() {
  const { width, height } = cellSize();
  const overhang = el!.offsetWidth - bg!.clientWidth;
  const w = Math.max(innerWidth, screen.width) + overhang;
  const h = Math.max(innerHeight, screen.height);
  const needed = Math.ceil(w / width + 2) * Math.ceil(h / height + 2);
  if (needed <= count) return;
  let more = '';
  for (; count < needed; count++) more += PIECES[Math.floor(Math.random() * PIECES.length)];
  text += more;
  el!.textContent = text;
}

if (el) {
  fill();
  addEventListener('resize', fill);
}
