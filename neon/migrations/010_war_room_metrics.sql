alter table leads add column if not exists won_at timestamptz;
alter table leads add column if not exists lost_at timestamptz;
update leads set won_at=coalesce(won_at,updated_at,created_at) where status='won';
update leads set lost_at=coalesce(lost_at,updated_at,created_at) where status='lost';
alter table organization_settings add column if not exists monthly_gain_goal integer not null default 10;
