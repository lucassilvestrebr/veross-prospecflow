create table if not exists feedback_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid not null references leads(id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'pending' check (status in ('pending','responded')),
  created_by text references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (lead_id)
);

create table if not exists feedback_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references feedback_requests(id) on delete cascade,
  had_meeting boolean not null,
  meeting_date date,
  accepted_as_client boolean,
  priority_now boolean,
  has_pain boolean,
  has_budget boolean,
  spoke_to_decision_maker boolean,
  observation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into feedback_requests (organization_id,lead_id,created_by)
select organization_id,id,created_by from leads where status='won'
on conflict (lead_id) do nothing;

create index if not exists feedback_requests_org_status_idx on feedback_requests(organization_id,status,created_at desc);
