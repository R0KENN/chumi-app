begin;

create unique index if not exists pair_users_pair_user_unique
  on public.pair_users (pair_code, user_id);

create unique index if not exists daily_tasks_unique
  on public.daily_tasks (
    pair_code,
    user_id,
    task_key,
    task_date
  );

create unique index if not exists processed_charges_charge_id_unique
  on public.processed_charges (charge_id);

create unique index if not exists user_slots_telegram_user_id_unique
  on public.user_slots (telegram_user_id);

create unique index if not exists user_settings_telegram_user_id_unique
  on public.user_settings (telegram_user_id);

create unique index if not exists pair_diary_daily_entry_unique
  on public.pair_diary (
    pair_code,
    user_id,
    entry_date
  );

create or replace function public.enforce_pair_member_limit()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_member_count integer;
begin
  /*
   * Сериализуем вставки для одной и той же пары.
   * Без advisory lock два параллельных INSERT могут
   * одновременно увидеть только одного участника.
   */
  perform pg_advisory_xact_lock(
    hashtextextended(new.pair_code::text, 0)
  );

  select count(*)
    into current_member_count
    from public.pair_users
   where pair_code = new.pair_code;

  if current_member_count >= 2 then
    raise exception using
      errcode = '23514',
      message = 'Pair already has two members';
  end if;

  return new;
end;

$$;

drop trigger if exists pair_users_member_limit
  on public.pair_users;

create trigger pair_users_member_limit
before insert on public.pair_users
for each row
execute function public.enforce_pair_member_limit();

commit;
