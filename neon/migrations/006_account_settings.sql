alter table organization_settings add column if not exists email_sender_name text not null default '';
alter table organization_settings add column if not exists email_reply_to text not null default '';
