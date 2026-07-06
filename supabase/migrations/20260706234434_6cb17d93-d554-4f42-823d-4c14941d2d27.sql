-- sync_user_emails é uma trigger function; não precisa ser chamável externamente.
REVOKE EXECUTE ON FUNCTION public.sync_user_emails() FROM PUBLIC, anon, authenticated;