// Word cloud layout: biggest words first, each placed on an Archimedean spiral
// from the centre at the first spot where its box does not collide with others.
// Coordinates are in "box units" (W × H); the caller turns them into percentages.

import { esc } from './util';

export interface Placed {
  word: string;
  n: number;
  size: number; // font size in box units
  x: number; // centre
  y: number;
  color: number;
}

const FONT = '900 100px UrbanGrotesk, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
let ctx: CanvasRenderingContext2D | null = null;

function measure(word: string, size: number): number {
  ctx ||= document.createElement('canvas').getContext('2d');
  if (!ctx) return word.length * size * 0.6;
  ctx.font = FONT;
  return (ctx.measureText(word).width / 100) * size;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function layout(entries: [string, number][], W: number, H: number, maxWords = 70): Placed[] {
  const sorted = [...entries].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs')).slice(0, maxWords);
  if (!sorted.length) return [];
  const max = sorted[0][1];
  const min = sorted[sorted.length - 1][1];
  const fewWords = sorted.length < 8;
  const big = fewWords ? H * 0.2 : H * 0.17;
  const small = H * 0.055;

  for (let attempt = 0; attempt < 6; attempt++) {
    const scale = Math.pow(0.88, attempt);
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: Placed[] = [];
    let ok = true;

    for (const [word, n] of sorted) {
      const t = max === min ? 1 : Math.sqrt((n - min) / (max - min));
      const size = (small + (big - small) * t) * scale;
      const w = measure(word, size) + size * 0.3;
      const h = size * 1.05;
      let placed = false;
      const start = (hash(word) % 360) * (Math.PI / 180);
      for (let i = 0; i < 2400; i++) {
        const a = start + i * 0.18;
        const r = i * 0.075 * (H / 100) * 2.2;
        const cx = W / 2 + r * Math.cos(a) * (W / H) * 0.9;
        const cy = H / 2 + r * Math.sin(a);
        const b = { x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 };
        if (b.x0 < 0 || b.y0 < 0 || b.x1 > W || b.y1 > H) continue;
        if (boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0)) continue;
        boxes.push(b);
        out.push({ word, n, size, x: cx, y: cy, color: hash(word) % 3 });
        placed = true;
        break;
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok || attempt === 5) return out;
  }
  return [];
}

/** HTML for a cloud in a box sized W × H container-units (cqw of the stage). */
export function cloudHtml(entries: [string, number][], W: number, H: number): string {
  const words = layout(entries, W, H);
  if (!words.length) return `<div class="cloud-empty">Zatím žádná slova</div>`;
  return words
    .map(
      p =>
        `<span class="cw c${p.color}" data-k="w:${esc(p.word)}" style="left:${((p.x / W) * 100).toFixed(2)}%;top:${((p.y / H) * 100).toFixed(2)}%;font-size:${p.size.toFixed(2)}cqw" title="${p.n}">${esc(p.word)}</span>`,
    )
    .join('');
}
