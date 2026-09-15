create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_status text not null default 'trial' check (plan_status in ('trial', 'active', 'past_due', 'cancelled')),
  trial_ends_at timestamptz not null default (now() + interval '23 days'),
  delete_scheduled_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profiles (
  user_id text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  first_name text not null,
  last_name text not null default '',
  phone text,
  email text not null,
  role text not null default 'member' check (role in ('owner', 'admin', 'manager', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by text references profiles(user_id) on delete set null,
  first_name text not null,
  last_name text not null default '',
  email text not null,
  phone text,
  company text not null,
  job_title text,
  score integer not null default 50 check (score between 0 and 100),
  status text not null default 'new' check (status in ('new', 'prospecting', 'qualified', 'won', 'lost', 'paused')),
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table if not exists cadences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cadence_steps (
  id uuid primary key default gen_random_uuid(),
  cadence_id uuid not null references cadences(id) on delete cascade,
  step_order integer not null,
  day_offset integer not null default 0,
  type text not null check (type in ('call', 'email', 'whatsapp', 'linkedin', 'research')),
  title text not null,
  instructions text,
  unique (cadence_id, step_order)
);

create table if not exists lead_cadences (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  cadence_id uuid not null references cadences(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'stopped')),
  current_step integer not null default 1,
  started_at timestamptz not null default now(),
  unique (lead_id, cadence_id)
);

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  cadence_step_id uuid references cadence_steps(id) on delete set null,
  assigned_to text references profiles(user_id) on delete set null,
  type text not null check (type in ('call', 'email', 'whatsapp', 'linkedin', 'research')),
  title text not null,
  status text not null default 'pending' check (status in ('pending', 'completed', 'skipped', 'cancelled')),
  due_at timestamptz not null,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists loss_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  unique (organization_id, name)
);

create table if not exists lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  actor_id text references profiles(user_id) on delete set null,
  event_type text not null,
  title text not null,
  body text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists leads_org_score_idx on leads (organization_id, score desc);
create index if not exists leads_org_created_idx on leads (organization_id, created_at desc);
create index if not exists activities_lead_due_idx on activities (lead_id, due_at);
create index if not exists activities_assignee_status_due_idx on activities (assigned_to, status, due_at);
create index if not exists cadences_org_active_idx on cadences (organization_id, active);

create or replace function cleanup_expired_trial_accounts()
returns integer language plpgsql security definer as $$
declare
  expired_org record;
  deleted_count integer := 0;
begin
  for expired_org in
    select id from organizations
    where plan_status = 'trial' and delete_scheduled_at <= now()
  loop
    delete from neon_auth."user" u
    using profiles p
    where p.organization_id = expired_org.id and u.id = p.user_id;

    delete from organizations where id = expired_org.id;
    deleted_count := deleted_count + 1;
  end loop;
  return deleted_count;
end;
$$;
