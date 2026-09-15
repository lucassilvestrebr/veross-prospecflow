alter table cadences add column if not exists focus text not null default 'outbound'
  check (focus in ('inbound_active','inbound_passive','outbound','other'));
alter table cadences add column if not exists priority text not null default 'normal'
  check (priority in ('low','normal','high'));
alter table cadences add column if not exists automatic_loss_days integer not null default 0
  check (automatic_loss_days >= 0);
alter table cadences add column if not exists automatic_loss_reason_id uuid references loss_reasons(id) on delete set null;
alter table lead_cadences add column if not exists completed_at timestamptz;
