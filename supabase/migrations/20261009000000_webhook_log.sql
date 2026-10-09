-- Every webhook delivery attempt, so failed deliveries can be debugged.
create table if not exists public.webhook_events (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  msg_id text,
  event_type text,
  source_id bigint,
  outcome text not null,          -- ok | bad_signature | unknown_source | error
  detail text,
  headers jsonb,
  body text
);
alter table public.webhook_events enable row level security;
