-- Mnémon: categories become rows owned by each user, so new ones can be added from
-- the app, and an item can belong to one or more categories (item_categories).
-- The four former fixed categories are created for every user (existing users now,
-- new users by trigger), and each existing item keeps its category.

-- --- categories ------------------------------------------------------------------
create table public.categories (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  label       text        not null check (char_length(label) between 1 and 40 and label = btrim(label)),
  created_at  timestamptz not null default now(),
  -- Target of the composite foreign key from item_categories: an item can only be
  -- filed under a category that belongs to the same user.
  unique (id, user_id)
);

-- One label per user, case-insensitive ("Films" and "films" are the same category).
create unique index categories_user_label_idx on public.categories (user_id, lower(label));

revoke all on table public.categories from anon, authenticated;
grant select on table public.categories to authenticated;
grant insert (label) on table public.categories to authenticated;

alter table public.categories enable row level security;

create policy "Owner can read their categories"
on public.categories for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Owner can add categories"
on public.categories for insert to authenticated
with check ((select auth.uid()) = user_id);

-- --- default categories ---------------------------------------------------------------
-- Created in this order, so ordering by id keeps the former display order.
insert into public.categories (user_id, label)
select u.id, d.label
from auth.users u
cross join (values (1, 'À faire'), (2, 'À investiguer'), (3, 'À lire'), (4, 'À regarder')) as d (pos, label)
order by u.id, d.pos;

create function public.seed_default_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.categories (user_id, label)
  select new.id, d.label
  from (values (1, 'À faire'), (2, 'À investiguer'), (3, 'À lire'), (4, 'À regarder')) as d (pos, label)
  order by d.pos;
  return new;
end;
$$;

revoke execute on function public.seed_default_categories() from public, anon, authenticated;

create trigger on_auth_user_created_seed_categories
after insert on auth.users
for each row execute function public.seed_default_categories();

-- --- item_categories: which categories each item is filed under -----------------------
-- Target of the composite foreign key below.
alter table public.items add constraint items_id_user_key unique (id, user_id);

create table public.item_categories (
  item_id      bigint not null,
  category_id  bigint not null,
  user_id      uuid   not null default auth.uid(),
  primary key (item_id, category_id),
  -- Both sides must belong to the row's owner, so nobody can link someone else's item
  -- or category. Deleting an item removes its links; a category in use cannot be deleted.
  foreign key (item_id, user_id) references public.items (id, user_id) on delete cascade,
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete restrict
);

-- The primary key already serves lookups by item; this one serves the category side.
create index item_categories_category_idx on public.item_categories (category_id, user_id);

revoke all on table public.item_categories from anon, authenticated;
grant select, delete on table public.item_categories to authenticated;
grant insert (item_id, category_id) on table public.item_categories to authenticated;

alter table public.item_categories enable row level security;

create policy "Owner can read their item categories"
on public.item_categories for select to authenticated
using ((select auth.uid()) = user_id);

create policy "Owner can add item categories"
on public.item_categories for insert to authenticated
with check ((select auth.uid()) = user_id);

create policy "Owner can remove item categories"
on public.item_categories for delete to authenticated
using ((select auth.uid()) = user_id);

-- --- existing items keep their category --------------------------------------------
insert into public.item_categories (item_id, category_id, user_id)
select i.id, c.id, i.user_id
from public.items i
join public.categories c
  on c.user_id = i.user_id
 and c.label = case i.category
   when 'todo' then 'À faire'
   when 'investigate' then 'À investiguer'
   when 'read' then 'À lire'
   when 'watch' then 'À regarder'
 end;

drop index public.items_user_category_idx;
alter table public.items drop column category;
create index items_user_idx on public.items (user_id, done, created_at desc);

-- --- every item has at least one category ----------------------------------------------
-- Checked at commit time (deferred), so an item and its categories can be written in
-- one transaction, in any order. The check functions are only called by the triggers.
create function public.items_check_has_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target bigint;
begin
  if tg_table_name = 'items' then
    target := new.id;
  else
    target := old.item_id;
  end if;
  if exists (select 1 from public.items where id = target)
     and not exists (select 1 from public.item_categories where item_id = target) then
    raise exception 'An item needs at least one category (item %)', target
      using errcode = '23514', constraint = 'items_need_category';
  end if;
  return null;
end;
$$;

revoke execute on function public.items_check_has_category() from public, anon, authenticated;

create constraint trigger items_need_category
after insert on public.items
deferrable initially deferred
for each row execute function public.items_check_has_category();

create constraint trigger item_categories_keep_one
after delete on public.item_categories
deferrable initially deferred
for each row execute function public.items_check_has_category();

-- --- API: write an item and its categories in one request (one transaction) ----------
-- security invoker: they run with the caller's privileges and row-level security, so
-- they cannot do anything the caller could not do with separate requests.
create function public.create_item(p_title text, p_url text, p_category_ids bigint[])
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_id bigint;
begin
  insert into public.items (title, url) values (p_title, p_url) returning id into new_id;
  insert into public.item_categories (item_id, category_id)
  select new_id, c from unnest(p_category_ids) as c group by c;
  return new_id;
end;
$$;

create function public.update_item(p_id bigint, p_title text, p_url text, p_category_ids bigint[])
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.items set title = p_title, url = p_url where id = p_id;
  if not found then
    raise exception 'Item % not found', p_id using errcode = 'P0002';
  end if;
  delete from public.item_categories
  where item_id = p_id and category_id <> all (coalesce(p_category_ids, '{}'));
  insert into public.item_categories (item_id, category_id)
  select p_id, c from unnest(p_category_ids) as c group by c
  on conflict do nothing;
  return p_id;
end;
$$;

revoke execute on function public.create_item(text, text, bigint[]) from public, anon;
revoke execute on function public.update_item(bigint, text, text, bigint[]) from public, anon;
grant execute on function public.create_item(text, text, bigint[]) to authenticated;
grant execute on function public.update_item(bigint, text, text, bigint[]) to authenticated;
