create table if not exists webhook_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null default 'alessia_flow' check (provider in ('alessia_flow')),
  name text not null,
  cadence_id uuid not null references cadences(id) on delete restrict,
  assigned_to text not null references profiles(user_id) on delete restrict,
  webhook_key uuid not null default gen_random_uuid() unique,
  secret_hash text not null,
  active boolean not null default true,
  created_by text references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references webhook_integrations(id) on delete cascade,
  external_reference text,
  status text not null check (status in ('created', 'duplicate', 'rejected', 'failed')),
  message text,
  lead_id uuid references leads(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create unique index if not exists webhook_events_integration_external_reference_idx
  on webhook_events (integration_id, external_reference)
  where external_reference is not null;
create index if not exists webhook_events_integration_received_idx
  on webhook_events (integration_id, received_at desc);
