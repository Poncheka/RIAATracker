-- Mogul's POST /connect/v1/sessions now requires the end user's email.
alter table public.visitors add column if not exists email text;
