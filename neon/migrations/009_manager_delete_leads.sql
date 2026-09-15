update organization_settings
set role_permissions = jsonb_set(jsonb_set(role_permissions, '{admin,delete_leads}', 'true'::jsonb, true), '{manager,delete_leads}', 'true'::jsonb, true),
    updated_at = now();
