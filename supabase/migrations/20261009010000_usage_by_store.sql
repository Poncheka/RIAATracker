-- Same US-only eligible usage as usage_monthly, broken out by store (DSP).
-- Needed for the RIAA package's "sales summary by DSP".
create table if not exists public.usage_by_store (
  source_id bigint not null references public.sources(id) on delete cascade,
  report_id bigint not null references public.reports(id) on delete cascade,
  period text not null,
  isrc text not null default '',
  upc text not null default '',
  store text not null,
  title text,
  artist text,
  streams bigint not null default 0,
  track_downloads bigint not null default 0,
  album_downloads bigint not null default 0,
  primary key (report_id, period, isrc, upc, store)
);
create index if not exists usage_by_store_source_idx on public.usage_by_store (source_id);
alter table public.usage_by_store enable row level security;
