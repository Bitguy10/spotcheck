# SpotCheck

**Know the vibe before you walk in.**

SpotCheck is a live, crowdsourced venue vibe-checking app. Instead of stale star ratings or
scraped reviews, people physically check in at a venue and tap a single gauge to report how it
feels *right now*. Vibe data decays automatically, so a venue's public score always reflects the
current moment — never a lifetime average.

Core differentiator: **live, GPS-verified, decaying, crowd-powered.** Not AI-summarized reviews,
not static ratings.

Single codebase → iOS, Android, and Web (Expo + NativeWind + Reanimated), backed by Supabase.

---

## Run it now (zero setup — demo mode)

With no Supabase credentials configured the app runs in **demo mode**: a complete, self-simulating
implementation of the same data contract. Venues are seeded relative to wherever you are, other
"people" check in on a timer, scores decay in real time, and Realtime-style events flow through.

```bash
npm install
npm run web          # dev server (web)
# or build the production web bundle and serve it:
npm run web:export
npm run serve:web    # http://localhost:8081
```

Every feature works in demo mode — it is the same UI and same math, just with an in-memory backend.

## Point it at real infrastructure

```bash
cp .env.example .env   # fill EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY

# Apply schema + RPC trust layer + optional seed, using only a DB connection
# string (no Supabase CLI login required):
DATABASE_URL="postgresql://user:pass@host:6543/postgres" node tools/apply-schema.mjs
```

The admin scripts in `tools/` (`apply-schema`, `apply-one`, `backfill-history`, `verify-server`)
read `DATABASE_URL` from the environment or from `.env`. `.env` is git-ignored — no credential is
ever committed; see `.env.example` for the full list of variables.

That's the whole server setup: the migrations create the tables, the decay math, and the
**SECURITY DEFINER RPC trust layer** (`submit_checkin`, `upsert_osm_venues`) — the Postgres
equivalent of the Deno Edge Functions, deployable with nothing but the connection string.

If you *do* have a Supabase CLI access token and prefer Deno Edge Functions, they live in
`supabase/functions/{checkin,vibe-score,sync-venues}` and `supabase-backend.ts` can be pointed at
them; the RPCs and the functions enforce the identical rules.

Auth is **email + password only** (no magic link, no SMS OTP). Discovery is not gated on auth; only
submitting a check-in requires an account. If your project has "Confirm email" enabled, confirm the
address (or disable it in Auth settings) before signing in.

---

## The model

A venue's public gauge is a **weighted recency average** over check-ins that are still active:

```
weight(age) = (1 - age/window)^2     window = 45 min (30–60 in spec)
score       = Σ weight·value / Σ weight
```

* A fresh tap has weight 1; weight slides quadratically to 0 at the cutoff, then drops out.
* A venue publishes a score only with **≥ 2 active check-ins** — one person's opinion is never
  consensus ("Not enough data yet").
* A venue is **live** (breathing dot) when its newest check-in is under 10 minutes old.
* Scores are **always computed server-side** — the Postgres function `vibe_score_for_venue`
  (`supabase/migrations/0001_schema.sql`) is the authority, exposed to the client via RPC. The TS
  mirror in `src/lib/vibe.ts` exists only for demo mode, optimistic UI, and tests.

**GPS gate:** the `submit_checkin` SECURITY DEFINER RPC (and its Deno twin `checkin`) re-measures
the distance between the posted coordinates and the venue's own lat/lng and rejects anything outside
the 150 m grace radius. A lying client loses. (Demo mode has a clearly-labelled "I'm at the door"
bypass; production never does.)

**Discovery:** OpenStreetMap via the Overpass API is the *seed* source only. Venues are pulled once
and cached into our own `venues` table; every read after is served from Postgres. The query is
"these categories within a radius of these coordinates" — global by construction, no region
allowlist anywhere.

**Realtime:** Postgres change subscriptions on `checkins` (never polling). A check-in anywhere
patches the affected row and the live counter in real time.

---

## Design system

* Dark base `#12131A` (charcoal-navy, not pure black); light base `#F5F3EF` (warm off-white).
* Vibe spectrum, identical in both themes: chill `#4ECDC4` → moderate `#FFD166` → hot `#FF5A5F`.
* Typography: **Space Grotesk** (display — scores, venue names) + **Inter** (body/metadata).
* Light / Dark / **System** theme modes with a manual toggle; the red↔teal scale stays consistent.
* Signature element: a gently **breathing pulse dot** beside any venue with a check-in in the last
  10 minutes. Everything else stays still.
* Layout: a scrollable **pulse strip** — each venue is one row that *is* a gauge (dot position on
  the red↔teal bar), more scannable than cards. Web shows strip + persistent map side by side.
* **Logo:** a location pin whose dot is a live radar (staggered teal/red pings), doubling as the map
  pin. See `assets/logo.svg` and `src/components/Logo.tsx`.

---

## Structure

```
app/                      Expo Router screens
  index.tsx               landing (live pulse-strip hero + counter)
  (app)/index.tsx         dashboard (pulse strip + map)
  (app)/venue/[id].tsx    venue detail (big gauge + tag breakdown + mini-feed)
  (app)/checkin/[id].tsx  check-in flow (GPS gate → gauge tap → chips → toast)
  (auth)/login|signup.tsx email+password auth
  settings.tsx            theme + account + data provenance
src/lib/                  vibe engine, geo, tags, filters, time, config, supabase
src/data/                 backend interface + demo + supabase + overpass
src/hooks/                useLocation / useVenues / useVenueDetail / useAuth / useLiveCount
src/components/           Logo, PulseDot, VibeGauge, VibeMeter, PulseStripRow, VibeMap, FilterRow…
src/theme/                tokens + ThemeProvider (Light/Dark/System)
supabase/                 migrations (decay math + RLS) + Edge Functions (checkin/vibe-score/sync-venues)
tests/                    unit tests for the vibe engine + filters
tools/                    logo rasteriser + static preview server
```

## Scripts

| command | purpose |
|---|---|
| `npm run web` | Metro dev server (web) |
| `npm run ios` / `npm run android` | native dev |
| `npm run web:export` | production web bundle → `dist/` |
| `npm run serve:web` | serve `dist/` with SPA fallback (0.0.0.0:8081) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (vibe engine + filters) |
| `node tools/build-logo.mjs` | rasterise the logo into the icon set |

## Maps

Default is an offline, dependency-free **schematic SVG map** (works in the web preview and offline,
same coordinates + colour scale). Set `EXPO_PUBLIC_USE_NATIVE_MAPS=1` on native for real
react-native-maps tiles; on production web swap in Leaflet / Mapbox GL JS.

## Wave 2 (delivered): Trust & Retention + Growth

* **Anti-abuse rate limiting** — enforced *inside* `submit_checkin`: max 3 check-ins per user per
  venue per hour. Verified live: the 4th in-hour post returns `{"code":"rate_limited"}`. The client
  surfaces a friendly "the vibe's already live" message.
* **Saved / favorite venues** — `favorites` table with per-user RLS; heart on the venue page and a
  "♥ Saved" filter on the dashboard. Persists across sessions (and in demo mode via AsyncStorage).
* **Shareable vibe cards** — a screenshot-friendly, always-dark brand card (`ShareCard`) shown in a
  share sheet with Copy-link / native Share. `supabase/migrations/0003_trust_retention.sql`.

## Wave 3 (delivered): Growth — history + events

* **Historical vibe patterns** — `venue_vibe_history` aggregates the verified signal by
  day-of-week × hour; the venue page shows a "Typically … Usually Heaving on Fri" heat strip.
  Complementary to "now": the live gauge decays, the pattern persists (see `w3-history.png`).
* **Event check-ins** — ephemeral spots via the `create_event` RPC (auth-gated): a pop-up/set/market
  with a TTL appears on the map with an "EVENT · 3h left" badge, then `venues_with_vibe` drops it
  once expired. `supabase/migrations/0004_growth.sql`. `tools/backfill-history.mjs` seeds a believable
  multi-week history for demos.

## Deploy to Vercel

The web target is a static export, so Vercel runs no server — `vercel.json` already declares the
build:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Build command | `npx expo export --platform web` |
| Output directory | `dist` |
| Node.js version | 20 (`.nvmrc`, `engines` in `package.json`) |

Set these as **build** environment variables. Metro inlines every `EXPO_PUBLIC_*` value at export
time, so setting them as runtime-only variables has no effect on the bundle:

* `EXPO_PUBLIC_SUPABASE_URL`
* `EXPO_PUBLIC_SUPABASE_ANON_KEY`

```bash
npm i -g vercel
vercel link                                              # or: vercel link --project spotcheck
vercel env add EXPO_PUBLIC_SUPABASE_URL production
vercel env add EXPO_PUBLIC_SUPABASE_ANON_KEY production
vercel --prod
```

Then in Supabase → Authentication → URL Configuration, add the deployed URL as the **Site URL**
(and to the redirect allow-list) or auth redirects will land on localhost.

`dist/` is git-ignored, so every push rebuilds. The catch-all rewrite sends unknown paths to
`index.html`, which is what lets deep links like `/venue/<id>` resolve client-side — the same
fallback `tools/serve-dist.mjs` provides locally.

## Explicitly deferred (later waves)

Advanced filters, push notifications, owner claims, streaks / reputation, friends/following,
"going out tonight" shortlists, browser extension, phone/SMS auth.

Out of scope: AI review summarization, feed-first home, open anonymous check-ins, flat averaging.
