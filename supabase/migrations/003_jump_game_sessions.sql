create extension if not exists pgcrypto;

create table if not exists public.jump_game_sessions (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    pair_code text not null,
    started_at timestamptz not null default now(),
    expires_at timestamptz not null
        default (now() + interval '30 minutes'),
    completed_at timestamptz,
    submitted_score integer,
    created_at timestamptz not null default now(),

    constraint jump_game_sessions_score_check
        check (
            submitted_score is null
            or (
                submitted_score >= 0
                and submitted_score <= 100000
            )
        )
);

create index if not exists jump_game_sessions_user_idx
    on public.jump_game_sessions (
        user_id,
        started_at desc
    );

create index if not exists jump_game_sessions_expiry_idx
    on public.jump_game_sessions (
        expires_at
    );

alter table public.jump_game_sessions
    enable row level security;

revoke all
    on table public.jump_game_sessions
    from anon;

revoke all
    on table public.jump_game_sessions
    from authenticated;
