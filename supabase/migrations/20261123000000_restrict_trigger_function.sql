-- The updated_at trigger function never needs to be called directly by API roles.
-- (Postgres checks EXECUTE only when creating a trigger, not when it fires, so the
-- trigger keeps working.)
revoke execute on function public.items_set_updated_at() from public, anon, authenticated;
