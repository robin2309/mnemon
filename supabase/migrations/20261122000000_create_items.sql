-- Mnémon: items table, owned by the signed-in Supabase user.
--
-- The front end talks to this table directly with the publishable key. That key is
-- public by design: everything below makes it useless without a valid user session.
--   * anon (not signed in) has no privilege at all on the table;
--   * authenticated users only see and change their own rows (RLS on user_id);
--   * only title / url / category / done can be written by the client; id, owner and
--     timestamps are set by the database.

create table public.items (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  title       text        not null check (char_length(title) between 1 and 200 and title = btrim(title)),
  url         text        check (url is null or (char_length(url) <= 2048 and url ~* '^https?://\S+$')),
  category    text        not null check (category in ('todo', 'investigate', 'read', 'watch')),
  done        boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index items_user_category_idx on public.items (user_id, category, done, created_at desc);

-- updated_at is maintained by the database, whatever the client sends.
create function public.items_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger items_set_updated_at
before update on public.items
for each row execute function public.items_set_updated_at();

-- --- Privileges ---------------------------------------------------------------
revoke all on table public.items from anon, authenticated;
grant select, delete on table public.items to authenticated;
grant insert (title, url, category, done) on table public.items to authenticated;
grant update (title, url, category, done) on table public.items to authenticated;

-- --- Row-level security -------------------------------------------------------
alter table public.items enable row level security;

create policy "Owner can read their items"
on public.items for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Owner can add items"
on public.items for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Owner can update their items"
on public.items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Owner can delete their items"
on public.items for delete to authenticated
using ((select auth.uid()) = user_id);
