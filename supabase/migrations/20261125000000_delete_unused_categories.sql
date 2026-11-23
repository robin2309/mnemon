-- Mnémon: a user can delete their own categories, but only those no item uses.
-- The refusal comes from the existing foreign key item_categories → categories
-- (on delete restrict): deleting a category that still has links fails with 23503.
-- Renaming stays impossible (no update grant).

grant delete on table public.categories to authenticated;

create policy "Owner can delete their categories"
on public.categories for delete to authenticated
using ((select auth.uid()) = user_id);
