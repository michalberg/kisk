export type QType = 'scale' | 'single' | 'multi' | 'wordcloud';

export interface Option {
  id: string;
  label: string;
}

interface Base {
  section?: string;
  notes?: string;
}

export interface TitleSlide extends Base {
  type: 'title';
  title: string;
  subtitle?: string;
  small?: string;
}
export interface BigNumberSlide extends Base {
  type: 'big-number';
  kicker?: string;
  number: string;
  line?: string;
  small?: string;
}
export interface ListSlide extends Base {
  type: 'list';
  title: string;
  numbered?: boolean;
  blocks: { heading?: string; items: string[] }[];
}
export interface TextSlide extends Base {
  type: 'text';
  kicker?: string;
  title: string;
  text?: string;
}
export interface QuestionSlide extends Base {
  type: 'question';
  question_id: string;
  qtype: QType;
  kicker?: string;
  scenario?: string;
  text: string;
  hint?: string;
  ladder?: boolean;
  options?: Option[];
  scale?: { min: string; max: string };
}
export interface ResultsSlide extends Base {
  type: 'results';
  question_id: string;
}
export interface CompareSlide extends Base {
  type: 'compare';
  title?: string;
  question_ids: [string, string];
  labels?: [string, string];
}
export interface QrSlide extends Base {
  type: 'qr';
  title: string;
  text?: string;
}

export type Slide =
  | TitleSlide
  | BigNumberSlide
  | ListSlide
  | TextSlide
  | QuestionSlide
  | ResultsSlide
  | CompareSlide
  | QrSlide;

export interface Deck {
  title: string;
  slides: Slide[];
}

export interface State {
  slide_index: number;
  active_question: string | null;
  voting_open: boolean;
  show_results: boolean;
  blackout: boolean;
  updated_at?: string;
}

export interface Results {
  question_id: string;
  qtype: QType;
  total: number;
  counts: Record<string, number>;
  hidden?: string[];
}

/** Answer as sent to the server: scale number, option id, option ids, or words. */
export type Answer = number | string | string[];
