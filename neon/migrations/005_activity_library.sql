create table if not exists activity_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  type text not null check (type in ('call','email','whatsapp','linkedin','instagram','in_person','meeting','research','custom')),
  instructions text not null default '',
  email_subject text,
  email_body text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

alter table cadence_steps add column if not exists template_id uuid references activity_templates(id) on delete set null;

alter table activities add column if not exists activity_template_id uuid references activity_templates(id) on delete set null;
alter table activities add column if not exists email_subject text;
alter table activities add column if not exists email_body text;

insert into activity_templates (organization_id,name,type,instructions)
select distinct c.organization_id,s.title,s.type,coalesce(s.instructions,'')
from cadence_steps s join cadences c on c.id=s.cadence_id
on conflict (organization_id,name) do nothing;

update cadence_steps s set template_id=t.id
from cadences c, activity_templates t
where c.id=s.cadence_id and t.organization_id=c.organization_id and t.name=s.title and t.type=s.type and s.template_id is null;

create index if not exists activity_templates_org_active_idx on activity_templates(organization_id,active,type);
