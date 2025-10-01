# Deployment Guide - AI Nyhetsagent

## Automatisk kjøring med GitHub Actions

Systemet er konfigurert til å kjøre automatisk hver dag kl. 09:30 (Oslo tid) via GitHub Actions.

### Oppsett

1. **Push koden til GitHub:**
```bash
git add .
git commit -m "Initial commit - AI nyhetsagent"
git remote add origin https://github.com/USERNAME/REPO_NAME.git
git push -u origin main
```

2. **Sett opp GitHub Secrets:**
   
   Gå til GitHub repository → Settings → Secrets and variables → Actions → New repository secret

   Legg til følgende secrets:
   - `YOUTUBE_API_KEY`: Din YouTube Data API v3 nøkkel
   - `OPENAI_API_KEY`: Din OpenAI API nøkkel  
   - `SLACK_BOT_TOKEN`: Slack bot token (xoxb-...)
   - `SLACK_CHANNEL_ID`: Slack channel ID (C...)

### Kjøretider

- **Automatisk**: Hver dag kl. 07:30 UTC (09:30 CEST / 08:30 CET)
- **Manuell**: Via GitHub Actions "Run workflow" knapp
- **Lookback**: Siste 24 timer med videoer

### Overvåking

- **Workflow status**: GitHub Actions tab
- **Slack notifications**: Brief postes til konfigurert kanal
- **Logs**: Lastes opp automatisk ved feil
- **Kostnader**: Trackes i pipeline output

### Ressurser og kostnader

**GitHub Actions (gratis tier):**
- 2000 minutter/måned gratis for private repos
- Ubegrenset for public repos
- Estimert bruk: ~5 min/dag = 150 min/måned

**API kostnader:**
- YouTube API: Gratis (10,000 units/dag)
- OpenAI Whisper: ~$0.10-0.50/dag avhengig av video lengde
- OpenAI Embeddings: ~$0.01/dag
- **Total estimat: $3-15/måned**

### Feilsøking

1. **Workflow feiler**: Sjekk GitHub Actions logs
2. **Ingen Slack melding**: Verifiser SLACK_BOT_TOKEN og SLACK_CHANNEL_ID
3. **YouTube feil**: Sjekk YOUTUBE_API_KEY og quota
4. **OpenAI feil**: Sjekk OPENAI_API_KEY og credits

### Alternative deployment metoder

#### 1. Railway (Anbefalt for 24/7 hosting)
```bash
# Install Railway CLI
npm install -g @railway/cli

# Deploy
railway login
railway init
railway up
```

#### 2. Render
- Connect GitHub repository
- Set environment variables
- Configure cron job

#### 3. Vercel (Med Vercel Cron)
```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

### Lokal testing
```bash
# Test full pipeline
npm run test:full

# Test with custom lookback
LOOKBACK_HOURS=48 npx tsx src/index.ts

# Dry run (no Slack posting)
DRY_RUN=true npx tsx src/index.ts
```