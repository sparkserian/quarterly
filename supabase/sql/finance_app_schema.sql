create extension if not exists pgcrypto;

create table if not exists public.finance_app_workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_name text not null default 'My Finance Board',
  planner_state jsonb not null,
  theme text not null default 'dark' check (theme in ('light', 'dark')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  last_synced_at timestamptz not null default timezone('utc', now()),
  unique (user_id)
);

create or replace function public.finance_app_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists finance_app_workspaces_set_updated_at on public.finance_app_workspaces;

create trigger finance_app_workspaces_set_updated_at
before update on public.finance_app_workspaces
for each row
execute function public.finance_app_set_updated_at();

alter table public.finance_app_workspaces enable row level security;

drop policy if exists "finance_app_workspaces_select_own" on public.finance_app_workspaces;
create policy "finance_app_workspaces_select_own"
on public.finance_app_workspaces
for select
using (auth.uid() = user_id);

drop policy if exists "finance_app_workspaces_insert_own" on public.finance_app_workspaces;
create policy "finance_app_workspaces_insert_own"
on public.finance_app_workspaces
for insert
with check (auth.uid() = user_id);

drop policy if exists "finance_app_workspaces_update_own" on public.finance_app_workspaces;
create policy "finance_app_workspaces_update_own"
on public.finance_app_workspaces
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "finance_app_workspaces_delete_own" on public.finance_app_workspaces;
create policy "finance_app_workspaces_delete_own"
on public.finance_app_workspaces
for delete
using (auth.uid() = user_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'finance_app_workspaces'
  ) then
    execute 'alter publication supabase_realtime add table public.finance_app_workspaces';
  end if;
end;
$$;
