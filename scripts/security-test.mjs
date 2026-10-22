// Ověří pravidla na serveru: publikum nečte hlasy, nemění stav, nehlasuje do zavřené
// otázky a neprojde s nesmyslnou odpovědí. Spouští se: node --env-file=.env scripts/security-test.mjs
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_KEY: key, CONTROL_SECRET: secret } = process.env;
const sb = createClient(url, key, { auth: { persistSession: false } });
let fails = 0;
const expect = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  if (!ok) fails++;
};

const { data: before } = await sb.from('state').select('*').eq('id', 1).single();
const setState = (active, open, show = false) =>
  sb.rpc('set_state', { secret, p_slide_index: before.slide_index, p_active_question: active, p_voting_open: open, p_show_results: show, p_blackout: false });

await sb.rpc('reset_votes', { secret, p_question_id: 'q2' });
await setState('q2', true);
const dev = randomUUID();

let r = await sb.rpc('cast_vote', { p_question_id: 'q2', p_device_id: dev, p_answer: 'b' });
expect('hlas do otevřené otázky', !r.error, r.error?.message);
r = await sb.rpc('cast_vote', { p_question_id: 'q2', p_device_id: dev, p_answer: 'c' });
expect('změna hlasu', !r.error, r.error?.message);
r = await sb.rpc('cast_vote', { p_question_id: 'q2', p_device_id: dev, p_answer: 'zzz' });
expect('neplatná možnost odmítnuta', !!r.error, r.error?.message);
r = await sb.rpc('cast_vote', { p_question_id: 'q3', p_device_id: dev, p_answer: ['ahoj'] });
expect('hlas do neaktivní otázky odmítnut', !!r.error, r.error?.message);

r = await sb.from('votes').select('*');
expect('hlasy nejdou číst', !!r.error || r.data.length === 0, r.error?.message || `${r.data?.length} řádků`);
r = await sb.from('votes').insert({ question_id: 'q2', device_id: randomUUID(), answer: 'a' });
expect('přímý insert do votes odmítnut', !!r.error, r.error?.message);
r = await sb.from('votes').update({ answer: 'a' }).eq('question_id', 'q2').select();
expect('přímý update votes nic nezmění', !!r.error || r.data.length === 0, r.error?.message);
r = await sb.from('state').update({ slide_index: 99 }).eq('id', 1).select();
expect('přímý zápis do state odmítnut', !!r.error || r.data.length === 0, r.error?.message);
r = await sb.rpc('set_state', { secret: 'spatny', p_slide_index: 0, p_active_question: null, p_voting_open: false, p_show_results: false, p_blackout: false });
expect('set_state se špatným klíčem odmítnut', !!r.error, r.error?.message);
r = await sb.rpc('get_results', { p_question_id: 'q2' });
expect('neodkryté výsledky nejsou veřejné', !r.error && r.data === null);
r = await sb.rpc('export_votes', { secret: 'spatny' });
expect('export bez klíče odmítnut', !!r.error);

await setState('q2', false, true);
r = await sb.rpc('get_results', { p_question_id: 'q2' });
expect('odkryté výsledky jsou veřejné (agregované)', r.data?.total === 1 && r.data?.counts?.c === 1, JSON.stringify(r.data));
r = await sb.rpc('cast_vote', { p_question_id: 'q2', p_device_id: dev, p_answer: 'a' });
expect('hlas po zavření odmítnut', !!r.error, r.error?.message);

// word cloud normalisation
await sb.rpc('reset_votes', { secret, p_question_id: 'q3' });
await setState('q3', true);
r = await sb.rpc('cast_vote', { p_question_id: 'q3', p_device_id: dev, p_answer: ['  Analýza   Dat ', 'analýza dat', 'WEB'] });
expect('word cloud hlas', !r.error, r.error?.message);
r = await sb.rpc('cast_vote', { p_question_id: 'q3', p_device_id: randomUUID(), p_answer: ['x'.repeat(26)] });
expect('příliš dlouhé slovo odmítnuto', !!r.error);
r = await sb.rpc('cast_vote', { p_question_id: 'q3', p_device_id: randomUUID(), p_answer: ['a', 'b', 'c', 'd'] });
expect('víc než tři slova odmítnuto', !!r.error);
await sb.rpc('set_word_hidden', { secret, p_question_id: 'q3', p_word: 'WEB', p_hidden: true });
r = await sb.rpc('get_results_admin', { secret, p_question_id: 'q3' });
expect('normalizace a skrytí slova', JSON.stringify(r.data?.counts) === '{"analýza dat":1}' && r.data?.hidden?.[0] === 'web', JSON.stringify(r.data));

await sb.rpc('reset_votes', { secret, p_question_id: 'q2' });
await sb.rpc('reset_votes', { secret, p_question_id: 'q3' });
await sb.rpc('set_state', { secret, p_slide_index: before.slide_index, p_active_question: before.active_question, p_voting_open: before.voting_open, p_show_results: before.show_results, p_blackout: before.blackout });
console.log(fails ? `${fails} testů selhalo` : 'Vše v pořádku');
process.exit(fails ? 1 : 0);
