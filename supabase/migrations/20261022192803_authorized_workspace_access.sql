-- Workspace provisioning belongs to a trusted administrator connection.
-- Authentication alone must never let a caller become a workspace Admin.
revoke execute on function public.create_workspace(text) from public, anon, authenticated;
grant execute on function public.create_workspace(text) to service_role;
