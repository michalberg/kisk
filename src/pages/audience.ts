import '../styles/base.css';
import '../styles/audience.css';
import { backend, ServerError } from '../lib/backend';
import { questions, slides } from '../lib/deck';
import { deviceId } from '../lib/device';
import type { Answer, QuestionSlide, State } from '../lib/types';
import { esc, rich, storageGet, storageSet } from '../lib/util';

const app = document.getElementById('app')!;
const conn = document.getElementById('conn')!;
const me = deviceId();

let state: State | null = null;
let shownQid: string | null = null; // question whose form is on screen
let draft: Answer | null = null;
let pending: { qid: string; answer: Answer } | null = null;
let status: 'idle' | 'sending' | 'sent' | 'queued' | 'closed' | 'invalid' = 'idle';
let retryTimer: ReturnType<typeof setInterval> | undefined;

const sentKey = (qid: string) => `kisk-vote-${qid}`;
function sentAnswer(qid: string): Answer | null {
  try {
    return JSON.parse(storageGet(sentKey(qid)) || 'null');
  } catch {
    return null;
  }
}
const sentMemory = new Map<string, Answer>();
function getSent(qid: string): Answer | null {
  return sentMemory.get(qid) ?? sentAnswer(qid);
}
function setSent(qid: string, a: Answer) {
  sentMemory.set(qid, a);
  storageSet(sentKey(qid), JSON.stringify(a));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render() {
  const open = state?.voting_open && state.active_question ? questions.get(state.active_question) : undefined;
  if (!open) {
    shownQid = null;
    const section = state ? slides[state.slide_index]?.section : undefined;
    const closedMsg =
      status === 'closed' ? `<p class="aud-note">Hlasování se uzavřelo dřív, než se hlas stihl odeslat.</p>` : '';
    app.innerHTML = `<div class="aud-wait">
      <div class="pulse"></div>
      <p class="aud-wait-title">Počkejte na další otázku</p>
      ${section ? `<span class="aud-section">${esc(section)}</span>` : ''}
      ${closedMsg}
      <p class="aud-note">Stránku nechte otevřenou. Jakmile se otevře hlasování, otázka se tu objeví sama.</p>
    </div>`;
    return;
  }
  if (shownQid !== open.question_id) {
    shownQid = open.question_id;
    const prev = getSent(open.question_id);
    draft = prev;
    if (status !== 'queued' || pending?.qid !== open.question_id) status = prev ? 'sent' : 'idle';
    app.innerHTML = formHtml(open);
    bindForm(open);
  }
  updateFormState(open);
}

function formHtml(q: QuestionSlide): string {
  let body = '';
  if (q.qtype === 'scale') {
    body = `<div class="scale" role="radiogroup" aria-label="Škála 1 až 5">${[1, 2, 3, 4, 5]
      .map(v => `<button type="button" class="opt" data-v="${v}" aria-pressed="false">${v}</button>`)
      .join('')}</div>
      <div class="scale-ends"><span>1 = ${esc(q.scale?.min)}</span><span>5 = ${esc(q.scale?.max)}</span></div>`;
  } else if (q.qtype === 'single' || q.qtype === 'multi') {
    const multi = q.qtype === 'multi';
    body = (q.options || [])
      .map(o => {
        const mark = q.ladder && o.id !== 'nikde' ? `<span class="letter">${esc(o.id)}</span>` : `<span class="mark"></span>`;
        return `<button type="button" class="opt${multi ? ' check' : ''}" data-v="${esc(o.id)}" ${
          multi ? 'role="checkbox" aria-checked="false"' : 'aria-pressed="false"'
        }>${mark}<span>${rich(o.label)}</span></button>`;
      })
      .join('');
  } else {
    body = `<div class="words">${[0, 1, 2]
      .map(
        i =>
          `<input type="text" maxlength="25" autocomplete="off" autocapitalize="none" enterkeyhint="${i < 2 ? 'next' : 'send'}" aria-label="Slovo ${i + 1}" placeholder="${i === 0 ? 'Slovo nebo dvě' : 'Další (nepovinné)'}">`,
      )
      .join('')}</div>`;
  }
  return `${q.scenario ? `<p class="aud-scenario">${rich(q.scenario)}</p>` : ''}
    <h1 class="aud-q">${rich(q.text)}</h1>
    ${q.hint ? `<p class="aud-hint">${rich(q.hint)}</p>` : q.qtype === 'wordcloud' ? '<p class="aud-hint">Až tři odpovědi, každá nejvýš 25 znaků.</p>' : ''}
    <form class="aud-form" novalidate>
      ${body}
      <button type="submit" class="send">Odeslat</button>
      <div class="status" aria-live="polite"></div>
    </form>`;
}

function bindForm(q: QuestionSlide) {
  const form = app.querySelector('form')!;
  if (q.qtype === 'wordcloud') {
    const inputs = [...form.querySelectorAll('input')];
    if (Array.isArray(draft)) draft.forEach((w, i) => inputs[i] && (inputs[i].value = String(w)));
    form.addEventListener('input', () => {
      draft = inputs.map(i => i.value.trim()).filter(Boolean);
      updateFormState(q);
    });
  } else {
    form.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.opt');
      if (!btn) return;
      const v = btn.dataset.v!;
      if (q.qtype === 'scale') draft = Number(v);
      else if (q.qtype === 'single') draft = v;
      else {
        const cur = new Set(Array.isArray(draft) ? draft : []);
        if (cur.has(v)) cur.delete(v);
        else cur.add(v);
        draft = (q.options || []).map(o => o.id).filter(id => cur.has(id));
      }
      updateFormState(q);
    });
  }
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!valid(q, draft)) return;
    (document.activeElement as HTMLElement | null)?.blur();
    submit(q.question_id, draft!);
  });
}

function valid(q: QuestionSlide, a: Answer | null): boolean {
  if (a === null) return false;
  if (q.qtype === 'multi' || q.qtype === 'wordcloud') return Array.isArray(a) && a.length > 0;
  return true;
}

function same(a: Answer | null, b: Answer | null) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function updateFormState(q: QuestionSlide) {
  const form = app.querySelector('form');
  if (!form) return;
  for (const btn of form.querySelectorAll<HTMLButtonElement>('.opt')) {
    const v = btn.dataset.v!;
    const on = Array.isArray(draft) ? draft.includes(v) : String(draft) === v;
    btn.setAttribute(btn.getAttribute('role') === 'checkbox' ? 'aria-checked' : 'aria-pressed', String(on));
  }
  const sent = getSent(q.question_id);
  const send = form.querySelector<HTMLButtonElement>('.send')!;
  const changed = !same(draft, sent);
  send.disabled = !valid(q, draft) || status === 'sending' || (!changed && status === 'sent');
  send.classList.toggle('sending', status === 'sending');
  send.textContent = status === 'sending' ? 'Odesílám…' : sent ? 'Změnit hlas' : 'Odeslat';

  const box = form.querySelector('.status')!;
  const msg =
    status === 'sent' && !changed
      ? `<div class="done"><b>Hlas odeslán, můžete ho změnit</b>Stačí vybrat jinou odpověď a odeslat znovu, dokud je hlasování otevřené.</div>`
      : status === 'queued'
        ? `<div class="done pending"><b>Čekám na spojení</b>Hlas odešleme automaticky, jakmile se spojení obnoví.</div>`
        : status === 'invalid'
          ? `<div class="done error"><b>Hlas se nepodařilo uložit</b>Zkontrolujte odpověď a zkuste to znovu.</div>`
          : '';
  if (box.innerHTML !== msg) box.innerHTML = msg;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

async function submit(qid: string, answer: Answer) {
  pending = { qid, answer };
  status = 'sending';
  render();
  await flush();
}

async function flush() {
  if (!pending) return;
  const { qid, answer } = pending;
  try {
    await backend.castVote(qid, me, answer);
    if (pending?.qid === qid && same(pending.answer, answer)) pending = null;
    setSent(qid, answer);
    status = 'sent';
    stopRetry();
  } catch (e) {
    if (e instanceof ServerError) {
      pending = null;
      stopRetry();
      status = e.message === 'voting_closed' ? 'closed' : 'invalid';
    } else {
      status = 'queued';
      startRetry();
    }
  }
  render();
}

function startRetry() {
  conn.hidden = false;
  if (!retryTimer) retryTimer = setInterval(flush, 3000);
}
function stopRetry() {
  if (retryTimer) clearInterval(retryTimer);
  retryTimer = undefined;
  if (connected) conn.hidden = true;
}

// ---------------------------------------------------------------------------
// Live state
// ---------------------------------------------------------------------------

let connected = false;
let connTimer: ReturnType<typeof setTimeout> | undefined;

backend.live({
  onState(s) {
    const prevQ = state?.voting_open ? state.active_question : null;
    state = s;
    const nowQ = s.voting_open ? s.active_question : null;
    if (prevQ !== nowQ && status === 'closed') status = 'idle';
    render();
  },
  onStatus(c) {
    connected = c;
    clearTimeout(connTimer);
    if (c) {
      if (!retryTimer) conn.hidden = true;
      flush();
    } else {
      // short blips are normal (phone waking up); only show after a moment
      connTimer = setTimeout(() => !connected && (conn.hidden = false), 2500);
    }
  },
});

window.addEventListener('online', flush);
