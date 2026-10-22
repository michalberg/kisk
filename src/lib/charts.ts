import { isProfane } from './profanity';
import type { QuestionSlide, Results } from './types';
import { esc, fmtNum, pct, rich, votesLabel } from './util';
import { cloudHtml } from './wordcloud';

export function scaleStats(r: Results | null) {
  const counts = [1, 2, 3, 4, 5].map(v => r?.counts[String(v)] || 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const avg = total ? counts.reduce((a, n, i) => a + n * (i + 1), 0) / total : null;
  return { counts, total, avg };
}

/** Vertical bars 1 to 5 with counts, percentages and the mean on a ruler underneath. */
export function scaleChart(q: QuestionSlide, r: Results | null, opts: { compact?: boolean } = {}): string {
  const { counts, total, avg } = scaleStats(r);
  const max = Math.max(1, ...counts);
  const bars = counts
    .map(
      (n, i) => `<div class="sc-col" data-k="sc${i}">
        <div class="sc-val">${n ? `<b>${pct(n, total)} %</b><span>${n}</span>` : ''}</div>
        <div class="sc-track"><div class="sc-bar" style="height:${((n / max) * 100).toFixed(1)}%"></div></div>
        <div class="sc-num">${i + 1}</div>
      </div>`,
    )
    .join('');
  const avgPos = avg === null ? 0 : ((avg - 1) / 4) * 100;
  return `<div class="scale-chart${opts.compact ? ' compact' : ''}">
    <div class="sc-bars">${bars}</div>
    <div class="sc-ends"><span>1 = ${esc(q.scale?.min)}</span><span>5 = ${esc(q.scale?.max)}</span></div>
    <div class="sc-avg">${
      avg === null
        ? '<span class="sc-avg-label">Zatím bez hlasů</span>'
        : `<div class="sc-ruler"><div class="sc-marker" style="left:${avgPos.toFixed(1)}%"><span>${fmtNum(avg)}</span></div></div><span class="sc-avg-label">průměr ${fmtNum(avg)} · ${votesLabel(total)}</span>`
    }</div>
  </div>`;
}

/** Horizontal bars in the order of the options (never sorted by count). */
export function barsChart(q: QuestionSlide, r: Results | null): string {
  const total = r?.total || 0;
  const opts = q.options || [];
  const counts = opts.map(o => r?.counts[o.id] || 0);
  const lead = Math.max(0, ...counts);
  // bars are scaled to the largest answer so differences read well on a projector;
  // the labels carry the real percentages
  const scaleTo = Math.max(1, lead);
  const rows = opts
    .map((o, i) => {
      const n = counts[i];
      const p = pct(n, total);
      const badge = q.ladder ? `<span class="badge${o.id === 'nikde' ? ' wide' : ''}">${o.id === 'nikde' ? '–' : esc(o.id)}</span>` : '';
      return `<div class="hb-row${n && n === lead ? ' top' : ''}" data-k="hb${esc(o.id)}">
        <div class="hb-label">${badge}<span>${rich(o.label)}</span></div>
        <div class="hb-track"><div class="hb-bar" style="width:${((n / scaleTo) * 100).toFixed(1)}%"></div></div>
        <div class="hb-val"><b>${p} %</b><span>${n}</span></div>
      </div>`;
    })
    .join('');
  const foot =
    q.qtype === 'multi'
      ? `Podíl lidí, kteří možnost zaškrtli · ${votesLabel(total)}`
      : votesLabel(total);
  return `<div class="bars-chart${opts.length > 5 ? ' dense' : ''}">${rows}<div class="hb-foot">${foot}</div></div>`;
}

export function cloudEntries(r: Results | null, filter = true): [string, number][] {
  return Object.entries(r?.counts || {}).filter(([w]) => !filter || !isProfane(w));
}

export function wordcloudChart(r: Results | null, W: number, H: number): string {
  return `<div class="cloud" style="width:${W}cqw;height:${H}cqw">${cloudHtml(cloudEntries(r), W, H)}</div>
    <div class="hb-foot">${votesLabel(r?.total || 0)}</div>`;
}

export function chartFor(q: QuestionSlide, r: Results | null, cloudBox: [number, number] = [86, 30]): string {
  if (q.qtype === 'scale') return scaleChart(q, r);
  if (q.qtype === 'wordcloud') return wordcloudChart(r, cloudBox[0], cloudBox[1]);
  return barsChart(q, r);
}
