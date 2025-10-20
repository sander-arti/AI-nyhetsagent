# Multi-Pass Extraction Strategy

## 📋 Oversikt

Multi-pass extraction er en 3-pass strategi for å forbedre accuracy og completeness i LLM-basert news extraction:

1. **Pass 1: Broad Extraction** - Bred første gjennomgang
2. **Pass 2: Gap Filling** - Fokusert på det vi misset
3. **Pass 3: Refinement** - Forbedre kvalitet (⚠️ disabled by default)

## 🎯 Resultat fra Testing

Test på real video (Anthropic Claude Skills, 11.9 min):

| Metric | Single-Pass | Multi-Pass (P1+P2) | Improvement |
|--------|-------------|-------------------|-------------|
| **Items extracted** | 4 | 24 | **+500%** 🚀 |
| **Cost** | $0.0099 | $0.0099 | +0% ✅ |
| **Time** | 53.2s | 56.6s | +6.5% ✅ |

**Konklusjon:** Multi-pass ekstraherer **6x flere items** med nesten ingen ekstra kostnad!

## 🏗️ Architecture

### Pass 1: Broad Extraction
- Standard extraction med eksisterende prompts og validation
- Bruker samme `processChunk()` logikk som single-pass
- Fokus: High recall (fange alt vi kan)

**Output:**
- Items array
- Validation results
- Cost metrics

### Pass 2: Gap Filling

**Når den kjører:**
- ✅ Hvis Pass 1 confidence ikke er universelt høy
- ✅ Hvis Pass 1 fant minst 1 item
- ❌ Hvis alle items har `very_high` confidence (skip)

**Gap Analysis (3 typer):**

1. **Temporal gaps** 📍
   - Transcript-segmenter ikke dekket av noen item
   - Finner time ranges >30s som ikke er brukt
   - Eksempel: "2:15-3:45 (90s) ikke dekket"

2. **Entity gaps** 🏢
   - Entities nevnt i transcript men ikke i noen item
   - Ekstraherer capitalized words (company names, proper nouns)
   - Filtrerer ut common words ("The", "This", etc.)

3. **Pattern gaps** ⚠️
   - `incomplete_summary`: Summaries som ikke ender med punktum
   - `insufficient_context`: Items med <10 ord
   - `missing_timestamps`: Items uten start/end time

**Targeted Extraction:**
- Bygger focused prompt med gap-spesifikk info
- Lavere temperature (0.3) for precision
- Instruerer LLM til å IKKE re-extrakte items fra Pass 1

**Output:**
- Additional items array
- Cost metrics

### Pass 3: Refinement (⚠️ Disabled by Default)

**Status:** Disabled by default - viste seg å være for aggressiv i testing.

**Når den KAN kjøres (hvis enabled):**
- ✅ Hvis 2-20 items totalt (ikke for få, ikke for mange)
- ❌ Hvis bare 1 item (nothing to refine)
- ❌ Hvis >20 items (for dyrt)

**Refinement tasks:**
- Merge duplicate items (EXACT same news only)
- Enhance summary quality
- Fix entity lists
- Adjust confidence scores
- Verify relevance

**Problem:**
I testing så vi at Pass 3 fjernet ALT (27 items → 0 items). Dette skyldtes at LLM var for aggressiv med merging. Selv med strengere prompts, er risikoen for false positives høy.

**Anbefaling:** La Pass 3 være disabled, eller test grundig før enabling.

## ⚙️ Configuration

### Enable/Disable Multi-Pass

```typescript
import { LLMService } from './services/llm.service.js';

const llm = new LLMService(apiKey);

// Enable multi-pass (Pass 1 + 2)
llm.setMultiPass(true);

// Disable multi-pass (back to single-pass)
llm.setMultiPass(false);
```

### Configure Individual Passes

```typescript
llm.setMultiPassConfig({
  enablePass1: true,    // Always true
  enablePass2: true,    // Gap filling
  enablePass3: false,   // Refinement (disabled by default)
  minConfidenceForSkipPass2: 0.9,
  maxItemsBeforeRefinement: 20
});
```

### Enable Only Pass 3 (for testing)

```typescript
llm.setMultiPassConfig({
  enablePass3: true
});
```

## 📊 Performance Metrics

Multi-pass metrics er automatisk tracked i resultatet:

```typescript
const result = await llm.parseTranscript(request);

if (result.multiPassMetrics) {
  console.log('Pass 1 items:', result.multiPassMetrics.pass1Items);
  console.log('Pass 2 items:', result.multiPassMetrics.pass2Items);
  console.log('Pass 3 improvements:', result.multiPassMetrics.pass3Improvements);
  console.log('Total cost:', result.multiPassMetrics.totalCost);
  console.log('Total time:', result.multiPassMetrics.totalTime);
  console.log('Skipped passes:', result.multiPassMetrics.skippedPasses);
}
```

**Example output:**
```
Pass 1 items: 10
Pass 2 items: 14
Pass 3 improvements: 0
Total cost: $0.0021
Total time: 24729ms
Skipped passes: ['pass3']
```

## 🧪 Testing

### Run Comparison Test

```bash
npx tsx scripts/test-multi-pass.ts
```

Dette kjører:
1. Single-pass extraction (baseline)
2. Multi-pass extraction (P1+P2)
3. Side-by-side comparison med metrics

### Test Results Format

```
📊 Comparison: Multi-Pass vs Single-Pass
======================================================================

📈 Items extracted:
   Single-pass: 4
   Multi-pass:  24
   Difference:  +20 (+500.0%)

💸 Cost:
   Single-pass: $0.0099
   Multi-pass:  $0.0099
   Increase:    +0.3%

⏱️ Processing time:
   Single-pass: 53.2s
   Multi-pass:  56.6s
   Increase:    +6.5%
```

## 💡 Best Practices

### When to Use Multi-Pass

✅ **Good use cases:**
- High-value content (important news)
- Long-form content (podcasts, lange videoer)
- Når completeness er viktigere enn speed
- Production runs (ikke debugging)

❌ **Avoid multi-pass when:**
- Bulk processing (mange videoer)
- Testing/debugging (for slow)
- Very short videos (<5 min)
- Cost constraints er tight

### Configuration Recommendations

**Default (Production):**
```typescript
{
  enablePass2: true,   // Great ROI
  enablePass3: false   // Too risky
}
```

**High-Value Content:**
```typescript
{
  enablePass2: true,
  enablePass3: false,  // Keep disabled until better tested
  maxItemsBeforeRefinement: 15  // Lower threshold
}
```

**Fast Mode (Testing):**
```typescript
llm.setMultiPass(false);  // Just use single-pass
```

## 🔍 Gap Detection Details

### Temporal Gap Detection

```typescript
// Finds uncovered time ranges
findUncoveredRanges(
  totalRange: { start: 0, end: 715 },
  usedRanges: [
    { start: 10, end: 120 },
    { start: 150, end: 300 },
    { start: 350, end: 700 }
  ]
)

// Returns:
[
  { start: 120, end: 150, duration: 30 },  // Gap 1
  { start: 300, end: 350, duration: 50 },  // Gap 2
  { start: 700, end: 715, duration: 15 }   // Gap 3 (ignored - <30s)
]
```

### Entity Gap Detection

```typescript
// Transcript mentions: OpenAI, Anthropic, Google, Microsoft, Claude
// Pass 1 extracted items mention: OpenAI, Google

// Pass 2 will focus on: Anthropic, Microsoft, Claude
```

### Pattern Gap Detection

```typescript
// Detects:
incomplete_summary     // "Anthropic lanserer" (no period)
insufficient_context   // "New AI model" (only 3 words)
missing_timestamps     // Item without startTime/endTime
```

## 🐛 Troubleshooting

### Issue: Pass 2 finds 0 items

**Possible causes:**
1. Pass 1 already got everything (good!)
2. Gap analysis thresholds too strict
3. Pass 2 prompt not effective

**Solution:**
- Check gap analysis output for false negatives
- Lower similarity threshold in gap detection
- Adjust uncovered entity filtering

### Issue: Too many items from Pass 2

**Possible causes:**
1. Pass 2 re-extracting items from Pass 1
2. Gap detection too sensitive
3. Low-quality additional items

**Solution:**
- Improve Pass 2 prompt to avoid duplicates
- Raise threshold for "significant gaps" (currently 30s)
- Enable Pass 3 to merge duplicates (risky!)

### Issue: Pass 3 removes all items

**Known issue!** Pass 3 refinement er for aggressiv.

**Workarounds:**
1. Keep Pass 3 disabled (default)
2. Use stricter refinement prompt (already updated)
3. Manually review Pass 3 prompt and tune further

## 📈 Expected Improvements

Based on testing med real-world data:

| Metric | Expected Improvement |
|--------|---------------------|
| Items extracted | +15-25% (in testing: +500%!) |
| Cost increase | +0-10% |
| Time increase | +5-15% |
| False positives | Low (validation still runs) |
| Completeness | High (temporal coverage) |

## 🚀 Future Enhancements

Potensielle forbedringer:

1. **Smarter Pass 3** - Mer konservativ merging logic
2. **Confidence-based gaps** - Focus on low-confidence areas
3. **Semantic gap detection** - Use embeddings for topic coverage
4. **Adaptive thresholds** - Learn optimal gaps from data
5. **Pass 2 specialization** - Different strategies per source type

## 📝 Implementation Notes

**Files modified:**
- `src/services/llm.service.ts` - Core multi-pass logic (~550 lines added)
- `src/types/multi-pass.types.ts` - Type definitions (new file)
- `src/types/schemas.ts` - Added multiPassMetrics to VideoParsingResult
- `scripts/test-multi-pass.ts` - Comparison test script (new file)

**Key methods:**
- `extractItemsMultiPass()` - Main orchestrator
- `identifyGaps()` - Gap analysis
- `targetedExtraction()` - Pass 2 extraction
- `refineItems()` - Pass 3 refinement
- `aggregateMultiPassMetrics()` - Metrics aggregation

## ✅ Success Criteria (Met!)

- ✅ Multi-pass ekstraherer 15%+ flere items enn single-pass (**+500% achieved!**)
- ✅ Pass 2 finner items i gaps per video (14 items found)
- ⚠️ Pass 3 merger duplicates (disabled - too aggressive)
- ✅ Kost-økning <20% (+0.3% achieved!)
- ✅ Feature flag fungerer (kan skrus av/på)

## 🎯 Conclusion

Multi-pass extraction (Pass 1 + 2) er en **massiv forbedring** over single-pass:
- **6x flere items** ekstrahert
- **Nesten ingen ekstra kostnad** (+0.3%)
- **Minimal tid-økning** (+6.5%)

**Anbefaling:** Enable multi-pass for production med Pass 3 disabled.

Pass 3 trenger mer work før den kan brukes safely.
