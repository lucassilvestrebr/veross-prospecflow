create unique index if not exists leads_org_email_normalized_uidx
  on leads (organization_id, lower(trim(email)));

create table if not exists lead_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  uploaded_by text references profiles(user_id) on delete set null,
  assigned_to text references profiles(user_id) on delete set null,
  cadence_id uuid references cadences(id) on delete set null,
  file_name text,
  total_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists lead_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references lead_imports(id) on delete cascade,
  row_number integer not null,
  email text,
  status text not null check (status in ('accepted','rejected')),
  reason text,
  lead_id uuid references leads(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_imports_org_created_idx on lead_imports (organization_id, created_at desc);
create index if not exists lead_import_rows_import_idx on lead_import_rows (import_id, row_number);
