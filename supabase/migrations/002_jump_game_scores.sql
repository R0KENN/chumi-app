create extension if not exists pgcrypto;

create table if not exists public.jump_game_scores (
    user_id text primary key,
    display_name text,
    username text,
    best_score integer not null default 0,
    last_pair_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint jump_game_scores_score_check
        check (
            best_score >= 0
            and best_score <= 100000
        )
);

create index if not exists jump_game_scores_rating_idx
    on public.jump_game_scores (
        best_score desc,
        updated_at asc,
        user_id asc
    );

alter table public.jump_game_scores
    enable row level security;

revoke all
    on table public.jump_game_scores
    from anon;

revoke all
    on table public.jump_game_scores
    from authenticated;
