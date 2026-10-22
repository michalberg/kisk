import { backend } from './backend';
import { resultIds, slides } from './deck';
import type { Results, State } from './types';

export interface Store {
  state: State | null;
  counts: Record<string, number>;
  results: Record<string, Results | null>;
  connected: boolean;
}

/**
 * Live presentation state for the screen and the controller: state row, vote
 * counts and results for the questions the current (and next) slide needs.
 * `fetchResults` decides where results come from (public or admin).
 */
export function createStore(opts: {
  fetchResults: (qid: string) => Promise<Results | null>;
  /** extra question ids to keep fresh (e.g. the controller's next slide) */
  extraIds?: (s: State) => string[];
  /** return false to ignore a state coming from the server (controller with unsent changes) */
  acceptState?: (s: State) => boolean;
  onChange: (st: Store) => void;
}) {
  const st: Store = { state: null, counts: {}, results: {}, connected: false };
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let lastStateKey = '';

  const wanted = (): string[] => {
    if (!st.state) return [];
    const ids = new Set(resultIds(slides[st.state.slide_index]));
    for (const id of opts.extraIds?.(st.state) || []) ids.add(id);
    return [...ids];
  };

  const load = (qid: string, delay = 0) => {
    clearTimeout(timers.get(qid));
    timers.set(
      qid,
      setTimeout(async () => {
        try {
          st.results[qid] = await opts.fetchResults(qid);
          opts.onChange(st);
        } catch {
          /* keep the last results; next change retries */
        }
      }, delay),
    );
  };

  const stop = backend.live(
    {
      onState(s) {
        if (opts.acceptState && !opts.acceptState(s)) return;
        const key = JSON.stringify([s.slide_index, s.active_question, s.voting_open, s.show_results, s.blackout]);
        st.state = s;
        if (key !== lastStateKey) {
          lastStateKey = key;
          for (const id of wanted()) load(id);
          opts.onChange(st);
        }
      },
      onCount(qid, n) {
        const changed = st.counts[qid] !== n;
        st.counts[qid] = n;
        // results may change even when the count does not (changed vote, hidden word)
        if (wanted().includes(qid)) load(qid, 250);
        if (changed) opts.onChange(st);
      },
      onStatus(c) {
        st.connected = c;
        opts.onChange(st);
      },
    },
    { counts: true },
  );

  return {
    st,
    stop,
    /** apply a state locally right away (controller, before the server confirms) */
    setLocal(s: State) {
      st.state = s;
      lastStateKey = JSON.stringify([s.slide_index, s.active_question, s.voting_open, s.show_results, s.blackout]);
      for (const id of wanted()) load(id, 150);
      opts.onChange(st);
    },
    reload(qid: string) {
      load(qid);
    },
  };
}
