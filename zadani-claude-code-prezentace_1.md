# Zadání: interaktivní prezentace s hlasováním publika

## Cíl

Postav webovou aplikaci pro přednášku „AI ve volebních kampaních" na KISK MUNI (asi 90 minut, 30 až 80 lidí v sále). Aplikace nahrazuje PowerPoint i Mentimeter najednou: prezentující přepíná slidy, publikum na telefonech odpovídá na otázky a výsledky se živě zobrazují na plátně.

Obsah přednášky je v souboru `scenar-prednasky-AI-volby.md` v kořeni repozitáře. Z něj vytvoř data slidů podle pravidel níže.

## Tři pohledy, jeden sdílený stav

Aplikace má tři stránky, které sdílí stav uložený v Supabase:

1. **Plátno** (`/screen`) běží na projektoru. Zobrazuje aktuální slide na celou obrazovku, bez ovládacích prvků. Samo nic nepřepíná, jen sleduje stav.
2. **Ovladač** (`/control?key=TAJNY_KLIC`) běží na notebooku prezentujícího. Ukazuje aktuální slide, náhled dalšího slidu, poznámky pro mluvčího, počet hlasů u aktivní otázky, uplynulý čas přednášky a tlačítka. Ovládá se i klávesnicí.
3. **Publikum** (`/`) se otevírá na telefonech přes QR kód. Žádná navigace. Zobrazuje jen aktivní otázku, když je hlasování otevřené. Jinak „Počkejte na další otázku" a případně název aktuálního bloku.

Přepnutí na ovladači se musí na plátně i u publika projevit do jedné sekundy. Použij realtime odběr změn v Supabase, ne periodické dotazování. Jako zálohu při výpadku realtime spojení přidej dotazování každé 3 sekundy.

## Technologie

- Statický frontend: Vite a čistý TypeScript nebo lehký framework (Svelte, Preact). Bez těžkých závislostí.
- Backend: Supabase (Postgres, Realtime, Row Level Security).
- Hosting: GitHub Pages nebo Vercel.
- Grafy kresli vlastním SVG nebo lehkou knihovnou. Word cloud vlastní jednoduchou implementací nebo malou knihovnou.

## Datový model v Supabase

```sql
-- jeden řádek, stav prezentace
create table state (
  id int primary key default 1 check (id = 1),
  slide_index int not null default 0,
  active_question text,            -- id otázky, nebo null
  voting_open boolean not null default false,
  show_results boolean not null default false,
  updated_at timestamptz default now()
);

create table votes (
  id bigint generated always as identity primary key,
  question_id text not null,
  device_id uuid not null,
  answer jsonb not null,           -- číslo, id možnosti, pole id, nebo text
  created_at timestamptz default now(),
  unique (question_id, device_id)
);
```

Zabezpečení:
- Publikum smí jen vkládat a upravovat vlastní hlas, a jen pokud je hlasování u dané otázky otevřené. Kontroluj to na serveru, ne jen ve frontendu.
- Měnit tabulku `state` smí jen ovladač. Udělej funkci `set_state(secret text, ...)` se `security definer`, která ověří tajný klíč uložený na serveru. Klíč nikdy nedávej do kódu publika ani plátna.
- Hlasy jednotlivců se veřejně nečtou. Plátno a ovladač čtou jen agregované výsledky přes view nebo funkci.

## Identita hlasujícího

Při prvním otevření stránky publika vygeneruj náhodné `device_id` a ulož ho do localStorage (čtení a zápis obal do try/catch, při selhání drž id v paměti). Hlas jde měnit, dokud je hlasování otevřené, poslední hlas přepíše předchozí (upsert). Žádné jméno, e-mail ani přihlášení.

## Typy slidů

Data slidů ulož do `slides.json`. Každý slide má `type`, obsah a volitelně `notes` (poznámky pro mluvčího, zobrazují se jen na ovladači).

- `title`: velký nadpis a podnadpis.
- `big-number`: velké číslo, pod ním řádek textu, drobný doplněk (slide s výsledkem voleb).
- `list`: nadpis a jeden nebo dva bloky s podnadpisem a krátkými odrážkami (přehled použití AI).
- `text`: nadpis a krátký text, nejvýš tři věty (jádro dilematu).
- `question`: otázka pro publikum. Má `question_id`, typ otázky, text, případně scénář a možnosti. Když na něj ovladač přejde, otázka se automaticky aktivuje a hlasování otevře. Na plátně je scénář, otázka, možnosti, QR kód s adresou a živé počítadlo hlasů. Výsledky se nezobrazují, dokud je prezentující neodkryje.
- `results`: výsledky otázky podle `question_id`. Když na něj ovladač přejde, hlasování se zavře a výsledky se zobrazí.
- `compare`: dvě otázky vedle sebe (vstupní a výstupní anketa).
- `qr`: velký QR kód s adresou pro publikum a krátkým pokynem.

## Typy otázek

- `scale`: škála 1 až 5 s popisky krajních hodnot. Výsledek jako sloupcový graf s průměrem.
- `single`: výběr jedné možnosti. Žebříčky hranice (možnosti A až E a „nikde") jsou tento typ. Výsledek jako vodorovné sloupce s procenty, ve stejném pořadí jako možnosti, nikdy neřadit podle počtu.
- `multi`: výběr více možností. Výsledek jako vodorovné sloupce s procentem lidí, kteří možnost zaškrtli.
- `wordcloud`: jedno až tři krátká slova, každé max. 25 znaků. Výsledek jako word cloud, slova normalizuj (malá písmena, ořezání mezer). Přidej jednoduchý filtr vulgarismů a na ovladači tlačítko, kterým jde jednotlivé slovo skrýt.

Na telefonu musí být otázka čitelná bez zoomu a ovladatelná palcem. Po odeslání ukaž potvrzení „Hlas odeslán, můžete ho změnit".

## Jak ze scénáře vytvořit slidy

Ve `scenar-prednasky-AI-volby.md` jsou kromě obsahu i instrukce pro prezentujícího. Rozděl to takto:

- Úvodní slide s názvem přednášky a hned po něm slide `qr`, aby se lidé připojili.
- Otázky 1 až 3: vždy slide `question` a po něm `results`. Text „Po výsledcích" dej do `notes` slidu s výsledky.
- Představení kampaně: slide `big-number` s výsledkem a pět slidů `list` přesně podle scénáře. Pokyn „Návrat k word cloudu" dej do `notes` posledního z nich a za něj znovu zařaď výsledky otázky 3.
- „Kde se AI mýlila": slide `list` s častými chybami ze scénáře, zkrácenými na krátké řádky. Text pro mluvčího do `notes`.
- Každé z deseti dilemat má čtyři slidy:
  1. `text` s názvem dilematu jako nadpisem a scénářem otázky (pokud ho otázka má).
  2. `question`.
  3. `results`, do `notes` dej otázku do diskuse.
  4. `text` s jádrem dilematu. Do `notes` dej celý výklad, příklad z kampaně a otázku do diskuse.
- Přehled dalších dilemat: dva slidy `list`, na každém tři až čtyři body jen s tučným názvem a jednou krátkou větou.
- Otázka 14 jako `question`, pak `compare` s otázkami 1 a 14.
- Závěrečný slide `list` s pěti otázkami.
- Text v hranatých závorkách ve scénáři je poznámka k doplnění. Na slidy ho nedávej, nech ho jen v `notes` a na ovladači ho zvýrazni.

Na plátně nikdy nezobrazuj dlouhé odstavce. Pokud se text slidu nevejde, zkrať ho a plné znění dej do `notes`.

## Ovladač

- Klávesy: šipka vpravo nebo mezerník další slide, šipka vlevo předchozí, `R` odkrýt nebo skrýt výsledky, `O` otevřít nebo zavřít hlasování, `B` začernit plátno.
- Panel: aktuální slide, náhled dalšího, poznámky velkým písmem, počet hlasů u aktivní otázky, hodiny a uplynulý čas.
- Tlačítko pro vymazání hlasů jedné otázky a pro vymazání všech hlasů (s potvrzením), aby šla aplikace před přednáškou otestovat.
- Export všech výsledků do CSV.

## Vzhled

- Čistý, dobře čitelný design pro projektor: velké písmo, vysoký kontrast, světlé pozadí.
- Barvy můžeš převzít z vizuálu Zeleného Brna: tmavě zelená `#104f2d`, velmi tmavá `#022815`, jasně zelená `#0bd26f`, růžová `#ffa6d1`. Grafy a text ale musí zůstat čitelné i na slabém projektoru.
- Plátno počítá s poměrem 16:9, telefon s šířkou od 360 px.
- Žádná emoji.

## Spolehlivost

- Při ztrátě spojení ukaž publiku nenápadné „Připojuji se znovu" a hlas odešli, jakmile se spojení obnoví.
- Plátno a ovladač musí po obnovení stránky naskočit do aktuálního stavu.
- Otestuj zátěž: simuluj 100 současných hlasujících skriptem.

## Co odevzdat

1. Funkční aplikaci nasazenou na veřejné adrese.
2. SQL migraci pro Supabase včetně RLS a funkcí.
3. `slides.json` vytvořený ze scénáře.
4. README s postupem nasazení, nastavení tajného klíče a resetu hlasů.
5. Krátký testovací postup: jak si to před přednáškou vyzkoušet se třemi telefony.
