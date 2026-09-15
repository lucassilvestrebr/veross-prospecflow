alter table organizations add column if not exists stripe_customer_id text;
alter table organizations add column if not exists stripe_subscription_id text;
alter table organizations add column if not exists licensed_seats integer not null default 1;

alter table profiles add column if not exists status text not null default 'active';
alter table profiles add column if not exists deleted_at timestamptz;
alter table profiles drop constraint if exists profiles_status_check;
alter table profiles add constraint profiles_status_check check (status in ('active','suspended','deleted'));

create table if not exists user_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  role text not null default 'member' check (role in ('admin','manager','member')),
  token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','accepted','cancelled')),
  invited_by text references profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  unique (organization_id,email)
);

alter table organization_settings add column if not exists daily_activity_goal integer not null default 20;
alter table organization_settings add column if not exists conversion_goal_pct numeric(5,2) not null default 10;
alter table organization_settings add column if not exists meeting_goal integer not null default 5;
alter table organization_settings add column if not exists score_rules_v2 jsonb not null default '[]'::jsonb;
alter table organization_settings add column if not exists role_permissions jsonb not null default '{"admin":{"view_all_leads":true,"delete_leads":true,"import_leads":true,"create_leads":true,"access_war_room":true,"manage_cadences":true,"manage_users":true},"manager":{"view_all_leads":true,"delete_leads":false,"import_leads":true,"create_leads":true,"access_war_room":true,"manage_cadences":true,"manage_users":false},"member":{"view_all_leads":false,"delete_leads":false,"import_leads":false,"create_leads":true,"access_war_room":false,"manage_cadences":false,"manage_users":false}}'::jsonb;

create index if not exists user_invites_org_status_idx on user_invites(organization_id,status);

alter table organization_settings alter column feedback_prompt set default 'A reunião resultou em ganho?';
update organization_settings set feedback_prompt='A reunião resultou em ganho?' where feedback_prompt='A reunião gerou uma oportunidade qualificada?';
