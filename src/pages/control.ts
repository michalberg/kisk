import '../styles/base.css';
import '../styles/slides.css';
import '../styles/control.css';
import { backend, withDemo } from '../lib/backend';
import { chartFor } from '../lib/charts';
import { audienceUrl, prettyUrl, questionDefs, questions, resultIds, slides, stateForSlide } from '../lib/deck';
import { morph } from '../lib/morph';
import { isProfane } from '../lib/profanity';
import { renderSlide, type RenderCtx } from '../lib/render';
import { createStore, type Store } from '../lib/store';
import type { State } from '../lib/types';
import { esc, plain, storageGet, storageSet, votesLabel } from '../lib/util';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const secret = params.get('key') || '';
const url = audienceUrl();

// ---------------------------------------------------------------------------
// Key check
// ---------------------------------------------------------------------------

function gate(error?: string) {
  app.innerHTML = `<form class="gate">
    <h1>Ovladač prezentace</h1>
    <p class="small-print">Zadejte tajný klíč. Uloží se jen do adresy této stránky.${backend.demo ? ' V ukázkovém režimu je klíč <code>demo</code>.' : ''}</p>
    <input name="key" type="password" autocomplete="off" autofocus>
    ${error ? `<p class="err">${esc(error)}</p>` : ''}
    <button class="btn primary">Pokračovat</button>
  </form>`;
  app.querySelector('form')!.addEventListener('submit', e => {
    e.preventDefault();
    const k = (app.querySelector('input') as HTMLInputElement).value.trim();
    if (!k) return;
    const u = new URL(location.href);
    u.searchParams.set('key', k);
    location.href = u.href;
  });
}

async function boot() {
  if (!secret) return gate();
  app.innerHTML = '<p class="gate">Ověřuji klíč…</p>';
  try {
    if (!(await backend.verifySecret(secret))) return gate('Neplatný klíč.');
    await backend.syncQuestions(secret, questionDefs());
  } catch (e) {
    return gate(`Nepodařilo se spojit se serverem (${(e as Error).message}). Zkuste obnovit stránku.`);
  }
  start();
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

let store: ReturnType<typeof createStore>;
let desired: State | null = null; // latest state we want on the server
let sending = false;
let dirty = false; // desired not yet confirmed

function start() {
  app.innerHTML = `
    <header class="ctl-top">
      <span class="pos" id="pos"></span>
      <span class="sec" id="sec"></span>
      <span class="dot" id="conn"></span>
      <span class="clock" id="clock"></span>
      <span class="elapsed"><span id="elapsed">0:00:00</span><button id="timer-btn" type="button"></button></span>
      <a href="${esc(withDemo(new URL('../screen/', location.href).href))}" target="_blank" rel="noopener">Otevřít plátno</a>
      <a href="${esc(withDemo(url))}" target="_blank" rel="noopener">Publikum</a>
    </header>
    <div class="ctl-grid">
      <div>
        <section class="panel">
          <h2>Na plátně</h2>
          <div class="preview"><div class="stage" id="cur"></div></div>
          <div class="btns">
            <button class="btn big" id="prev" type="button"><kbd>←</kbd> Předchozí</button>
            <button class="btn big primary" id="next" type="button">Další <kbd>→</kbd></button>
          </div>
          <div class="btns">
            <button class="btn" id="b-open" type="button"></button>
            <button class="btn" id="b-results" type="button"></button>
            <button class="btn" id="b-black" type="button"></button>
          </div>
        </section>
        <section class="panel">
          <h2>Poznámky</h2>
          <div class="notes" id="notes"></div>
        </section>
      </div>
      <div>
        <section class="panel">
          <h2>Další slide</h2>
          <div class="preview"><div class="stage" id="nxt"></div></div>
        </section>
        <section class="panel qbox" id="qbox"></section>
        <section class="panel">
          <h2>Přejít na slide</h2>
          <select id="jump">${slides
            .map((s, i) => `<option value="${i}">${i + 1}. ${esc(slideLabel(i))}</option>`)
            .join('')}</select>
        </section>
        <section class="panel">
          <h2>Data</h2>
          <div class="btns" style="margin-top:0">
            <button class="btn" id="export" type="button">Export CSV</button>
            <button class="btn danger" id="reset-all" type="button">Vymazat všechny hlasy</button>
          </div>
          <p class="small-print">Publikum: <b>${esc(prettyUrl(url))}</b>${backend.demo ? '<br>Ukázkový režim: data jsou jen v tomto prohlížeči.' : ''}<br>
          Klávesy: → nebo mezerník další, ← předchozí, R výsledky, O hlasování, B začernit.</p>
        </section>
      </div>
    </div>`;

  store = createStore({
    fetchResults: qid => backend.getResultsAdmin(secret, qid),
    extraIds: s => [...resultIds(slides[s.slide_index + 1]), ...(s.active_question ? [s.active_question] : [])],
    acceptState: () => !dirty,
    onChange: draw,
  });

  document.fonts?.ready.then(() => draw(store.st));
  bind();
  tick();
  setInterval(tick, 1000);
}

function slideLabel(i: number): string {
  const s = slides[i];
  switch (s.type) {
    case 'question':
      return `Otázka ${s.question_id.slice(1)}: ${plain(s.text)}`;
    case 'results':
      return `Výsledky ${s.question_id.slice(1)}`;
    case 'compare':
      return `Srovnání ${s.question_ids.map(q => q.slice(1)).join(' a ')}`;
    case 'big-number':
      return `${s.number} ${s.line || ''}`;
    case 'qr':
      return `QR: ${s.title}`;
    default:
      return plain(s.title);
  }
}

function ctxFor(st: Store, state: State, index: number): RenderCtx {
  return { state, counts: st.counts, results: st.results, audienceUrl: url, index, total: slides.length };
}

function notesHtml(text: string | undefined): string {
  if (!text) return '';
  return esc(text).replace(/\[([^\]]+)\]/g, '<mark>[$1]</mark>');
}

function draw(st: Store) {
  const s = st.state;
  if (!s) return;
  const i = s.slide_index;
  const slide = slides[i];
  const $ = (id: string) => document.getElementById(id)!;

  $('pos').textContent = `${i + 1} / ${slides.length}`;
  $('sec').textContent = slide?.section || '';
  $('conn').className = `dot${st.connected ? '' : ' off'}`;
  $('conn').textContent = st.connected ? 'živě' : 'záložní dotazování';

  const cur = $('cur');
  morph(cur, renderSlide(slide, ctxFor(st, s, i)) + '<div class="blackout"></div>');
  cur.classList.toggle('is-black', s.blackout);

  const nxt = $('nxt');
  if (slides[i + 1]) morph(nxt, renderSlide(slides[i + 1], ctxFor(st, stateForSlide(i + 1), i + 1)));
  else nxt.innerHTML = '<div class="slide" style="justify-content:center;align-items:center;font-size:3cqw;color:var(--muted)">Konec prezentace</div>';

  const notes = $('notes');
  const nh = notesHtml(slide?.notes);
  notes.className = `notes${nh ? '' : ' empty'}`;
  if (notes.innerHTML !== (nh || 'Bez poznámek')) notes.innerHTML = nh || 'Bez poznámek';

  ($('prev') as HTMLButtonElement).disabled = i <= 0;
  ($('next') as HTMLButtonElement).disabled = i >= slides.length - 1;
  const bOpen = $('b-open') as HTMLButtonElement;
  bOpen.disabled = !s.active_question;
  bOpen.className = `btn${s.voting_open ? ' on' : ''}`;
  bOpen.innerHTML = `${s.voting_open ? 'Zavřít hlasování' : 'Otevřít hlasování'} <kbd>O</kbd>`;
  const bRes = $('b-results') as HTMLButtonElement;
  bRes.className = `btn${s.show_results ? ' on' : ''}`;
  bRes.disabled = !s.active_question;
  bRes.innerHTML = `${s.show_results ? 'Skrýt výsledky' : 'Odkrýt výsledky'} <kbd>R</kbd>`;
  const bBlack = $('b-black') as HTMLButtonElement;
  bBlack.className = `btn${s.blackout ? ' on' : ''}`;
  bBlack.innerHTML = `${s.blackout ? 'Zrušit začernění' : 'Začernit plátno'} <kbd>B</kbd>`;

  const jump = $('jump') as HTMLSelectElement;
  if (document.activeElement !== jump) jump.value = String(i);

  drawQuestion(st, s);
}

function drawQuestion(st: Store, s: State) {
  const box = document.getElementById('qbox')!;
  const qid = s.active_question;
  const q = qid ? questions.get(qid) : undefined;
  if (!q || !qid) {
    box.innerHTML = '<h2>Otázka</h2><p class="small-print">Na tomto slidu není aktivní otázka.</p>';
    return;
  }
  const r = st.results[qid] ?? null;
  let words = '';
  if (q.qtype === 'wordcloud' && r) {
    const hidden = new Set(r.hidden || []);
    const all = [...Object.entries(r.counts), ...[...hidden].map(w => [w, 0] as [string, number])].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs'),
    );
    words = `<p class="small-print">Kliknutím slovo skryjete nebo vrátíte. Přeškrtnutá slova se na plátně nezobrazí.</p>
      <div class="words">${all
        .map(([w, n]) => {
          const prof = isProfane(w);
          const cls = prof ? 'profane' : hidden.has(w) ? 'hidden' : '';
          return `<button type="button" class="word ${cls}" data-word="${esc(w)}" data-hidden="${hidden.has(w)}" ${
            prof ? 'disabled title="Skryto filtrem vulgarismů"' : ''
          }>${esc(w)}${n ? `<small>${n}</small>` : ''}</button>`;
        })
        .join('')}</div>`;
  }
  const html = `<h2>Otázka ${esc(qid.slice(1))} · průběžné výsledky jen pro vás</h2>
    <div class="qtext">${esc(q.text)}</div>
    <div class="stats"><span class="n">${st.counts[qid] || 0}</span>
      <span>${esc(votesLabel(st.counts[qid] || 0).replace(/^\d+ /, ''))}</span>
      <span class="pill ${s.voting_open ? 'ok' : ''}">${s.voting_open ? 'hlasování otevřené' : 'hlasování zavřené'}</span>
      <span class="pill ${s.show_results ? 'warn' : ''}">${s.show_results ? 'výsledky na plátně' : 'výsledky skryté'}</span>
    </div>
    <div class="mini-chart"><div class="stage"><div class="slide">${chartFor(q, r, [80, 26])}</div></div></div>
    ${words}
    <div class="btns"><button class="btn danger" type="button" id="reset-q">Vymazat hlasy této otázky</button></div>`;
  morph(box, html);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function current(): State | null {
  return desired && dirty ? desired : store.st.state;
}

function push(s: State) {
  desired = s;
  dirty = true;
  store.setLocal(s);
  send();
}

async function send() {
  if (sending || !desired) return;
  sending = true;
  const target = desired;
  try {
    await backend.setState(secret, target);
    if (desired === target) dirty = false;
  } catch (e) {
    toast(`Nepodařilo se uložit stav: ${(e as Error).message}. Zkouším znovu…`);
    setTimeout(() => {
      sending = false;
      send();
    }, 1500);
    return;
  }
  sending = false;
  if (dirty) send();
}

function go(i: number) {
  const s = current();
  if (!s || i < 0 || i >= slides.length) return;
  if (i > 0 && !storageGet('kisk-talk-start')) startTimer();
  push(stateForSlide(i, s.blackout));
}

function toggle(field: 'voting_open' | 'show_results' | 'blackout') {
  const s = current();
  if (!s) return;
  if (field !== 'blackout' && !s.active_question) return;
  const next = { ...s, [field]: !s[field] };
  // revealing results ends the vote (dilemma slides show results in place)
  if (field === 'show_results' && next.show_results) next.voting_open = false;
  push(next);
}

function bind() {
  const on = (id: string, fn: () => void) => document.getElementById(id)!.addEventListener('click', fn);
  on('prev', () => go((current()?.slide_index ?? 0) - 1));
  on('next', () => go((current()?.slide_index ?? 0) + 1));
  on('b-open', () => toggle('voting_open'));
  on('b-results', () => toggle('show_results'));
  on('b-black', () => toggle('blackout'));
  on('timer-btn', () => (storageGet('kisk-talk-start') ? confirmModal('Vynulovat uplynulý čas?', 'Vynulovat', startTimer) : startTimer()));
  on('export', exportCsv);
  on('reset-all', () =>
    confirmModal('Opravdu vymazat všechny hlasy u všech otázek? Tohle nejde vrátit.', 'Vymazat vše', async () => {
      await backend.resetVotes(secret, null);
      reloadAll();
      toast('Všechny hlasy vymazány.', true);
    }),
  );
  document.getElementById('jump')!.addEventListener('change', e => go(Number((e.target as HTMLSelectElement).value)));
  document.getElementById('qbox')!.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    const qid = current()?.active_question;
    if (!qid) return;
    const word = t.closest<HTMLButtonElement>('.word');
    if (word && !word.disabled) {
      await backend.setWordHidden(secret, qid, word.dataset.word!, word.dataset.hidden !== 'true');
      store.reload(qid);
    }
    if (t.id === 'reset-q') {
      confirmModal(`Vymazat všechny hlasy u otázky ${qid.slice(1)}?`, 'Vymazat', async () => {
        await backend.resetVotes(secret, qid);
        store.reload(qid);
        toast('Hlasy otázky vymazány.', true);
      });
    }
  });

  document.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (document.querySelector('.modal-back')) return;
    const i = current()?.slide_index ?? 0;
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        go(i + 1);
        break;
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        go(i - 1);
        break;
      case 'r':
      case 'R':
        toggle('show_results');
        break;
      case 'o':
      case 'O':
        toggle('voting_open');
        break;
      case 'b':
      case 'B':
      case '.': // presentation clickers send "." for black screen
        toggle('blackout');
        break;
    }
  });
}

function reloadAll() {
  for (const q of questions.keys()) store.reload(q);
}

// ---------------------------------------------------------------------------
// Clock and elapsed time (kept in localStorage so a reload keeps counting)
// ---------------------------------------------------------------------------

function startTimer() {
  storageSet('kisk-talk-start', String(Date.now()));
  tick();
}

function tick() {
  const now = new Date();
  const clock = document.getElementById('clock');
  if (!clock) return;
  clock.textContent = now.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  const startMs = Number(storageGet('kisk-talk-start') || 0);
  const el = document.getElementById('elapsed')!;
  const btn = document.getElementById('timer-btn')!;
  if (!startMs) {
    el.textContent = '0:00:00';
    btn.textContent = 'Start';
    return;
  }
  btn.textContent = 'Reset';
  const sec = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  el.textContent = `${h}:${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

async function exportCsv() {
  try {
    const rows = await backend.exportVotes(secret);
    const label = (qid: string, id: unknown) =>
      questions.get(qid)?.options?.find(o => o.id === String(id))?.label ?? String(id);
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['otazka', 'text_otazky', 'hlasujici', 'odpoved', 'odpoved_text', 'cas'].join(';')];
    for (const r of rows) {
      const a = r.answer;
      const ids = Array.isArray(a) ? a : [a];
      lines.push(
        [
          r.question_id,
          questions.get(r.question_id)?.text,
          r.voter,
          ids.join(' | '),
          ids.map(x => label(r.question_id, x)).join(' | '),
          r.created_at,
        ]
          .map(cell)
          .join(';'),
      );
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `hlasovani-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (e) {
    toast(`Export se nepovedl: ${(e as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Small UI helpers (no browser dialogs, they block the page)
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, info = false) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast${info ? ' info' : ''}`;
  t.textContent = msg;
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 3500);
}

function confirmModal(text: string, ok: string, action: () => void | Promise<void>) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><p>${esc(text)}</p>
    <div class="btns"><button class="btn danger solid" data-ok>${esc(ok)}</button><button class="btn" data-cancel>Zrušit</button></div></div>`;
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('click', async e => {
    const t = e.target as HTMLElement;
    if (t === back || t.hasAttribute('data-cancel')) close();
    if (t.hasAttribute('data-ok')) {
      close();
      try {
        await action();
      } catch (err) {
        toast((err as Error).message);
      }
    }
  });
  document.body.append(back);
  back.querySelector<HTMLButtonElement>('[data-cancel]')!.focus();
}

boot();
