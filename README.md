# Dilemata použití AI ve volebních kampaních

Interaktivní prezentace pro přednášku na KISK MUNI. Nahrazuje PowerPoint i Mentimeter: prezentující přepíná slidy, publikum hlasuje na telefonech a výsledky se živě zobrazují na plátně.

| Stránka | Adresa | Kdo |
|---|---|---|
| Publikum | `https://michalberg.github.io/kisk/` | telefony v sále (QR kód) |
| Plátno | `https://michalberg.github.io/kisk/screen/` | projektor |
| Ovladač | `https://michalberg.github.io/kisk/control/?key=TAJNY_KLIC` | notebook prezentujícího |

Všechny tři stránky sdílí stav v Supabase (projekt `zpysnfkjvgdpyoykhcnv`). Změny chodí přes Realtime. Když spojení vypadne, stránky se každé 3 sekundy dotazují samy.

## Struktura

```
index.html, screen/, control/   tři stránky (Vite multi-page)
src/data/slides.json            obsah přednášky vytvořený ze scénáře
src/lib/                        backend, vykreslení slidů, grafy, word cloud, QR
src/pages/                      logika jednotlivých stránek
supabase/migration.sql          tabulky, RLS, funkce, Realtime
scripts/                        migrace, bezpečnostní test, zátěžový test
TESTOVANI.md                    zkouška před přednáškou se třemi telefony
```

## Lokální vývoj

```bash
npm install
cp .env.example .env     # doplnit hodnoty
npm run dev              # http://localhost:5173
```

**Ukázkový režim bez serveru:** přidejte k adrese `?demo`, třeba `/control/?demo&key=demo` a `/screen/?demo`. Data jsou jen v localStorage prohlížeče a karty se mezi sebou synchronizují. Hodí se na úpravy obsahu a vzhledu.

## Nasazení

### 1. Supabase

1. Spusťte migraci, buď příkazem `npm run migrate` (potřebuje `DATABASE_URL` v `.env`), nebo vložením obsahu `supabase/migration.sql` do Supabase → SQL Editor. Skript lze pouštět opakovaně.
2. Nastavte tajný klíč ovladače v SQL Editoru:
   ```sql
   insert into private.config (id, control_secret) values (1, 'VAS-TAJNY-KLIC')
   on conflict (id) do update set control_secret = excluded.control_secret;
   ```
   Klíč je jen v databázi (schéma `private`, nedostupné přes API) a v adrese ovladače. Do kódu publika ani plátna se nedostane. Změníte ho stejným příkazem.
3. Definice otázek (kvůli kontrole odpovědí na serveru) nahraje ovladač sám při každém otevření z `slides.json`.

### 2. GitHub Pages

1. V repozitáři: Settings → Pages → Source: **GitHub Actions**.
2. Settings → Secrets and variables → Actions → **Variables**:
   - `VITE_SUPABASE_URL` = `https://zpysnfkjvgdpyoykhcnv.supabase.co`
   - `VITE_SUPABASE_KEY` = publishable key (je veřejný, chrání ho RLS)
   - volitelně `VITE_PUBLIC_URL`, pokud chcete v QR kódu jinou adresu
3. Každý push do `main` aplikaci sestaví a nasadí (`.github/workflows/deploy.yml`).

Secret key ze Supabase aplikace nepotřebuje a nikam ho nedávejte.

## Ovládání

| Klávesa | Akce |
|---|---|
| → , mezerník, PageDown | další slide |
| ← , PageUp | předchozí slide |
| O | otevřít nebo zavřít hlasování |
| R | odkrýt nebo skrýt výsledky |
| B (nebo `.` z klikru) | začernit plátno |

- Přechod na slide s otázkou otevře hlasování, přechod na výsledky ho zavře a výsledky ukáže.
- Ovladač vidí průběžné výsledky i před odkrytím. Plátno a publikum je nedostanou, dokud je neodkryjete (kontroluje to server).
- U word cloudu jde kliknutím na slovo skrýt nebo vrátit. Vulgarismy skrývá jednoduchý filtr (`src/lib/profanity.ts`) automaticky.
- Uplynulý čas se spustí s prvním přechodem na další slide nebo tlačítkem Start. Drží se i po obnovení stránky.
- Plátno: dvojklik přepne celou obrazovku.

## Reset hlasů

- **Jedna otázka:** v ovladači v panelu otázky tlačítko „Vymazat hlasy této otázky“.
- **Vše:** v ovladači „Vymazat všechny hlasy“ (s potvrzením). Smaže hlasy, skrytá slova a vrátí výsledky do skrytého stavu.
- **Z SQL:** `select reset_votes('VAS-TAJNY-KLIC');`

Před přednáškou vymažte všechny hlasy a vraťte ovladač na první slide.

## Export

Tlačítko „Export CSV“ v ovladači stáhne všechny hlasy (oddělovač středník, UTF-8 s BOM pro Excel). Místo `device_id` obsahuje jen zkrácený hash.

## Bezpečnost (shrnutí)

- `votes`: RLS zapnuté, veřejné role nemají na tabulku žádná práva. Hlasuje se jen přes `cast_vote()`, která ověří, že otázka je aktivní a hlasování otevřené, a zkontroluje tvar odpovědi.
- `state`: veřejně jen čtení. Zápis jen přes `set_state(secret, …)` (security definer, ověřuje klíč).
- Výsledky jen agregované: `get_results()` (jen odkryté otázky) a `get_results_admin(secret, …)`.
- Ověření: `npm run test:security` (17 kontrol proti živé databázi).

## Testy

```bash
npm run test:security          # pravidla na serveru
npm run loadtest               # 100 současných hlasujících na otázku q1
npm run loadtest -- q3 150     # jiná otázka a počet
```

Zátěžový test na chvíli otevře hlasování, na konci hlasy otázky smaže a vrátí stav. Během přednášky ho nespouštějte. Poslední běh: 100 hlasujících a 205 požadavků bez chyby, medián odezvy 65 ms, p95 175 ms, počítadlo přes Realtime živě.

## Úpravy obsahu

Slidy jsou v `src/data/slides.json`. Typy: `title`, `big-number`, `list`, `text`, `question`, `results`, `compare`, `qr`. Text v hranatých závorkách v `notes` se v ovladači zvýrazní jako poznámka k doplnění. `**tučně**` funguje v textech slidů.
