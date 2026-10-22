import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Answer, QType, Results, State } from './types';

export interface QuestionDef {
  id: string;
  qtype: QType;
  options: string[];
}

export interface VoteRow {
  question_id: string;
  voter: string;
  answer: unknown;
  created_at: string;
}

export interface LiveHandlers {
  onState?: (s: State) => void;
  /** vote count changed (or hidden words changed) for a question */
  onCount?: (questionId: string, n: number) => void;
  /** realtime connection up (true) or down (false); polling runs while down */
  onStatus?: (connected: boolean) => void;
}

export interface Backend {
  readonly demo: boolean;
  getState(): Promise<State>;
  getCounts(): Promise<Record<string, number>>;
  castVote(questionId: string, deviceId: string, answer: Answer): Promise<void>;
  getResults(questionId: string): Promise<Results | null>;
  /** Realtime subscription with polling fallback. Returns unsubscribe. */
  live(h: LiveHandlers, opts?: { counts?: boolean }): () => void;

  verifySecret(secret: string): Promise<boolean>;
  setState(secret: string, s: State): Promise<State>;
  syncQuestions(secret: string, defs: QuestionDef[]): Promise<void>;
  getResultsAdmin(secret: string, questionId: string): Promise<Results | null>;
  setWordHidden(secret: string, questionId: string, word: string, hidden: boolean): Promise<void>;
  resetVotes(secret: string, questionId: string | null): Promise<void>;
  exportVotes(secret: string): Promise<VoteRow[]>;
}

/** Errors the server raises on purpose; anything else is treated as a network problem. */
export class ServerError extends Error {}
const SERVER_CODES = ['voting_closed', 'bad_answer', 'bad_question', 'invalid_secret'];

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) {
    const code = SERVER_CODES.find(c => res.error!.message.includes(c));
    if (code) throw new ServerError(code);
    throw new Error(res.error.message);
  }
  return res.data;
}

const POLL_MS = 3000;

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

class SupabaseBackend implements Backend {
  readonly demo = false;
  private sb: SupabaseClient;

  constructor(url: string, key: string) {
    this.sb = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 50 } },
    });
  }

  async getState() {
    return check(await this.sb.from('state').select('*').eq('id', 1).single()) as State;
  }

  async getCounts() {
    const rows = check(await this.sb.from('vote_counts').select('question_id,n')) as { question_id: string; n: number }[];
    return Object.fromEntries(rows.map(r => [r.question_id, r.n]));
  }

  async castVote(questionId: string, deviceId: string, answer: Answer) {
    check(await this.sb.rpc('cast_vote', { p_question_id: questionId, p_device_id: deviceId, p_answer: answer }));
  }

  async getResults(questionId: string) {
    return check(await this.sb.rpc('get_results', { p_question_id: questionId })) as Results | null;
  }

  live(h: LiveHandlers, opts: { counts?: boolean } = {}) {
    let connected = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let stopped = false;

    const poll = async () => {
      try {
        h.onState?.(await this.getState());
        if (opts.counts && h.onCount) {
          const counts = await this.getCounts();
          for (const [q, n] of Object.entries(counts)) h.onCount(q, n);
        }
      } catch {
        /* still offline */
      }
    };
    const setConnected = (c: boolean) => {
      if (stopped) return;
      if (c !== connected) h.onStatus?.(c);
      connected = c;
      if (c) {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = undefined;
        poll(); // catch up on anything missed while disconnected
      } else if (!pollTimer) {
        pollTimer = setInterval(poll, POLL_MS);
      }
    };

    let ch = this.sb
      .channel('presentation')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'state' }, p => {
        if (p.new && 'slide_index' in p.new) h.onState?.(p.new as State);
      });
    if (opts.counts) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'vote_counts' }, p => {
        const row = p.new as { question_id?: string; n?: number };
        if (row?.question_id) h.onCount?.(row.question_id, row.n ?? 0);
      });
    }
    ch.subscribe(status => setConnected(status === 'SUBSCRIBED'));

    // Start in polling mode until the channel confirms.
    h.onStatus?.(false);
    pollTimer = setInterval(poll, POLL_MS);
    poll();

    const onVisible = () => document.visibilityState === 'visible' && poll();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', poll);

    return () => {
      stopped = true;
      if (pollTimer) clearInterval(pollTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', poll);
      this.sb.removeChannel(ch);
    };
  }

  async verifySecret(secret: string) {
    try {
      return !!check(await this.sb.rpc('verify_secret', { secret }));
    } catch (e) {
      if (e instanceof ServerError) return false;
      throw e;
    }
  }

  async setState(secret: string, s: State) {
    return check(
      await this.sb
        .rpc('set_state', {
          secret,
          p_slide_index: s.slide_index,
          p_active_question: s.active_question,
          p_voting_open: s.voting_open,
          p_show_results: s.show_results,
          p_blackout: s.blackout,
        })
        .single(),
    ) as State;
  }

  async syncQuestions(secret: string, defs: QuestionDef[]) {
    check(await this.sb.rpc('sync_questions', { secret, p_questions: defs }));
  }

  async getResultsAdmin(secret: string, questionId: string) {
    return check(await this.sb.rpc('get_results_admin', { secret, p_question_id: questionId })) as Results | null;
  }

  async setWordHidden(secret: string, questionId: string, word: string, hidden: boolean) {
    check(await this.sb.rpc('set_word_hidden', { secret, p_question_id: questionId, p_word: word, p_hidden: hidden }));
  }

  async resetVotes(secret: string, questionId: string | null) {
    check(await this.sb.rpc('reset_votes', { secret, p_question_id: questionId }));
  }

  async exportVotes(secret: string) {
    return check(await this.sb.rpc('export_votes', { secret })) as VoteRow[];
  }
}

// ---------------------------------------------------------------------------
// Demo: everything in localStorage, tabs in one browser stay in sync through
// BroadcastChannel. Secret is "demo". Mirrors the server rules.
// ---------------------------------------------------------------------------

interface MockDb {
  state: State;
  votes: Record<string, Record<string, unknown>>;
  questions: Record<string, QuestionDef & { revealed: boolean }>;
  hidden: Record<string, string[]>;
}

const MOCK_KEY = 'kisk-demo-db';
const norm = (w: string) => w.trim().replace(/\s+/g, ' ').toLowerCase();

class MockBackend implements Backend {
  readonly demo = true;
  private bc = new BroadcastChannel('kisk-demo');

  private load(): MockDb {
    try {
      const raw = localStorage.getItem(MOCK_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      /* fresh db */
    }
    return {
      state: { slide_index: 0, active_question: null, voting_open: false, show_results: false, blackout: false },
      votes: {},
      questions: {},
      hidden: {},
    };
  }
  private save(db: MockDb, touched?: string) {
    try {
      localStorage.setItem(MOCK_KEY, JSON.stringify(db));
    } catch {
      /* ignore */
    }
    this.bc.postMessage({ touched });
  }
  private auth(secret: string) {
    if (secret !== 'demo') throw new ServerError('invalid_secret');
  }
  private results(db: MockDb, qid: string): Results | null {
    const q = db.questions[qid];
    if (!q) return null;
    const votes = Object.values(db.votes[qid] || {});
    const counts: Record<string, number> = {};
    const hidden = db.hidden[qid] || [];
    for (const a of votes) {
      for (const k of Array.isArray(a) ? a : [a]) {
        const key = String(k);
        if (q.qtype === 'wordcloud' && hidden.includes(key)) continue;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return { question_id: qid, qtype: q.qtype, total: votes.length, counts };
  }

  async getState() {
    return this.load().state;
  }
  async getCounts() {
    const db = this.load();
    return Object.fromEntries(Object.entries(db.votes).map(([q, v]) => [q, Object.keys(v).length]));
  }
  async castVote(qid: string, deviceId: string, answer: Answer) {
    const db = this.load();
    if (!db.state.voting_open || db.state.active_question !== qid) throw new ServerError('voting_closed');
    const q = db.questions[qid];
    if (!q) throw new ServerError('bad_question');
    let a: unknown = answer;
    if (q.qtype === 'scale' && ![1, 2, 3, 4, 5].includes(answer as number)) throw new ServerError('bad_answer');
    if (q.qtype === 'single' && !q.options.includes(answer as string)) throw new ServerError('bad_answer');
    if (q.qtype === 'multi') {
      const arr = [...new Set(answer as string[])];
      if (!arr.length || arr.some(x => !q.options.includes(x))) throw new ServerError('bad_answer');
      a = arr;
    }
    if (q.qtype === 'wordcloud') {
      const words = [...new Set((answer as string[]).map(norm).filter(Boolean))];
      if (!words.length || words.length > 3 || words.some(w => w.length > 25)) throw new ServerError('bad_answer');
      a = words;
    }
    (db.votes[qid] ||= {})[deviceId] = a;
    this.save(db, qid);
  }
  async getResults(qid: string) {
    const db = this.load();
    return db.questions[qid]?.revealed ? this.results(db, qid) : null;
  }
  live(h: LiveHandlers, opts: { counts?: boolean } = {}) {
    const push = async (touched?: string) => {
      h.onState?.(await this.getState());
      if (opts.counts && h.onCount) {
        const counts = await this.getCounts();
        if (touched) h.onCount(touched, counts[touched] || 0);
        else for (const [q, n] of Object.entries(counts)) h.onCount(q, n);
      }
    };
    const onMsg = (e: MessageEvent) => push(e.data?.touched);
    this.bc.addEventListener('message', onMsg);
    h.onStatus?.(true);
    push();
    return () => this.bc.removeEventListener('message', onMsg);
  }
  async verifySecret(secret: string) {
    return secret === 'demo';
  }
  async setState(secret: string, s: State) {
    this.auth(secret);
    const db = this.load();
    db.state = { ...s, voting_open: s.voting_open && !!s.active_question, updated_at: new Date().toISOString() };
    if (s.show_results && s.active_question && db.questions[s.active_question]) {
      db.questions[s.active_question].revealed = true;
    }
    this.save(db);
    // let our own tab hear it too, like realtime does
    setTimeout(() => this.bc.dispatchEvent(new MessageEvent('message', { data: {} })), 0);
    return db.state;
  }
  async syncQuestions(secret: string, defs: QuestionDef[]) {
    this.auth(secret);
    const db = this.load();
    for (const d of defs) db.questions[d.id] = { ...d, revealed: db.questions[d.id]?.revealed ?? false };
    this.save(db);
  }
  async getResultsAdmin(secret: string, qid: string) {
    this.auth(secret);
    const db = this.load();
    const r = this.results(db, qid);
    return r && { ...r, hidden: db.hidden[qid] || [] };
  }
  async setWordHidden(secret: string, qid: string, word: string, hidden: boolean) {
    this.auth(secret);
    const db = this.load();
    const set = new Set(db.hidden[qid] || []);
    if (hidden) set.add(norm(word));
    else set.delete(norm(word));
    db.hidden[qid] = [...set];
    this.save(db, qid);
  }
  async resetVotes(secret: string, qid: string | null) {
    this.auth(secret);
    const db = this.load();
    for (const q of qid ? [qid] : Object.keys(db.questions)) {
      delete db.votes[q];
      delete db.hidden[q];
      if (db.questions[q]) db.questions[q].revealed = false;
    }
    this.save(db, qid || undefined);
  }
  async exportVotes(secret: string) {
    this.auth(secret);
    const db = this.load();
    const rows: VoteRow[] = [];
    for (const [q, v] of Object.entries(db.votes)) {
      for (const [d, a] of Object.entries(v)) rows.push({ question_id: q, voter: d.slice(0, 8), answer: a, created_at: '' });
    }
    return rows;
  }
}

// ---------------------------------------------------------------------------

function make(): Backend {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;
  const wantDemo = new URLSearchParams(location.search).has('demo');
  if (wantDemo || !url || !key) return new MockBackend();
  return new SupabaseBackend(url, key);
}

export const backend = make();

/** Keep ?demo when building links between pages. */
export function withDemo(href: string): string {
  if (!backend.demo || !new URLSearchParams(location.search).has('demo')) return href;
  const u = new URL(href, location.href);
  u.searchParams.set('demo', '');
  return u.href.replace('demo=', 'demo');
}
