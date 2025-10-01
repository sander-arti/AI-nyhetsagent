# AI Nyhetsagent 🤖📰

Automatisk AI-drevet nyhetsagent som samler, prosesserer og leverer daglige AI-nyheter via Slack.

## 🎯 Funksjonalitet

- **19 YouTube-kilder** på tvers av nyheter, debatter og utviklerinnhold
- **Automatisk transkripsjon** med YouTube Captions → Whisper fallback
- **Intelligent parsing** med GPT-4o-mini for strukturerte insights
- **Deduplication** via embedding similarity (OpenAI text-embedding-3-small)
- **Daglig Slack brief** kl. 09:30 Oslo tid
- **24-timers lookback** for ferske nyheter

## 🚀 Rask Start

### 1. Installer avhengigheter
```bash
npm install
```

### 2. Konfigurer environment
```bash
cp .env.example .env
# Rediger .env med dine API-nøkler
```

### 3. Sett opp database
```bash
npx tsx scripts/migrate.ts
npx tsx src/db/seed-sources.ts
```

### 4. Test systemet
```bash
# Full pipeline test
npm run test:full

# Produksjons-run (dry run)
DRY_RUN=true npx tsx src/index.ts
```

## 📋 Påkrevde API-nøkler

- **YouTube Data API v3**: [Google Cloud Console](https://console.cloud.google.com/)
- **OpenAI API**: [OpenAI Platform](https://platform.openai.com/)
- **Slack Bot Token**: [Slack API](https://api.slack.com/)

## 🏗️ Deployment

### GitHub Actions (Anbefalt)
1. Push til GitHub repository
2. Sett opp GitHub Secrets (se DEPLOYMENT.md)
3. Workflow kjører automatisk kl. 09:30 hver dag

### Alternativ: Railway/Render
Se `DEPLOYMENT.md` for detaljerte instruksjoner.

## 📊 Struktur

```
src/
├── services/           # YouTube, OpenAI, Slack integrasjoner
├── processors/         # Transcript, Item, Dedup prosessering
├── db/                # Database og seeding
├── types/             # TypeScript definitioner
└── index.ts           # Hovedinngangspunkt
```

## 🛠️ Teknologi Stack

- **Runtime**: Node.js 20 + TypeScript
- **Database**: SQLite (dev) / PostgreSQL (prod)
- **Vector Search**: ChromaDB
- **Transcription**: YouTube Captions API → OpenAI Whisper
- **LLM**: OpenAI GPT-4o-mini + text-embedding-3-small
- **Scheduler**: GitHub Actions

## 📈 Kilder (19 kanaler)

### Nyheter (5)
- AI Daily Brief, Matthew Berman, MrEflow, The Next Wave Pod, Last Week in AI

### Debatter (7) 
- All In Podcast, Peter Diamandis, TWIML AI, Eye on AI, No Priors, Cognitive Revolution, Superhuman AI

### Utviklere (7)
- Jordan Urbs AI, Riley Brown AI, Patrick Oakley Ellis, David Ondrej, Cole Medin, Indie Dev Dan, AI Advantage

## 💰 Estimerte kostnader

- **YouTube API**: Gratis (10K units/dag)
- **OpenAI Whisper**: $0.10-0.50/dag 
- **OpenAI Embeddings**: ~$0.01/dag
- **GitHub Actions**: Gratis (2000 min/måned)

**Total: $3-15/måned**

## 📚 Dokumentasjon

- [`DEPLOYMENT.md`](DEPLOYMENT.md) - Deployment guide
- [`implementation_plan.md`](implementation_plan.md) - Utvikling historie
- [PRD.md](PRD.md) - Product Requirements Document

## 🔧 Utvikling

```bash
# Test komponenter individuelt
npx tsx scripts/test-youtube.ts
npx tsx scripts/test-transcription.ts  
npx tsx scripts/test-parsing.ts
npx tsx scripts/test-slack.ts

# Resolve manglende channel IDs
npx tsx scripts/resolve-channel-ids.ts
```

## 📄 Lisens

MIT License - se LICENSE fil for detaljer.

---

Bygget med ❤️ for å holde AI-miljøet oppdatert på alle frontene! 🚀