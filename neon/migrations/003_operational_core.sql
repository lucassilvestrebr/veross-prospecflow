alter table cadence_steps add column if not exists suggested_time time not null default '09:00';
alter table leads add column if not exists loss_reason_id uuid references loss_reasons(id) on delete set null;
alter table leads add column if not exists archived_at timestamptz;

alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check
  check (status in ('new', 'prospecting', 'connected', 'qualified', 'won', 'lost', 'paused', 'archived'));

create table if not exists organization_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  weekly_goal integer not null default 100 check (weekly_goal >= 0),
  work_days integer[] not null default array[1,2,3,4,5],
  work_start time not null default '08:00',
  work_end time not null default '18:00',
  custom_fields jsonb not null default '[]'::jsonb,
  score_rules text not null default 'Defina o score de 0 a 100 conforme aderência e intenção.',
  feedback_prompt text not null default 'A reunião gerou uma oportunidade qualificada?',
  blocklist jsonb not null default '[]'::jsonb,
  default_role text not null default 'member' check (default_role in ('admin', 'manager', 'member')),
  updated_at timestamptz not null default now()
);

insert into organization_settings (organization_id)
select id from organizations on conflict do nothing;

insert into cadence_steps (cadence_id, step_order, day_offset, type, title, instructions, suggested_time)
select c.id, s.step_order, s.day_offset, s.type, s.title, s.instructions, s.suggested_time::time
from cadences c
cross join (values
  (1, 0, 'research', 'Pesquisa e contexto', 'Valide empresa, cargo e sinais de aderência.', '08:30'),
  (2, 0, 'call', 'Ligação 1 · Abertura', 'Confirme contexto e responsabilidade.', '10:00'),
  (3, 1, 'email', 'E-mail 1 · Contexto', 'Envie uma mensagem curta com hipótese de valor.', '14:00'),
  (4, 3, 'linkedin', 'LinkedIn · Conexão', 'Interaja e envie convite personalizado.', '11:00'),
  (5, 5, 'whatsapp', 'WhatsApp · Retomada', 'Use apenas quando houver número corporativo válido.', '15:00'),
  (6, 8, 'call', 'Ligação 2 · Diagnóstico', 'Explore prioridade, cenário e próximo passo.', '10:30')
) as s(step_order, day_offset, type, title, instructions, suggested_time)
where not exists (select 1 from cadence_steps cs where cs.cadence_id = c.id);
