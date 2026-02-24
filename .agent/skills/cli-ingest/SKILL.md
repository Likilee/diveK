# CLI Ingestion Pipeline

Use when the user asks to ingest YouTube videos into the database, add videos to the search index, run the data pipeline, or fetch transcripts.

## Trigger Phrases
- "ingest video", "add video to db", "run pipeline"
- "fetch transcript", "get subtitles"
- "add videos from file", "batch ingest"
- "ingest to local/prod"

## Available Commands

### Single Video Ingestion
```bash
pnpm cli ingest run --video-id <VIDEO_ID> --target local
pnpm cli ingest run --video-id <VIDEO_ID> --target prod
```

### URL-based Ingestion
```bash
pnpm cli ingest run --url <YOUTUBE_URL> --target local
pnpm cli ingest run --url https://www.youtube.com/watch?v=VIDEO_ID --target local
```

### Batch Ingestion from File
```bash
pnpm cli ingest run --video-ids-file <PATH_TO_FILE> --target local --batch-size 200
```
File format: one video ID per line (newline-delimited).

Existing batch files:
- `.cache/sebasi15-video-ids-smoke.txt` — 40 video IDs (smoke test)
- `.cache/sebasi15-video-ids.txt` — 3075 video IDs (full set)

### Transcript Fetch Only
```bash
pnpm cli transcript fetch --video-id <VIDEO_ID>
pnpm cli transcript fetch --video-id <VIDEO_ID> --out output.json
```

## Options Reference

| Option | Description | Default |
|--------|-------------|---------|
| `--target <target>` | Database target: `local` or `prod` | `local` |
| `--video-id <id...>` | One or more YouTube video IDs | — |
| `--video-ids-file <path>` | Path to newline-delimited video IDs file | — |
| `--url <url...>` | One or more YouTube URLs | — |
| `--batch-size <size>` | Batch size for Supabase upserts | `200` |
| `--checkpoint <path>` | Checkpoint file path | `.cache/ingestion-checkpoint.json` |

## Safety

- **Default target is `local`** — you will NEVER accidentally write to production
- Always use `--target prod` explicitly when writing to the production DiveK database
- Before using `--target prod`, confirm with the user that they want to write to production

## Prerequisites

### For `--target local`:
- Local Supabase must be running: `pnpm supabase:start`
- `.env.local` must have `SUPABASE_LOCAL_URL` and `SUPABASE_LOCAL_SERVICE_ROLE_KEY`

### For `--target prod`:
- `.env.local` must have `SUPABASE_PROD_URL` and `SUPABASE_PROD_SERVICE_ROLE_KEY`
- Production DiveK project: `ghktmekjnhhemovbrkqj`

## Verification Steps

After ingestion, verify data landed correctly:

```sql
-- Check videos
SELECT count(*) FROM videos;

-- Check segments
SELECT count(*) FROM segments WHERE video_id = '<VIDEO_ID>';

-- Check chunks
SELECT count(*) FROM chunks WHERE video_id = '<VIDEO_ID>';

-- Check chunk_terms populated
SELECT count(*) FROM chunk_terms ct
JOIN chunks c ON c.id = ct.chunk_id
WHERE c.video_id = '<VIDEO_ID>';

-- Check chunk_tokens populated
SELECT count(*) FROM chunk_tokens ct
JOIN chunks c ON c.id = ct.chunk_id
WHERE c.video_id = '<VIDEO_ID>';
```

Expected: 10+ segments and 3+ chunks per video, with chunk_terms and chunk_tokens rows.

## Pipeline Flow

1. Fetch transcript (youtube-transcript library)
2. Normalize and upsert to `segments` table (via `videos` parent)
3. Build sliding window chunks
4. Insert chunks to `chunks` table (with `chunk_terms` + `chunk_tokens`)
5. Update checkpoint file (enables resume on interruption)

## Schema (5-table)

```
videos (id text PK, title, duration_sec, metadata)
  └── segments (video_id FK, seq, start_sec, end_sec, text, norm_text)
  └── chunks (video_id FK, chunk_index, chunk_start_sec, chunk_end_sec, full_text, norm_text)
        └── chunk_terms (chunk_id FK, term, first_hit_sec, hit_count, positions)
        └── chunk_tokens (chunk_id FK, idx, token, token_norm, start_sec, end_sec)
```

## Checkpoint / Resume

The pipeline automatically saves progress to a checkpoint file. If interrupted, re-running the same command will skip already-completed videos.

To reset and re-ingest, delete the checkpoint file:
```bash
rm .cache/ingestion-checkpoint.json
```
