begin;

alter table public.jump_game_scores
    add column if not exists week_start date;

update public.jump_game_scores
set week_start =
    date_trunc(
        'week',
        updated_at at time zone 'UTC'
    )::date
where week_start is null;

alter table public.jump_game_scores
    alter column week_start
    set default (
        date_trunc(
            'week',
            now() at time zone 'UTC'
        )::date
    );

alter table public.jump_game_scores
    alter column week_start
    set not null;

alter table public.jump_game_scores
    drop constraint if exists jump_game_scores_pkey;

alter table public.jump_game_scores
    add constraint jump_game_scores_pkey
    primary key (
        user_id,
        week_start
    );

drop index if exists public.jump_game_scores_rating_idx;

create index jump_game_scores_rating_idx
    on public.jump_game_scores (
        week_start,
        best_score desc,
        updated_at asc,
        user_id asc
    );

create table if not exists public.weekly_game_reports (
    week_start date primary key,
    status text not null default 'processing',
    player_count integer not null default 0,
    started_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz,

    constraint weekly_game_reports_status_check
        check (
            status in (
                'processing',
                'sent',
                'failed'
            )
        ),

    constraint weekly_game_reports_player_count_check
        check (
            player_count >= 0
        )
);

alter table public.weekly_game_reports
    enable row level security;

revoke all
    on table public.weekly_game_reports
    from anon;

revoke all
    on table public.weekly_game_reports
    from authenticated;

create or replace function public.finish_jump_game(
    p_session_id uuid,
    p_user_id text,
    p_pair_code text,
    p_score integer,
    p_display_name text default null,
    p_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_session public.jump_game_sessions%rowtype;
    v_pair_best integer;
    v_personal_best integer;
    v_rank bigint;
    v_elapsed_seconds double precision;
    v_max_allowed_score integer;
    v_is_pair_record boolean;
    v_is_personal_record boolean;
    v_week_start date;
begin
    if p_score < 0 or p_score > 100000 then
        raise exception 'Invalid score';
    end if;

    v_week_start :=
        date_trunc(
            'week',
            now() at time zone 'UTC'
        )::date;

    if not exists (
        select 1
        from public.pair_users
        where pair_code = p_pair_code
          and user_id = p_user_id
    ) then
        raise exception 'Not a member';
    end if;

    select *
    into v_session
    from public.jump_game_sessions
    where id = p_session_id
    for update;

    if not found then
        raise exception 'Game session not found';
    end if;

    if v_session.user_id <> p_user_id then
        raise exception 'Session owner mismatch';
    end if;

    if v_session.pair_code <> p_pair_code then
        raise exception 'Session pair mismatch';
    end if;

    if v_session.completed_at is not null then
        raise exception 'Game session already completed';
    end if;

    if v_session.expires_at < now() then
        raise exception 'Game session expired';
    end if;

    v_elapsed_seconds :=
        extract(
            epoch from now() - v_session.started_at
        );

    v_max_allowed_score :=
        floor(
            75 +
            greatest(v_elapsed_seconds, 0) * 120
        );

    if p_score > v_max_allowed_score then
        raise exception 'Score is not plausible';
    end if;

    update public.jump_game_sessions
    set
        completed_at = now(),
        submitted_score = p_score
    where id = p_session_id;

    select coalesce(game_best_score, 0)
    into v_pair_best
    from public.pairs
    where code = p_pair_code
    for update;

    if not found then
        raise exception 'Pair not found';
    end if;

    v_is_pair_record :=
        p_score > v_pair_best;

    if v_is_pair_record then
        update public.pairs
        set game_best_score = p_score
        where code = p_pair_code;

        v_pair_best := p_score;
    end if;

    select best_score
    into v_personal_best
    from public.jump_game_scores
    where user_id = p_user_id
      and week_start = v_week_start
    for update;

    v_is_personal_record :=
        not found
        or p_score > coalesce(v_personal_best, 0);

    insert into public.jump_game_scores (
        user_id,
        week_start,
        display_name,
        username,
        best_score,
        last_pair_code,
        created_at,
        updated_at
    )
    values (
        p_user_id,
        v_week_start,
        nullif(
            left(
                trim(p_display_name),
                64
            ),
            ''
        ),
        nullif(
            left(
                trim(p_username),
                64
            ),
            ''
        ),
        p_score,
        p_pair_code,
        now(),
        now()
    )
    on conflict (
        user_id,
        week_start
    ) do update
    set
        display_name = coalesce(
            excluded.display_name,
            public.jump_game_scores.display_name
        ),
        username = coalesce(
            excluded.username,
            public.jump_game_scores.username
        ),
        best_score = greatest(
            public.jump_game_scores.best_score,
            excluded.best_score
        ),
        last_pair_code =
            excluded.last_pair_code,
        updated_at = case
            when excluded.best_score >
                 public.jump_game_scores.best_score
                then now()
            else
                public.jump_game_scores.updated_at
        end;

    select best_score
    into v_personal_best
    from public.jump_game_scores
    where user_id = p_user_id
      and week_start = v_week_start;

    select count(*) + 1
    into v_rank
    from public.jump_game_scores
    where week_start = v_week_start
      and best_score > v_personal_best;

    return jsonb_build_object(
        'success', true,
        'best', v_pair_best,
        'isRecord', v_is_pair_record,
        'personalBest', v_personal_best,
        'isPersonalRecord', v_is_personal_record,
        'rank', v_rank,
        'weekStart', v_week_start
    );
end;

$$;

revoke all
    on function public.finish_jump_game(
        uuid,
        text,
        text,
        integer,
        text,
        text
    )
    from public;

revoke all
    on function public.finish_jump_game(
        uuid,
        text,
        text,
        integer,
        text,
        text
    )
    from anon;

revoke all
    on function public.finish_jump_game(
        uuid,
        text,
        text,
        integer,
        text,
        text
    )
    from authenticated;

commit;
