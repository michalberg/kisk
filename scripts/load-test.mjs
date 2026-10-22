// Zátěžový test: 100 současných hlasujících proti skutečnému Supabase.
//   npm run loadtest                 (výchozí: otázka q1, 100 hlasujících)
//   npm run loadtest -- q6 150       (jiná otázka a počet)
// Potřebuje v .env VITE_SUPABASE_URL, VITE_SUPABASE_KEY a CONTROL_SECRET.
// Test na chvíli otevře hlasování u zvolené otázky, na konci její hlasy smaže
// a vrátí stav prezentace, jak byl. NEPOUŠTĚJTE během přednášky.

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const [qid = 'q1', nArg = '100'] = process.argv.slice(2);
const N = Number(nArg);
const { VITE_SUPABASE_URL: url, VITE_SUPABASE_KEY: key, CONTROL_SECRET: secret } = process.env;
if (!url || !key || !secret) {
  console.error('Chybí VITE_SUPABASE_URL, VITE_SUPABASE_KEY nebo CONTROL_SECRET');
  process.exit(1);
}

const deck = JSON.parse(fs.readFileSync(new URL('../src/data/slides.json', import.meta.url), 'utf8'));
const q = deck.slides.find(s => s.type === 'question' && s.question_id === qid);
if (!q) throw new Error(`Otázka ${qid} neexistuje`);

const randomAnswer = () => {
  const pick = a => a[Math.floor(Math.random() * a.length)];
  if (q.qtype === 'scale') return 1 + Math.floor(Math.random() * 5);
  if (q.qtype === 'single') return pick(q.options).id;
  if (q.qtype === 'multi') return q.options.filter(() => Math.random() < 0.4).map(o => o.id).concat(q.options[0].id);
  return [pick(['analýza dat', 'texty', 'videa', 'Grafika ', 'chatbot', 'překlady']), pick(['web', 'emaily'])];
};

const admin = createClient(url, key, { auth: { persistSession: false } });
const call = async (fn, args) => {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
};

const { data: before, error } = await admin.from('state').select('*').eq('id', 1).single();
if (error) throw error;
const restore = () =>
  call('set_state', {
    secret,
    p_slide_index: before.slide_index,
    p_active_question: before.active_question,
    p_voting_open: before.voting_open,
    p_show_results: before.show_results,
    p_blackout: before.blackout,
  });

await call('reset_votes', { secret, p_question_id: qid });
await call('set_state', { secret, p_slide_index: before.slide_index, p_active_question: qid, p_voting_open: true, p_show_results: false, p_blackout: false });

// Realtime observer: how long until the count reaches N?
const watcher = createClient(url, key, { auth: { persistSession: false } });
let seenAt = 0;
let lastN = 0;
const ready = new Promise(res => {
  watcher
    .channel('loadtest')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'vote_counts', filter: `question_id=eq.${qid}` }, p => {
      lastN = p.new.n;
      if (p.new.n >= N && !seenAt) seenAt = Date.now();
    })
    .subscribe(s => s === 'SUBSCRIBED' && res());
});
await ready;

console.log(`Otázka ${qid} (${q.qtype}), ${N} hlasujících, každý hlasuje 1 až 3krát…`);
const voters = Array.from({ length: N }, () => ({
  id: randomUUID(),
  client: createClient(url, key, { auth: { persistSession: false } }),
}));
const latencies = [];
let failed = 0;
const t0 = Date.now();
await Promise.all(
  voters.map(async v => {
    const times = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < times; i++) {
      await new Promise(r => setTimeout(r, Math.random() * 1500));
      const s = Date.now();
      const { error } = await v.client.rpc('cast_vote', { p_question_id: qid, p_device_id: v.id, p_answer: randomAnswer() });
      latencies.push(Date.now() - s);
      if (error) {
        failed++;
        console.error(error.message);
      }
    }
  }),
);
const sentAt = Date.now();
await new Promise(r => setTimeout(r, 3000));

const results = await call('get_results_admin', { secret, p_question_id: qid });
const { data: counts } = await admin.from('vote_counts').select('n').eq('question_id', qid).single();
latencies.sort((a, b) => a - b);
const p = x => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * x))];

console.log(`Požadavků: ${latencies.length}, chyb: ${failed}, za ${((sentAt - t0) / 1000).toFixed(1)} s`);
console.log(`Odezva cast_vote: medián ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${latencies.at(-1)} ms`);
console.log(`Počet hlasů v DB: ${counts.n} (čekáno ${N}), ve výsledcích: ${results.total}`);
console.log(`Realtime počítadlo: ${seenAt ? `dorazilo ${seenAt - sentAt <= 0 ? 'během hlasování' : `${seenAt - sentAt} ms po posledním hlasu`}` : `nedorazilo (poslední hodnota ${lastN})`}`);
console.log('Výsledky:', JSON.stringify(results.counts));

await call('reset_votes', { secret, p_question_id: qid });
await restore();
await watcher.removeAllChannels();
const ok = failed === 0 && counts.n === N && results.total === N && seenAt > 0;
console.log(ok ? 'TEST OK' : 'TEST SELHAL');
process.exit(ok ? 0 : 1);
