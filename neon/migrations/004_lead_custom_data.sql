alter table leads add column if not exists custom_data jsonb not null default '{}'::jsonb;
