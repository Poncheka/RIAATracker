-- RIAA tracker schema. All access goes through Edge Functions using the
-- service role; RLS is on with no policies, so the anon key can read nothing.

create table if not exists public.visitors (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,           -- random id the browser keeps
  mogul_user_id text,                          -- from POST /sessions
  created_at timestamptz not null default now()
);

create table if not exists public.sources (
  id bigint primary key,                       -- Mogul sourceId
  visitor_id uuid not null references public.visitors(id) on delete cascade,
  mogul_account_id text,
  target text not null default 'DISTROKID',
  identity jsonb,
  sync_status text,
  last_sync timestamptz,
  results_token uuid not null unique default gen_random_uuid(), -- shareable results link
  last_ingested_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id bigint primary key,                       -- Mogul report id
  source_id bigint not null references public.sources(id) on delete cascade,
  period text,
  cadence text,
  file_name text,
  status text not null default 'pending',      -- pending | ingested | failed
  error text,
  row_count int,
  excluded jsonb,                              -- ExcludedSummary for this file
  warnings text[],
  ingested_at timestamptz
);
create index if not exists reports_source_status_idx on public.reports (source_id, status);

-- US-only monthly usage per ISRC+UPC, already filtered to RIAA-eligible stores.
create table if not exists public.usage_monthly (
  source_id bigint not null references public.sources(id) on delete cascade,
  report_id bigint not null references public.reports(id) on delete cascade,
  period text not null,
  isrc text not null default '',
  upc text not null default '',
  title text,
  artist text,
  album text,
  streams bigint not null default 0,
  track_downloads bigint not null default 0,
  album_downloads bigint not null default 0,
  primary key (report_id, period, isrc, upc)
);
create index if not exists usage_monthly_source_idx on public.usage_monthly (source_id);

alter table public.visitors enable row level security;
alter table public.sources enable row level security;
alter table public.reports enable row level security;
alter table public.usage_monthly enable row level security;
