# PRD — ARTI AI-nyhetsagent (v1)

**Dokumenteier:** ARTI Consult (Sander H‑O)
**Forfatter:** ChatGPT (GPT‑5 Thinking)
**Dato:** 27.09.2025
**Status:** Klar for bygging (MVP-scope bekreftet)

---

## 1) Bakgrunn & mål

ARTI trenger en intern nyhetsagent som gjør det mulig å være tidlig ute på AI‑nyheter, perspektiver og utviklerverktøy — uten manuelt arbeid. Agenten skal hente innhold fra et begrenset, kuratert utvalg **YouTube‑kanaler**, identifisere hva som er nytt siden forrige kjøring, transkribere, analysere, deduplisere og levere en **strukturert Slack‑brief** annenhver dag kl. **09:30 Europe/Oslo**.

### Mål

* **Hastighet:** Ny informasjon fra de definerte kildene er oppsummert og levert innen 09:30 annenhver dag.
* **Signal/noise:** < 5 % duplikater i Del 1 (nyheter).
* **Etterprøvbarhet:** 100 % av punktene lenker til kilde + (for video) timestamp.
* **Dev‑impact:** Hver brief inneholder 3–8 konkrete, utviklerrelevante punkter (Del 3).

### Ikke‑mål (v1)

* Å dekke “hele internett”.
* Å prosessere nyhetsbrev, X/Reddit/Discord, arXiv, blogger eller GitHub direkte (senere faser).
* Å opprette Notion‑sider automatisk (kun anbefale evt. deep‑dives).

---

## 2) Omfang (MVP)

Agenten leverer **én Slack‑melding** bestående av **tre deler**:

**Del 1 – Nyheter & oppdateringer (YouTube‑nyhetskanaler)**

* Hent nye videoer siden forrige kjøring fra:

  * [https://www.youtube.com/@AIDailyBrief](https://www.youtube.com/@AIDailyBrief)
  * [https://www.youtube.com/@matthew_berman](https://www.youtube.com/@matthew_berman)
  * [https://www.youtube.com/@mreflow](https://www.youtube.com/@mreflow)
  * [https://www.youtube.com/@TheNextWavePod/](https://www.youtube.com/@TheNextWavePod/)
  * [https://www.youtube.com/@lastweekinai](https://www.youtube.com/@lastweekinai)
* Transkriber (captions hvis tilgjengelig, ellers ASR/Whisper), ekstraher “nyhetssaker”, dedupliser overlappende saker på tvers av kanaler.

**Del 2 – Tema, debatter & perspektiver (YouTube‑podkaster)**

* Hent nye episoder siden forrige kjøring fra:

  * [https://www.youtube.com/@allin](https://www.youtube.com/@allin)
  * [https://www.youtube.com/@peterdiamandis](https://www.youtube.com/@peterdiamandis)
  * [https://www.youtube.com/c/twimlai](https://www.youtube.com/c/twimlai)
  * [https://www.youtube.com/channel/UC-o9u9QL4zXzBwjvT1gmzNg](https://www.youtube.com/channel/UC-o9u9QL4zXzBwjvT1gmzNg) (Eye on AI)
  * [https://www.youtube.com/@NoPriorsPodcast](https://www.youtube.com/@NoPriorsPodcast)
  * [https://www.youtube.com/@CognitiveRevolutionPodcast](https://www.youtube.com/@CognitiveRevolutionPodcast)
  * [https://www.youtube.com/@SuperhumanAIpodcast](https://www.youtube.com/@SuperhumanAIpodcast)
* Oppsummer *hva ble diskutert*, *posisjoner/pro‑&‑con*, *implikasjoner*. Anbefal maks 0–3 **“kan være lurt å dykke dypere i”**.

**Del 3 – For utviklere (verktøy, konsepter, teknikker)**

* **YouTube‑kanaler** (MVP):

  * [https://www.youtube.com/@jordanurbsAI](https://www.youtube.com/@jordanurbsAI)
  * [https://www.youtube.com/@rileybrownai](https://www.youtube.com/@rileybrownai)
  * [https://www.youtube.com/@PatrickOakleyEllis](https://www.youtube.com/@PatrickOakleyEllis)
  * [https://www.youtube.com/@DavidOndrej](https://www.youtube.com/@DavidOndrej)
  * [https://www.youtube.com/@ColeMedin](https://www.youtube.com/@ColeMedin)
  * [https://www.youtube.com/@indydevdan](https://www.youtube.com/@indydevdan)
  * [https://www.youtube.com/@aiadvantage](https://www.youtube.com/@aiadvantage)

* Mål: fange **releases**, **SDK/API‑endringer**, **rammeverk/agent‑teknikker**, **MCP‑økosystem**, **beste praksis**.

* Oppsummer som “prøv nå”, “release notes”, “breaking changes”, “ny teknikk/guide”.

**Frekvens & kanal:** Annenhver dag (Europe/Oslo) kl. **09:30** → én fast **Slack‑kanal**.

---

## 3) Interessenter & brukerhistorier

* **Mottakere:** ARTI‑teamet (konsulenter, utviklere, ledelse).
* **Eier:** Sander (produkt), + en teknisk ansvarlig for drift.

**Brukerhistorier (utdrag)**

* Som **AI‑konsulent** vil jeg se en kort liste over ferske AI‑nyheter med kilde og timestamp, så jeg vet hva jeg skal lese først.
* Som **utvikler** vil jeg få konkrete “prøv nå”‑punkter (Del 3) med lenker til docs/demovideo, så jeg raskt kan teste.
* Som **leder** vil jeg ha et kort “hvorfor det betyr noe” per tema (Del 2), så jeg kan prioritere hva vi bør følge opp.

---

## 4) Funksjonelle krav (FR)

**Ingest (YouTube)**

* **FR‑1:** Systemet skal identifisere nye videoer for hver kilde siden siste vellykkede kjøring (bruk `publishedAt` + `last_run`).
* **FR‑2:** Systemet skal hente tekst via **YouTube‑captions** dersom tilgjengelig.
* **FR‑3:** Dersom captions mangler, skal systemet transkribere lokalt via **ASR (Whisper large‑v3)**.
* **FR‑4:** Transkript skal lagres med metadata: `channel_id`, `video_id`, `title`, `published_at`, `duration`, `transcript_source` (captions/ASR), `lang`.

**Parsing & itemisering**

* **FR‑5:** Systemet skal ekstrahere atomiske **nyhetssaker** fra Del‑1‑kildene (én sak = én lansering/endring/statement), hvert item med: `title (≤12 ord)`, `summary (≤1 setning)`, `entities`, `type (release/tool/policy/research/etc.)`, `source_url`, `timestamp` (hh:mm:ss) dersom mulig.
* **FR‑6:** For Del 2 skal hvert tema‑item ha feltene: `what_was_discussed`, `positions (pro/contra)`, `key_quotes (timestamp)`, `implications (why_it_matters)`.
* **FR‑7:** For Del 3 skal hvert dev‑item ha feltene: `change_type (release/breaking/how‑to)`, `what_changed`, `developer_action (try/test/update)`, `links`.

**Dedup/Clustering**

* **FR‑8:** Systemet skal deduplisere identiske/tilsvarende saker på tvers av Del‑1‑kanalene (similarity ≥ 0,85), og beholde én **kanonisk** sak med feltet `also_covered_by` (liste av channel/video_ids).

**Relevans & scoring**

* **FR‑9:** Hvert item får en **relevansscore** basert på (a) recency, (b) kildevekter pr. kanal, (c) dev‑impact‑score for Del 3.
* **FR‑10:** Slack‑briefen viser kun topp‑N items pr. del (konfigurerbart; default: Del 1: 5–12, Del 2: 3–6, Del 3: 3–8).

**Slack‑leveranse**

* **FR‑11:** Systemet skal poste én melding i Slack med tre seksjoner i fast rekkefølge + evt. “Deep‑dives å vurdere (0–3)”.
* **FR‑12:** Hvert punkt skal inneholde **lenke til kilden** og (hvis video) **timestamp**.
* **FR‑13:** Meldingen skal leveres **senest 09:30** annenhver dag (Europe/Oslo).

**Konfidens & etterprøvbarhet**

* **FR‑14:** Hvert punkt merkes med `confidence: high/medium/low` (heuristikk: kilde‑type, entydighet, transcript‑kvalitet).

**Operasjon & drift**

* **FR‑15:** Systemet skal være idempotent pr. kjøring (ingen dobbeltposting av samme dag).
* **FR‑16:** Systemet skal logge per kilde og per video (ingest → analyse → dedup → publisering).

---

## 5) Ikke‑funksjonelle krav (NFR)

* **NFR‑1 (Ytelse):** Kjøring skal fullføres innen **20 min** gitt ≤ 180 min total ny videovarighet siden forrige kjøring.
* **NFR‑2 (Pålitelighet):** 99 % suksessrate siste 30 dager; automatisk retry/backoff mot API‑feil.
* **NFR‑3 (Kost):** ASR‑kost skal holdes nede via captions‑preferanse + batching.
* **NFR‑4 (Sikkerhet):** Hemmelige nøkler lagres i secret‑manager; minst mulig tilgang (principle of least privilege).
* **NFR‑5 (Personvern):** Kun offentlig innhold; ingen persondata behandles utover kanal‑ og videometadata.

---

## 6) Arkitektur (oversikt)

**Komponenter**

1. **Scheduler/Orchestrator** (n8n / cron): trigge pipeline annenhver dag 09:30 (Europe/Oslo).
2. **Source Fetcher**: YouTube Data API v3 for kanal‑uploads → nye video‑IDs, metadata.
3. **Transcription Service**: Captions‑fetch → fallback **Whisper** (GPU hvis tilgjengelig) for ASR.
4. **Parser/Itemizer (LLM)**: Chunk‑basert parsing av transkript → strukturerte items pr. del.
5. **Dedup/Clustering**: Embeddings (pgvector) + cosine + MinHash/SimHash for titler.
6. **Scoring/Ranking**: Regler + vektning pr. del.
7. **Composer**: Genererer Slack‑melding (Block Kit) fra topp‑N pr. del.
8. **Publisher**: Slack Web API postMessage → valgt kanal.
9. **Store**: Postgres (Supabase) + `pgvector` for embeddings; tabeller for `sources`, `videos`, `transcripts`, `items`, `clusters`, `runs`.
10. **Observability**: Metrics, strukturert logging, varsel på feil (Slack DM/ops‑kanal).

**Dataflyt (E2E)**
Scheduler → Fetch uploads per kanal → Filter `publishedAt > last_run` → Captions? (ja: fetch; nei: ASR) → Normalize transcript → LLM‑itemize pr. del → Dedup/cluster → Score/rank → Compose Slack → Post → Persist `last_run`/artefakter.

---

## 7) Datamodell (skisse)

* `sources(id, name, type{news|debate|dev}, channel_url, channel_id, weight, active)`
* `runs(id, started_at, finished_at, status, stats_json)`
* `videos(id, source_id, video_id, title, published_at, duration_s, url, has_captions, transcript_source, lang)`
* `transcripts(id, video_id, text, segments_json, quality_score)`
* `items(id, run_id, video_id, part{1|2|3}, type, title, summary, entities[], timestamp_hms, links[], confidence)`
* `item_embeddings(item_id, embedding_vector)`
* `clusters(id, canonical_item_id, member_item_ids[], similarity_threshold, also_covered_by[])`
* `slack_posts(id, run_id, channel_id, ts, status)`

Indekser: `(published_at)`, `(source_id, published_at)`, vektorindeks på `item_embeddings`.

---

## 8) Deduplisering & clustering

* Generér **kanonisk nøkkel** fra `entities + lemmatisert n‑gram‑tittel`.
* Embedding‑likhet (cosine) + tittel‑MinHash (K=128) → hvis ≥ 0,85 kombiskår → slå sammen.
* Behold item med best (score: recency + kildevekt + klarhet), legg øvrige i `also_covered_by`.

---

## 9) Relevans & ranking

**Basisskår:**
`score = w_recency * f(age) + w_source * source_weight + w_signal * signal_density + w_dev * dev_impact (kun Del 3)`

* `f(age)` kan være eksponentielt avtagende (nytt innhold favoriseres).
* `signal_density`: ratio (informative tokens / total).
* `dev_impact`: regelbasert (keywords: SDK, API, release, breaking, MCP, agent, RAG, security fix, perf boost).

---

## 10) LLM‑strategi & prompting

* **Input:** Kun transkript/metadata fra kilden (ingen “egen kunnskap”).
* **Output:** Strukturerte JSON‑objekter per del (valideres mot schema).
* **Stil:** Kort, konkret, uten hype; maks 1 setning per summary.
* **Konfidens:** Sett `confidence` basert på (a) tydelighet i transkriptet, (b) samsvar mellom flere kilder, (c) ASR vs captions.

**Schemas (utdrag)**

```json
// Del 1 item
{
  "title": "",
  "summary": "",
  "entities": [""],
  "type": "release|tool|policy|research|other",
  "source_url": "",
  "timestamp": "HH:MM:SS",
  "confidence": "high|medium|low"
}
```

```json
// Del 2 item
{
  "what_was_discussed": "",
  "positions": {"pro": [""], "contra": [""]},
  "key_quotes": [{"quote": "", "timestamp": ""}],
  "implications": ""
}
```

```json
// Del 3 item
{
  "change_type": "release|breaking|how-to",
  "what_changed": "",
  "developer_action": "try|update|evaluate",
  "links": [""],
  "confidence": "high|medium|low"
}
```

---

## 11) Slack‑melding (Block Kit) — format & eksempel

**Struktur (fast):**

* Header: `ARTI AI‑brief • DD.MM.YYYY`
* Del 1: 🆕 Nyheter & oppdateringer (5–12 bullets)
* Del 2: 🧠 Tema & debatter (3–6 cards)
* Del 3: 🛠️ For utviklere (3–8 bullets)
* Deep‑dives å vurdere (0–3)

**Bullet‑mal (Del 1/3)**
`• <tittel> — <summary> [<timestamp>] <lenke> (confidence: H/M/L)`

**Kort‑kort (Del 2)**
`• Hva: …  | Perspektiver: …  | Hvorfor: …  | [timestamp/kilde]`

---

## 12) Feilhåndtering & robusthet

* Retry m/eksponentiell backoff på API‑kall (YouTube/Slack).
* Hvis en kilde feiler: fortsett med resten; merk i sluttrapporten hvilken kilde som feilet.
* Hvis ingen nye videoer: post kort melding “Ingen nye videoer siden forrige kjøring” (behold Del 2/3 hvis relevant).
* Hvis ASR feiler: hopp over det ene itemet, logg og fortsett.

---

## 13) Observability

* **Metrics:** antall nye videoer, transkriberte minutter (captions vs ASR), antall items/klustre, duplikatrate, kjøringstid, feilkoder.
* **Logs:** per video pipeline‑steg (ingest, transcript, parse, dedup, score, publish).
* **Varsler:** Slack DM til eier ved kjøringsfeil eller når Del 3 < 3 items.

---

## 14) Sikkerhet & compliance

* Bruk offisielle API‑er i tråd med vilkår.
* Hemmeligheter i secret‑manager; begrensede nøkler (read‑only YouTube, post‑only Slack).
* Ingen PII; kun offentlig tilgjengelig innhold.

---

## 15) Konfigurasjon (env)

* `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`
* `YOUTUBE_API_KEY`
* `OPENAI/ASR_API_KEY` (hvis ekstern ASR), eller lokal GPU‑konfig for Whisper
* `TZ=Europe/Oslo`
* Terskler: `SIMILARITY_THRESHOLD=0.85`, `MAX_ITEMS_PART1=12`, `MAX_ITEMS_PART2=6`, `MAX_ITEMS_PART3=8`

---

## 16) Milepæler & akseptansekriterier

**M1 — Ingest & transkripsjon (Del 1/2 kilder)**

* *AK:* Nye videoer oppdages korrekt; ≥ 95 % captions hentes når tilgjengelig; ASR fallback fungerer.

**M2 — Parsing, dedup & lagring**

* *AK:* Items valideres mot schema; duplikatrate < 5 % i Del 1 på testkorridor.

**M3 — Slack‑brief (format/stil)**

* *AK:* Meldingen poster automatisk 09:30 med tre deler, riktig sortert, med lenker+timestamps.

**M4 — Del 3 (dev‑fokus)**

* *AK:* Minst 3 utviklerrelevante punkter per kjøring i 1 uke, med klare “developer_action”.

**M5 — Observability & drift**

* *AK:* Dash/logg viser pipeline‑helse; varsel ved feil; idempotent publisering verifisert.

---

## 17) Risikoer & tiltak

* **ASR‑kvalitet variabel** → prioriter captions, bruk bedre modeller, juster VAD/diarisering.
* **Kanalpublisering ujevnt** → Del 3 kan bli tynn enkelte dager → fallback med “siste 3 dager” vindu.
* **API‑rate limits** → caching, backoff, batch‑kall.
* **Hallusinasjon i LLM** → streng kilde‑prompting, schema‑validering, “no outside knowledge”.

---

## 18) Drift & runbook (kort)

1. Sjekk ops‑kanal for “MVP run OK/FAIL”.
2. Ved feil: åpne siste `run_id` i dashboard → se steg som feilet → re‑run step eller hele kjøring.
3. Legg til/fjern kilder i `sources`‑tabellen (toggle `active`).

---

## 19) Backlog (v1.1+)

* Flerkilde‑støtte (GitHub releases, RSS av offisielle dev‑blogger).
* Personlige filtre (“kun Del 3 til Dev‑kanal”).
* Lagring av klipp (auto‑timestamped highlights).
* Enkel web‑dashboard for historikk/søk.
* Automatisk “weekly digest” (fredag 09:30).
* Auto‑etiketter: “Security”, “Agents”, “MCP”, “RAG”, “Perf”.

---

## 20) Vedlegg

**A. Cron/frekvens:** Annenhver dag 09:30 (Europe/Oslo), DST‑bevisst (cron i lokal tid).
**B. Kanallister:**

* **Del 1 – Nyheter & oppdateringer:**

  * [https://www.youtube.com/@AIDailyBrief](https://www.youtube.com/@AIDailyBrief)
  * [https://www.youtube.com/@matthew_berman](https://www.youtube.com/@matthew_berman)
  * [https://www.youtube.com/@mreflow](https://www.youtube.com/@mreflow)
  * [https://www.youtube.com/@TheNextWavePod/](https://www.youtube.com/@TheNextWavePod/)
  * [https://www.youtube.com/@lastweekinai](https://www.youtube.com/@lastweekinai)
* **Del 2 – Tema, debatter & perspektiver:**

  * [https://www.youtube.com/@allin](https://www.youtube.com/@allin)
  * [https://www.youtube.com/@peterdiamandis](https://www.youtube.com/@peterdiamandis)
  * [https://www.youtube.com/c/twimlai](https://www.youtube.com/c/twimlai)
  * [https://www.youtube.com/channel/UC-o9u9QL4zXzBwjvT1gmzNg](https://www.youtube.com/channel/UC-o9u9QL4zXzBwjvT1gmzNg)
  * [https://www.youtube.com/@NoPriorsPodcast](https://www.youtube.com/@NoPriorsPodcast)
  * [https://www.youtube.com/@CognitiveRevolutionPodcast](https://www.youtube.com/@CognitiveRevolutionPodcast)
  * [https://www.youtube.com/@SuperhumanAIpodcast](https://www.youtube.com/@SuperhumanAIpodcast)
* **Del 3 – Dev (YouTube‑kanaler, MVP):**

  * [https://www.youtube.com/@jordanurbsAI](https://www.youtube.com/@jordanurbsAI)
  * [https://www.youtube.com/@rileybrownai](https://www.youtube.com/@rileybrownai)
  * [https://www.youtube.com/@PatrickOakleyEllis](https://www.youtube.com/@PatrickOakleyEllis)
  * [https://www.youtube.com/@DavidOndrej](https://www.youtube.com/@DavidOndrej)
  * [https://www.youtube.com/@ColeMedin](https://www.youtube.com/@ColeMedin)
  * [https://www.youtube.com/@indydevdan](https://www.youtube.com/@indydevdan)
  * [https://www.youtube.com/@aiadvantage](https://www.youtube.com/@aiadvantage)
