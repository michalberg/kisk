import { chartFor, scaleChart, scaleStats } from './charts';
import { prettyUrl, questions } from './deck';
import { qrSvg } from './qr';
import type { QuestionSlide, Results, Slide, State } from './types';
import { esc, fmtNum, rich, votesLabel } from './util';

export interface RenderCtx {
  state: State;
  counts: Record<string, number>;
  results: Record<string, Results | null>;
  audienceUrl: string;
  /** slide index for the footer */
  index: number;
  total: number;
}

function footer(s: Slide, ctx: RenderCtx): string {
  return `<div class="foot"><span class="foot-sec">${esc(s.section)}</span><span class="foot-num">${ctx.index + 1}</span></div>`;
}

function join(ctx: RenderCtx, big = false): string {
  return `<div class="join${big ? ' big' : ''}">
    <div class="join-qr">${qrSvg(ctx.audienceUrl)}</div>
    <div class="join-url">${esc(prettyUrl(ctx.audienceUrl))}</div>
  </div>`;
}

function optionList(q: QuestionSlide): string {
  if (q.qtype === 'scale') {
    return `<div class="q-scale">
      ${[1, 2, 3, 4, 5].map(v => `<span class="q-scale-n">${v}</span>`).join('')}
    </div>
    <div class="q-scale-ends"><span>1 = ${esc(q.scale?.min)}</span><span>5 = ${esc(q.scale?.max)}</span></div>`;
  }
  if (q.qtype === 'wordcloud') return q.hint ? `<p class="q-hint">${rich(q.hint)}</p>` : '';
  const items = (q.options || [])
    .map(o => {
      const mark = q.ladder
        ? `<span class="badge${o.id === 'nikde' ? ' wide' : ''}">${o.id === 'nikde' ? '–' : esc(o.id)}</span>`
        : `<span class="dash"></span>`;
      return `<li>${mark}<span>${rich(o.label)}</span></li>`;
    })
    .join('');
  return `<ul class="q-opts${(q.options || []).length > 5 ? ' dense' : ''}">${items}</ul>${q.hint ? `<p class="q-hint">${rich(q.hint)}</p>` : ''}`;
}

function questionHead(q: QuestionSlide, small = false): string {
  return `${q.kicker ? `<p class="kicker">${rich(q.kicker)}</p>` : ''}
    ${q.scenario ? `<p class="scenario${small ? ' small' : ''}">${rich(q.scenario)}</p>` : ''}
    <h2 class="q-text${small ? ' small' : ''}${q.text.length > 80 ? ' long' : ''}">${rich(q.text)}</h2>`;
}

function hiddenResults(qid: string, ctx: RenderCtx): string {
  return `<div class="results-wait"><span class="big-count">${ctx.counts[qid] || 0}</span><span>${(ctx.counts[qid] || 0) === 1 ? 'hlas' : 'hlasů'}, výsledky za chvíli</span></div>`;
}

export function renderSlide(s: Slide | undefined, ctx: RenderCtx): string {
  if (!s) return '<div class="slide"></div>';
  const body = renderBody(s, ctx);
  return `<div class="slide t-${s.type}" data-k="slide${ctx.index}">${body}${s.type === 'title' ? '' : footer(s, ctx)}</div>`;
}

function renderBody(s: Slide, ctx: RenderCtx): string {
  switch (s.type) {
    case 'title':
      return `<div class="title-wrap">
        <div class="accent-bar"></div>
        <h1>${rich(s.title)}</h1>
        ${s.subtitle ? `<p class="subtitle">${rich(s.subtitle)}</p>` : ''}
        ${s.small ? `<p class="small">${rich(s.small)}</p>` : ''}
      </div>`;

    case 'big-number':
      return `<div class="bn-wrap">
        ${s.kicker ? `<p class="kicker">${rich(s.kicker)}</p>` : ''}
        <div class="bn-num">${esc(s.number)}</div>
        ${s.line ? `<p class="bn-line">${rich(s.line)}</p>` : ''}
        ${s.small ? `<p class="bn-small">${rich(s.small)}</p>` : ''}
      </div>`;

    case 'list': {
      const longest = Math.max(...s.blocks.map(b => b.items.length));
      const blocks = s.blocks
        .map(
          b => `<div class="block">
            ${b.heading ? `<h3>${rich(b.heading)}</h3>` : ''}
            <${s.numbered ? 'ol' : 'ul'} class="items">${b.items.map(i => `<li>${rich(i)}</li>`).join('')}</${s.numbered ? 'ol' : 'ul'}>
          </div>`,
        )
        .join('');
      const cls = [s.blocks.length > 1 ? 'two' : 'one', s.blocks.length > 1 && longest > 4 ? 'dense' : '', s.numbered ? 'numbered' : '']
        .filter(Boolean)
        .join(' ');
      return `<h2 class="title">${rich(s.title)}</h2><div class="blocks ${cls}">${blocks}</div>`;
    }

    case 'text':
      return `<div class="text-wrap${s.text ? '' : ' only-title'}">
        ${s.kicker ? `<p class="kicker">${rich(s.kicker)}</p>` : ''}
        <h2 class="title">${rich(s.title)}</h2>
        ${s.text ? `<p class="lead">${rich(s.text)}</p>` : ''}
      </div>`;

    case 'qr':
      return `<div class="qr-wrap">
        <div class="qr-text">
          <h2 class="title">${rich(s.title)}</h2>
          ${s.text ? `<p class="lead">${rich(s.text)}</p>` : ''}
          <p class="qr-url">${esc(prettyUrl(ctx.audienceUrl))}</p>
        </div>
        <div class="qr-big">${qrSvg(ctx.audienceUrl)}</div>
      </div>`;

    case 'question': {
      const qid = s.question_id;
      const showing = ctx.state.show_results && ctx.state.active_question === qid;
      if (showing) {
        return `<div class="results-wrap">${questionHead(s, true)}<div class="chart">${chartFor(s, ctx.results[qid] ?? null, [88, 32])}</div></div>`;
      }
      const open = ctx.state.voting_open && ctx.state.active_question === qid;
      return `<div class="q-wrap">
        <div class="q-main">${questionHead(s)}${optionList(s)}</div>
        <div class="q-side">
          ${join(ctx)}
          <div class="counter${open ? ' open' : ''}"><span class="big-count">${ctx.counts[qid] || 0}</span><span>${open ? votesLabel(ctx.counts[qid] || 0).replace(/^\d+ /, '') : 'hlasování zavřené'}</span></div>
        </div>
      </div>`;
    }

    case 'results': {
      const q = questions.get(s.question_id);
      if (!q) return `<h2 class="title">Neznámá otázka ${esc(s.question_id)}</h2>`;
      const showing = ctx.state.show_results;
      return `<div class="results-wrap">${questionHead(q, true)}<div class="chart">${
        showing ? chartFor(q, ctx.results[q.question_id] ?? null, [88, 33]) : hiddenResults(q.question_id, ctx)
      }</div></div>`;
    }

    case 'compare': {
      const [a, b] = s.question_ids.map(id => questions.get(id));
      if (!a || !b) return '<h2 class="title">Chybí otázka pro srovnání</h2>';
      const ra = ctx.results[a.question_id] ?? null;
      const rb = ctx.results[b.question_id] ?? null;
      const sa = scaleStats(ra);
      const sb = scaleStats(rb);
      const shift =
        sa.avg !== null && sb.avg !== null
          ? `<p class="shift">Posun průměru: <b>${sb.avg - sa.avg >= 0 ? '+' : '−'}${fmtNum(Math.abs(sb.avg - sa.avg))}</b></p>`
          : '';
      const col = (q: QuestionSlide, r: Results | null, label: string) =>
        `<div class="cmp-col"><h3>${esc(label)}</h3>${
          ctx.state.show_results ? scaleChart(q, r, { compact: true }) : hiddenResults(q.question_id, ctx)
        }</div>`;
      return `<h2 class="title small">${rich(s.title || a.text)}</h2>
        <p class="cmp-q">${rich(a.text)}</p>
        <div class="cmp">${col(a, ra, s.labels?.[0] || 'Na začátku')}${col(b, rb, s.labels?.[1] || 'Na konci')}</div>
        ${ctx.state.show_results ? shift : ''}`;
    }
  }
}
