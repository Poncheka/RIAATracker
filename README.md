# Mogul Gold Tracker

Landing page where anyone connects DistroKid through **Mogul Connect** and sees how close each song and album is to RIAA Gold, Platinum and Diamond.

```
Browser (web/)                        Supabase                               Mogul Connect API
──────────────                        ────────                               ─────────────────
Connect DistroKid ──getToken()──────▶ session-token ── POST /users ───────▶
                                                       POST /sessions/token ▶
Mogul iframe ── onSuccess(sourceId) ▶ source-connected ─ GET /sources/:id ─▶
                                         └─ ingest (background)
                                              GET /sources/reports/:id ─▶ presigned S3 → CSV
                                              parse → US-only monthly rows → usage_monthly
Mogul ── source.updated (Svix) ─────▶ mogul-webhook ─── re-ingest new reports
Results page (polls) ───────────────▶ results ── usage_monthly → RIAA engine → JSON
```

The client secret only lives in Supabase secrets. The browser only ever sees the client ID.

## Layout

| Path | What |
|---|---|
| `supabase/functions/_shared/distrokid.ts` | Statement parser. Tab or comma, loose header matching, store → stream / download / excluded, US filter. |
| `supabase/functions/_shared/riaa.ts` | Certification engine. Shared by the functions and the web app. |
| `supabase/functions/*/index.ts` | `session-token`, `source-connected`, `mogul-webhook`, `results` |
| `supabase/migrations/` | `visitors`, `sources`, `reports`, `usage_monthly` (RLS on, service role only) |
| `web/` | Vite + TypeScript front end (no framework). Runs on sample data when env vars are blank. |
| `sample-data/` | 24 months of fictional DistroKid statements (`node scripts/generate-sample-data.mjs`) |
| `tests/engine.test.ts` | `node --experimental-strip-types --test tests/` |

## RIAA rules implemented

- **Single:** 1 unit = 1 paid download = 150 on-demand US streams. Clean/explicit/edit/radio versions of a title are combined. Remixes and live versions are not merged (RIAA has extra conditions on those).
- **Album:** 1 unit = 1 album download = 10 track downloads = 1,500 on-demand US streams. Any UPC with 3+ ISRCs is treated as an album/EP, and every stream of those ISRCs counts, including the pre-release single's own UPC.
- **Levels:** Gold 500K · Platinum 1M · Multi-Platinum every +1M · Diamond 10M. (RIAA has no Silver; that's the UK's BPI.)
- **Excluded:** non-US, TikTok/Meta/Snap/Content ID (UGC), Peloton/gaming, SiriusXM/programmed radio, unrecognized stores. Totals shown to the user.
- **Pace:** trailing 3-month average units → months to next level.

## Setup

1. **Supabase**
   ```sh
   supabase link --project-ref <ref>
   supabase db push
   cp supabase/.env.example supabase/.env   # fill in
   supabase secrets set --env-file supabase/.env
   supabase functions deploy session-token source-connected results mogul-webhook --no-verify-jwt
   ```
2. **Mogul partner dashboard:** point the webhook at `https://<ref>.supabase.co/functions/v1/mogul-webhook`, copy the `whsec_…` into `MOGUL_WEBHOOK_SECRET`.
3. **Web**
   ```sh
   cd web && cp .env.example .env.local   # VITE_SUPABASE_URL, VITE_MOGUL_CLIENT_ID, VITE_MOGUL_EMBED_ORIGIN
   npm install && npm run dev
   ```
   Deploy `web/` to Vercel/Netlify (build `npm run build`, output `dist`). Set `ALLOWED_ORIGIN` in Supabase to that domain.

## Open questions for the Mogul API team

These were guessed defensively and are easy to change in `_shared/mogul.ts`:

1. ~~Sandbox host~~ Resolved: production credentials, `api.usemogul.com` + `embed.usemogul.com`.
2. **`POST /users` body** — what's the unique-ID field called? (`MOGUL_USER_ID_FIELD`, default `externalId`.) And response shape (`id` vs `userId`).
3. **`POST /sessions/token`** — response key (`sessionToken` vs `token`).
4. ~~Report format~~ Resolved: DistroKid's own export format.
5. **Ownership check** — can `GET /sources/:id` return the owning user so `source-connected` can confirm the visitor really owns the source?
6. **Album titles / release dates** — DistroKid statements have neither. A catalog endpoint would let us name albums properly and start counting at release date.
