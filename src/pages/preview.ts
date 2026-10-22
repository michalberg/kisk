import '../styles/base.css';
import '../styles/slides.css';
import '../styles/preview.css';
import { audienceUrl, slides, stateForSlide } from '../lib/deck';
import { renderSlide } from '../lib/render';
import { esc } from '../lib/util';

// Static walk-through of all slides: no server, no votes. Slide number lives in
// the URL hash (#12) so a slide can be linked directly.

const $ = (id: string) => document.getElementById(id)!;
const url = audienceUrl();
let i = 0;
let notesOn = false;

function fromHash(): number {
  const n = parseInt(location.hash.slice(1), 10);
  return Number.isFinite(n) ? Math.min(Math.max(n - 1, 0), slides.length - 1) : 0;
}

function draw() {
  const s = slides[i];
  // show questions as open and result slides with their (empty) charts
  const state = { ...stateForSlide(i), voting_open: false };
  $('stage').innerHTML = renderSlide(s, { state, counts: {}, results: {}, audienceUrl: url, index: i, total: slides.length });
  $('pos').textContent = `${i + 1} / ${slides.length}`;
  $('sec').textContent = s.section || '';
  ($('prev') as HTMLButtonElement).disabled = i === 0;
  ($('next') as HTMLButtonElement).disabled = i === slides.length - 1;
  const notes = $('notes');
  notes.hidden = !notesOn;
  notes.innerHTML = s.notes ? esc(s.notes).replace(/\[([^\]]+)\]/g, '<mark>[$1]</mark>') : 'Bez poznámek';
  $('notes-btn').setAttribute('aria-pressed', String(notesOn));
  if (location.hash !== `#${i + 1}`) history.replaceState(null, '', `#${i + 1}`);
}

function go(n: number) {
  i = Math.min(Math.max(n, 0), slides.length - 1);
  draw();
}

$('prev').addEventListener('click', () => go(i - 1));
$('next').addEventListener('click', () => go(i + 1));
$('hit-prev').addEventListener('click', () => go(i - 1));
$('hit-next').addEventListener('click', () => go(i + 1));
$('notes-btn').addEventListener('click', () => {
  notesOn = !notesOn;
  draw();
});
$('full').addEventListener('click', () => document.body.requestFullscreen?.().catch(() => {}));

document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (['ArrowRight', 'PageDown', ' '].includes(e.key)) {
    e.preventDefault();
    go(i + 1);
  } else if (['ArrowLeft', 'PageUp'].includes(e.key)) {
    e.preventDefault();
    go(i - 1);
  } else if (e.key === 'Home') go(0);
  else if (e.key === 'End') go(slides.length - 1);
  else if (e.key === 'n' || e.key === 'N') {
    notesOn = !notesOn;
    draw();
  } else if (e.key === 'f' || e.key === 'F') document.body.requestFullscreen?.().catch(() => {});
});

// swipe on touch screens
let touchX: number | null = null;
document.addEventListener('touchstart', e => (touchX = e.touches[0].clientX), { passive: true });
document.addEventListener('touchend', e => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 50) go(i + (dx < 0 ? 1 : -1));
  touchX = null;
});

window.addEventListener('hashchange', () => go(fromHash()));
i = fromHash();
draw();
document.fonts?.ready.then(draw);
