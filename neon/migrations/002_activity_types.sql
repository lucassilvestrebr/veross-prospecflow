alter table cadence_steps drop constraint if exists cadence_steps_type_check;
alter table cadence_steps add constraint cadence_steps_type_check
  check (type in ('call', 'email', 'whatsapp', 'linkedin', 'instagram', 'in_person', 'meeting', 'research', 'custom'));

alter table activities drop constraint if exists activities_type_check;
alter table activities add constraint activities_type_check
  check (type in ('call', 'email', 'whatsapp', 'linkedin', 'instagram', 'in_person', 'meeting', 'research', 'custom'));
