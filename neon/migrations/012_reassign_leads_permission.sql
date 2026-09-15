update organization_settings
set role_permissions = jsonb_set(
  jsonb_set(
    jsonb_set(role_permissions, '{admin,reassign_leads}', 'true'::jsonb, true),
    '{manager,reassign_leads}', 'true'::jsonb, true
  ),
  '{member,reassign_leads}', 'false'::jsonb, true
), updated_at = now();

alter table organization_settings alter column role_permissions set default
'{"admin":{"view_all_leads":true,"delete_leads":true,"import_leads":true,"create_leads":true,"reassign_leads":true,"access_war_room":true,"manage_cadences":true,"manage_users":true},"manager":{"view_all_leads":true,"delete_leads":true,"import_leads":true,"create_leads":true,"reassign_leads":true,"access_war_room":true,"manage_cadences":true,"manage_users":false},"member":{"view_all_leads":false,"delete_leads":false,"import_leads":false,"create_leads":true,"reassign_leads":false,"access_war_room":false,"manage_cadences":false,"manage_users":false}}'::jsonb;
