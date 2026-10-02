-- Daily energy rating for the Day view's Reflection section.
--
-- "How energetic did you feel today?" on a 1-7 scale, stored on the day's review row
-- (period_type = 'day'). Deliberately separate from sleep_logs.energy, which is a 1-5
-- "how did you feel on waking" rating from the Sleep check-in: different moment,
-- different scale, different question. Week/month review rows leave it null.
--
-- Additive and idempotent: nullable column, no backfill, no change to existing rows.

alter table public.reviews add column if not exists energy smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reviews_energy_range' and conrelid = 'public.reviews'::regclass
  ) then
    alter table public.reviews
      add constraint reviews_energy_range check (energy is null or energy between 1 and 7);
  end if;
end $$;

comment on column public.reviews.energy is
  'Day reviews only: self-rated energy across the day, 1 (drained) to 7 (buzzing). Null = not rated.';
