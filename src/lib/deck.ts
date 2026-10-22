import data from '../data/slides.json';
import type { Deck, QuestionSlide, Slide, State } from './types';

export const deck = data as Deck;
export const slides: Slide[] = deck.slides;

/** Question slides before the first section divider show the QR code; later ones
 * only the short address (everyone has joined by then). */
export const qrUntil = (() => {
  const i = slides.findIndex(s => s.type === 'section');
  return i < 0 ? slides.length : i;
})();

export const questions = new Map<string, QuestionSlide>();
for (const s of slides) if (s.type === 'question') questions.set(s.question_id, s);

/** Question ids a slide needs results for. */
export function resultIds(s: Slide | undefined): string[] {
  if (!s) return [];
  if (s.type === 'results' || s.type === 'question') return [s.question_id];
  if (s.type === 'compare') return [...s.question_ids];
  return [];
}

/** State the controller sets when it moves to a slide. */
export function stateForSlide(index: number, blackout = false): State {
  const s = slides[index];
  if (s?.type === 'question') {
    return { slide_index: index, active_question: s.question_id, voting_open: true, show_results: false, blackout };
  }
  if (s?.type === 'results') {
    return { slide_index: index, active_question: s.question_id, voting_open: false, show_results: true, blackout };
  }
  if (s?.type === 'compare') {
    return { slide_index: index, active_question: s.question_ids[1], voting_open: false, show_results: true, blackout };
  }
  return { slide_index: index, active_question: null, voting_open: false, show_results: false, blackout };
}

/** Definitions the server needs to validate answers. */
export function questionDefs() {
  return [...questions.values()].map(q => ({
    id: q.question_id,
    qtype: q.qtype,
    options: (q.options || []).map(o => o.id),
  }));
}

/** Audience address: the app root next to /screen/ and /control/. */
export function audienceUrl(): string {
  const env = import.meta.env.VITE_PUBLIC_URL as string | undefined;
  if (env) return env;
  const u = new URL('..', location.href);
  u.search = '';
  u.hash = '';
  return u.href;
}

export function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}
