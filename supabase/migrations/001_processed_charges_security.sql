create extension if not exists pgcrypto;

create table if not exists public.processed_charges (
    charge_id text primary key,
    user_id text not null,
    product text not null,
    created_at timestamptz not null default now()
);

create unique index if not exists processed_charges_charge_id_unique
    on public.processed_charges (charge_id);

create index if not exists processed_charges_user_id_idx
    on public.processed_charges (user_id);

alter table public.processed_charges enable row level security;

revoke all
    on table public.processed_charges
    from anon;

revoke all
    on table public.processed_charges
    from authenticated;
