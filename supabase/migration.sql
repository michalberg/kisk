-- AI ve volebních kampaních: interaktivní prezentace
-- Spusťte celé v Supabase → SQL Editor (nebo psql). Skript je idempotentní.
-- Tajný klíč ovladače nastavte zvlášť (viz README):
--   insert into private.config (id, control_secret) values (1, 'VAS-TAJNY-KLIC')
--   on conflict (id) do update set control_secret = excluded.control_secret;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.config (
  id int primary key default 1 check (id = 1),
  control_secret text not null
);
revoke all on private.config from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Tabulky
-- ---------------------------------------------------------------------------

-- jeden řádek, stav prezentace
create table if not exists public.state (
  id int primary key default 1 check (id = 1),
  slide_index int not null default 0,
  active_question text,            -- id otázky, nebo null
  voting_open boolean not null default false,
  show_results boolean not null default false,
  blackout boolean not null default false,
  updated_at timestamptz default now()
);
insert into public.state (id) values (1) on conflict (id) do nothing;

create table if not exists public.votes (
  id bigint generated always as identity primary key,
  question_id text not null,
  device_id uuid not null,
  answer jsonb not null,           -- číslo, id možnosti, pole id, nebo text
  created_at timestamptz default now(),
  unique (question_id, device_id)
);

-- Definice otázek kvůli kontrole odpovědí na serveru. Plní je ovladač
-- při spuštění funkcí sync_questions() z slides.json.
create table if not exists public.questions (
  id text primary key,
  qtype text not null check (qtype in ('scale', 'single', 'multi', 'wordcloud')),
  options text[] not null default '{}',
  revealed boolean not null default false  -- výsledky už byly odkryty, plátno je smí číst
);

-- Agregovaný počet hlasů, veřejně čitelný a vysílaný přes Realtime.
create table if not exists public.vote_counts (
  question_id text primary key,
  n int not null default 0,
  updated_at timestamptz not null default now()
);

-- Slova z word cloudu skrytá ovladačem.
create table if not exists private.hidden_words (
  question_id text not null,
  word text not null,
  primary key (question_id, word)
);
revoke all on private.hidden_words from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.state enable row level security;
alter table public.votes enable row level security;
alter table public.questions enable row level security;
alter table public.vote_counts enable row level security;

-- Stav a počty hlasů smí číst každý. Zápis jen přes security definer funkce.
drop policy if exists state_read on public.state;
create policy state_read on public.state for select to anon, authenticated using (true);

drop policy if exists vote_counts_read on public.vote_counts;
create policy vote_counts_read on public.vote_counts for select to anon, authenticated using (true);

drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions for select to anon, authenticated using (true);

-- Hlasy: vložit a upravit smí publikum jen u otevřené aktivní otázky. Číst je nesmí nikdo
-- z veřejných rolí (žádná select policy). Frontend hlasuje přes cast_vote(), ale pravidlo
-- platí i pro přímý zápis přes REST.
drop policy if exists votes_insert on public.votes;
create policy votes_insert on public.votes for insert to anon, authenticated
  with check (exists (
    select 1 from public.state s
    where s.id = 1 and s.voting_open and s.active_question = votes.question_id
  ));
drop policy if exists votes_update on public.votes;
create policy votes_update on public.votes for update to anon, authenticated
  using (exists (
    select 1 from public.state s
    where s.id = 1 and s.voting_open and s.active_question = votes.question_id
  ))
  with check (exists (
    select 1 from public.state s
    where s.id = 1 and s.voting_open and s.active_question = votes.question_id
  ));

-- Přímý zápis do tabulky publiku nepovolujeme vůbec: bez znalosti cizího device_id by šlo
-- hromadným UPDATE přepsat všechny hlasy. Hlasuje se jen přes cast_vote(), která navíc
-- kontroluje tvar odpovědi. Policies výše zůstávají jako druhá pojistka.
revoke all on public.votes from anon, authenticated;
revoke insert, update, delete, truncate on public.state, public.questions, public.vote_counts from anon, authenticated;
grant select on public.state, public.questions, public.vote_counts to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Počítání hlasů (trigger)
-- ---------------------------------------------------------------------------

create or replace function private.refresh_count(p_question_id text)
returns void language sql security definer set search_path = '' as $$
  insert into public.vote_counts (question_id, n, updated_at)
  values (p_question_id, (select count(*) from public.votes where question_id = p_question_id), now())
  on conflict (question_id) do update set n = excluded.n, updated_at = excluded.updated_at;
$$;

create or replace function private.votes_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.refresh_count(old.question_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.question_id <> old.question_id) then
    perform private.refresh_count(new.question_id);
  end if;
  return null;
end $$;

drop trigger if exists votes_changed on public.votes;
create trigger votes_changed after insert or update or delete on public.votes
  for each row execute function private.votes_changed();

-- ---------------------------------------------------------------------------
-- Pomocné funkce
-- ---------------------------------------------------------------------------

create or replace function private.check_secret(p_secret text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or not exists (
    select 1 from private.config where id = 1 and control_secret = p_secret
  ) then
    raise exception 'invalid_secret' using errcode = '28000';
  end if;
end $$;

-- Ověření klíče z ovladače (vrací true, nebo vyhodí chybu).
create or replace function public.verify_secret(secret text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(secret);
  return true;
end $$;

-- Normalizace slova z word cloudu: malá písmena, ořezané a sloučené mezery.
create or replace function private.norm_word(w text)
returns text language sql immutable set search_path = '' as $$
  select lower(regexp_replace(btrim(w), '\s+', ' ', 'g'));
$$;

-- Kontrola a normalizace odpovědi podle typu otázky. Vrací normalizovanou odpověď.
create or replace function private.validate_answer(p_qtype text, p_options text[], p_answer jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_num numeric;
  v_arr jsonb;
  v_words text[];
  v_w text;
begin
  if p_qtype = 'scale' then
    if jsonb_typeof(p_answer) <> 'number' then raise exception 'bad_answer'; end if;
    v_num := p_answer::text::numeric;
    if v_num not in (1, 2, 3, 4, 5) then raise exception 'bad_answer'; end if;
    return to_jsonb(v_num::int);

  elsif p_qtype = 'single' then
    if jsonb_typeof(p_answer) <> 'string' or not ((p_answer #>> '{}') = any (p_options)) then
      raise exception 'bad_answer';
    end if;
    return p_answer;

  elsif p_qtype = 'multi' then
    if jsonb_typeof(p_answer) <> 'array' or jsonb_array_length(p_answer) = 0 then
      raise exception 'bad_answer';
    end if;
    select jsonb_agg(distinct e) into v_arr from jsonb_array_elements(p_answer) e;
    if exists (
      select 1 from jsonb_array_elements(v_arr) e
      where jsonb_typeof(e) <> 'string' or not ((e #>> '{}') = any (p_options))
    ) then
      raise exception 'bad_answer';
    end if;
    return v_arr;

  elsif p_qtype = 'wordcloud' then
    if jsonb_typeof(p_answer) = 'string' then p_answer := jsonb_build_array(p_answer); end if;
    if jsonb_typeof(p_answer) <> 'array' then raise exception 'bad_answer'; end if;
    v_words := '{}';
    for v_w in select private.norm_word(e #>> '{}') from jsonb_array_elements(p_answer) e
               where jsonb_typeof(e) = 'string' loop
      if v_w <> '' and not (v_w = any (v_words)) then
        if char_length(v_w) > 25 then raise exception 'bad_answer'; end if;
        v_words := v_words || v_w;
      end if;
    end loop;
    if cardinality(v_words) = 0 or cardinality(v_words) > 3 then raise exception 'bad_answer'; end if;
    return to_jsonb(v_words);
  end if;

  raise exception 'bad_question';
end $$;

-- ---------------------------------------------------------------------------
-- Publikum
-- ---------------------------------------------------------------------------

-- Odeslání nebo změna hlasu. Poslední hlas přepíše předchozí.
create or replace function public.cast_vote(p_question_id text, p_device_id uuid, p_answer jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.questions;
  v_answer jsonb;
begin
  if not exists (
    select 1 from public.state
    where id = 1 and voting_open and active_question = p_question_id
  ) then
    raise exception 'voting_closed';
  end if;

  select * into q from public.questions where id = p_question_id;
  if not found then raise exception 'bad_question'; end if;

  v_answer := private.validate_answer(q.qtype, q.options, p_answer);

  insert into public.votes (question_id, device_id, answer)
  values (p_question_id, p_device_id, v_answer)
  on conflict (question_id, device_id)
  do update set answer = excluded.answer, created_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- Výsledky (jen agregace)
-- ---------------------------------------------------------------------------

create or replace function private.results(p_question_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  q public.questions;
  v_rows jsonb;
  v_total int;
begin
  select * into q from public.questions where id = p_question_id;
  if not found then return null; end if;

  select count(*) into v_total from public.votes where question_id = p_question_id;

  if q.qtype in ('scale', 'single') then
    select coalesce(jsonb_object_agg(k, n), '{}') into v_rows from (
      select answer #>> '{}' as k, count(*) as n
      from public.votes where question_id = p_question_id group by 1
    ) t;
  elsif q.qtype = 'multi' then
    select coalesce(jsonb_object_agg(k, n), '{}') into v_rows from (
      select e #>> '{}' as k, count(*) as n
      from public.votes v, jsonb_array_elements(v.answer) e
      where v.question_id = p_question_id group by 1
    ) t;
  else
    select coalesce(jsonb_object_agg(k, n), '{}') into v_rows from (
      select e #>> '{}' as k, count(*) as n
      from public.votes v, jsonb_array_elements(v.answer) e
      where v.question_id = p_question_id
        and not exists (select 1 from private.hidden_words h
                        where h.question_id = p_question_id and h.word = e #>> '{}')
      group by 1
    ) t;
  end if;

  return jsonb_build_object('question_id', p_question_id, 'qtype', q.qtype, 'total', v_total, 'counts', v_rows);
end $$;

-- Veřejné výsledky: jen u otázek, jejichž výsledky už prezentující odkryl.
create or replace function public.get_results(p_question_id text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.results(p_question_id)
  where exists (select 1 from public.questions where id = p_question_id and revealed);
$$;

-- Výsledky pro ovladač: vždy, včetně skrytých slov.
create or replace function public.get_results_admin(secret text, p_question_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.check_secret(secret);
  v := private.results(p_question_id);
  if v is null then return null; end if;
  return v || jsonb_build_object('hidden', coalesce((
    select jsonb_agg(word order by word) from private.hidden_words where question_id = p_question_id
  ), '[]'));
end $$;

-- ---------------------------------------------------------------------------
-- Ovladač
-- ---------------------------------------------------------------------------

create or replace function public.set_state(
  secret text,
  p_slide_index int,
  p_active_question text,
  p_voting_open boolean,
  p_show_results boolean,
  p_blackout boolean default false
) returns public.state language plpgsql security definer set search_path = '' as $$
declare
  s public.state;
begin
  perform private.check_secret(secret);
  update public.state set
    slide_index = p_slide_index,
    active_question = p_active_question,
    voting_open = coalesce(p_voting_open, false) and p_active_question is not null,
    show_results = coalesce(p_show_results, false),
    blackout = coalesce(p_blackout, false),
    updated_at = now()
  where id = 1
  returning * into s;

  if p_show_results and p_active_question is not null then
    update public.questions set revealed = true where id = p_active_question and not revealed;
  end if;
  return s;
end $$;

-- Synchronizace definic otázek z slides.json: [{ "id": "q1", "qtype": "scale", "options": [] }, ...]
create or replace function public.sync_questions(secret text, p_questions jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(secret);
  insert into public.questions (id, qtype, options)
  select e->>'id', e->>'qtype',
         coalesce(array(select jsonb_array_elements_text(e->'options')), '{}')
  from jsonb_array_elements(p_questions) e
  on conflict (id) do update set qtype = excluded.qtype, options = excluded.options;
end $$;

-- Skrytí nebo opětovné zobrazení slova ve word cloudu.
create or replace function public.set_word_hidden(secret text, p_question_id text, p_word text, p_hidden boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(secret);
  if p_hidden then
    insert into private.hidden_words values (p_question_id, private.norm_word(p_word)) on conflict do nothing;
  else
    delete from private.hidden_words where question_id = p_question_id and word = private.norm_word(p_word);
  end if;
  -- dá plátnu vědět, ať si výsledky načte znovu
  perform private.refresh_count(p_question_id);
end $$;

-- Vymazání hlasů jedné otázky (p_question_id) nebo všech (null).
create or replace function public.reset_votes(secret text, p_question_id text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_secret(secret);
  if p_question_id is null then
    delete from public.votes where true;
    delete from private.hidden_words where true;
    update public.questions set revealed = false where true;
    update public.vote_counts set n = 0, updated_at = now() where true;
  else
    delete from public.votes where question_id = p_question_id;
    delete from private.hidden_words where question_id = p_question_id;
    update public.questions set revealed = false where id = p_question_id;
    perform private.refresh_count(p_question_id);
  end if;
end $$;

-- Export všech hlasů pro CSV. device_id je zkrácený hash, ne původní id.
create or replace function public.export_votes(secret text)
returns table (question_id text, voter text, answer jsonb, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.check_secret(secret);
  return query
    select v.question_id, left(md5(v.device_id::text), 8), v.answer, v.created_at
    from public.votes v order by v.question_id, v.created_at;
end $$;

-- Práva na funkce
revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.cast_vote(text, uuid, jsonb),
  public.get_results(text),
  public.get_results_admin(text, text),
  public.set_state(text, int, text, boolean, boolean, boolean),
  public.sync_questions(text, jsonb),
  public.set_word_hidden(text, text, text, boolean),
  public.reset_votes(text, text),
  public.export_votes(text),
  public.verify_secret(text)
from public;
grant execute on function
  public.cast_vote(text, uuid, jsonb),
  public.get_results(text),
  public.get_results_admin(text, text),
  public.set_state(text, int, text, boolean, boolean, boolean),
  public.sync_questions(text, jsonb),
  public.set_word_hidden(text, text, text, boolean),
  public.reset_votes(text, text),
  public.export_votes(text),
  public.verify_secret(text)
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'state') then
    alter publication supabase_realtime add table public.state;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'vote_counts') then
    alter publication supabase_realtime add table public.vote_counts;
  end if;
end $$;
