-- Cada reabertura inicia uma nova jornada, mesmo quando reutiliza a mesma cadência.
alter table lead_cadences add column if not exists journey_number integer not null default 1;

alter table lead_cadences drop constraint if exists lead_cadences_lead_id_cadence_id_key;
create unique index if not exists lead_cadences_lead_cadence_journey_key
  on lead_cadences (lead_id, cadence_id, journey_number);

alter table activities add column if not exists lead_cadence_id uuid references lead_cadences(id) on delete set null;

update activities a
set lead_cadence_id = (
  select lc.id
  from lead_cadences lc
  left join cadence_steps cs on cs.id = a.cadence_step_id
  where lc.lead_id = a.lead_id
    and (cs.cadence_id = lc.cadence_id or a.cadence_step_id is null)
  order by lc.started_at desc
  limit 1
)
where a.lead_cadence_id is null;

create index if not exists activities_lead_cadence_idx on activities (lead_cadence_id, due_at);
