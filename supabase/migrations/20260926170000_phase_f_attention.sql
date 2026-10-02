-- Phase F: Attention / Productivity Model

alter table public.activities
add column if not exists focus_demand numeric(4,2) not null default 0;

alter table public.activities
drop constraint if exists activities_focus_demand_range;

alter table public.activities
add constraint activities_focus_demand_range
check (focus_demand >= 0 and focus_demand <= 5);
