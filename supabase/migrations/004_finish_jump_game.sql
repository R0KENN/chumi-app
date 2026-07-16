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
begin
    if p_score < 0 or p_score > 100000 then
        raise exception 'Invalid score';
    end if;

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

    /*
     * Разрешаем стартовый запас 75 очков и до 120 очков
     * за секунду игры. Значение намеренно выше обычной скорости,
     * чтобы не блокировать ракеты и быстрые подъёмы.
     */
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

    v_is_pair_record := p_score > v_pair_best;

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
    for update;

    v_is_personal_record :=
        not found
        or p_score > coalesce(v_personal_best, 0);

    insert into public.jump_game_scores (
        user_id,
        display_name,
        username,
        best_score,
        last_pair_code,
        created_at,
        updated_at
    )
    values (
        p_user_id,
        nullif(left(trim(p_display_name), 64), ''),
        nullif(left(trim(p_username), 64), ''),
        p_score,
        p_pair_code,
        now(),
        now()
    )
    on conflict (user_id) do update
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
        last_pair_code = excluded.last_pair_code,
        updated_at = case
            when excluded.best_score >
                 public.jump_game_scores.best_score
                then now()
            else public.jump_game_scores.updated_at
        end;

    select best_score
    into v_personal_best
    from public.jump_game_scores
    where user_id = p_user_id;

    select count(*) + 1
    into v_rank
    from public.jump_game_scores
    where best_score > v_personal_best;

    return jsonb_build_object(
        'success', true,
        'best', v_pair_best,
        'isRecord', v_is_pair_record,
        'personalBest', v_personal_best,
        'isPersonalRecord', v_is_personal_record,
        'rank', v_rank
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
