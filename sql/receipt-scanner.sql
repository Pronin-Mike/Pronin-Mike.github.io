-- Сканер чеков: выполнить вручную в Supabase SQL Editor.
-- Скрипт не меняет существующие блюда и не запускается приложением автоматически.

alter table public.fridge_items
  add column if not exists last_purchase_price numeric;

alter table public.fridge_items drop constraint if exists fridge_items_last_purchase_price_check;
alter table public.fridge_items
  add constraint fridge_items_last_purchase_price_check
  check (last_purchase_price is null or last_purchase_price >= 0) not valid;

create table if not exists public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store text,
  source text not null check (source in ('camera', 'upload', 'pdf', 'text')),
  purchased_at timestamptz,
  total_amount numeric check (total_amount is null or total_amount >= 0),
  fiscal_fn text,
  fiscal_fd text,
  fiscal_fp text,
  receipt_key text,
  status text not null default 'draft' check (status in ('draft', 'imported')),
  imported_at timestamptz,
  created_at timestamptz not null default now()
);

-- CREATE TABLE IF NOT EXISTS не обновляет ограничения ранее созданной таблицы.
-- Пересоздаём контракт явно; NOT VALID сохраняет совместимость со старыми строками,
-- но все новые записи уже проверяются по актуальным значениям приложения.
alter table public.receipts drop constraint if exists receipts_source_check;
alter table public.receipts
  add constraint receipts_source_check
  check (source in ('camera', 'upload', 'pdf', 'text')) not valid;

alter table public.receipts drop constraint if exists receipts_status_check;
alter table public.receipts
  add constraint receipts_status_check
  check (status in ('draft', 'imported')) not valid;

-- В приложении магазин хранится как отображаемое русское название. Старые
-- версии схемы ожидали технические slug-значения и блокировали создание чека.
alter table public.receipts drop constraint if exists receipts_store_check;
alter table public.receipts
  add constraint receipts_store_check
  check (
    store is null or store in (
      'Пятёрочка', 'В1', 'Перекрёсток', 'ДА!', 'Другой магазин',
      'pyaterochka', 'v1', 'perekrestok', 'da', 'other'
    )
  ) not valid;

create unique index if not exists receipts_user_key_unique
  on public.receipts(user_id, receipt_key)
  where receipt_key is not null;

-- Имя из ранней версии схемы описывало тот же индекс.
drop index if exists public.idx_receipts_user_key;

create table if not exists public.receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.receipts(id) on delete cascade,
  line_number integer not null,
  raw_name text not null,
  normalized_name text not null,
  receipt_quantity numeric,
  receipt_unit text,
  fridge_amount numeric,
  fridge_unit text check (fridge_unit is null or fridge_unit in ('г', 'мл', 'шт')),
  unit_price numeric,
  total_price numeric,
  include_in_fridge boolean not null default true,
  match_status text not null,
  created_at timestamptz not null default now()
);

alter table public.receipt_items drop constraint if exists receipt_items_fridge_unit_check;
alter table public.receipt_items
  add constraint receipt_items_fridge_unit_check
  check (fridge_unit is null or fridge_unit in ('г', 'мл', 'шт')) not valid;

alter table public.receipt_items drop constraint if exists receipt_items_match_status_check;
alter table public.receipt_items
  add constraint receipt_items_match_status_check
  check (match_status in (
    'unmatched', 'alias', 'fridge', 'normalized', 'manual',
    'suggested', 'confirmed'
  )) not valid;

create table if not exists public.product_aliases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  store text,
  raw_name_key text not null,
  product_name text not null,
  package_amount numeric,
  package_unit text check (package_unit is null or package_unit in ('г', 'мл', 'шт')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_aliases drop constraint if exists product_aliases_package_unit_check;
alter table public.product_aliases
  add constraint product_aliases_package_unit_check
  check (package_unit is null or package_unit in ('г', 'мл', 'шт')) not valid;

alter table public.product_aliases drop constraint if exists product_aliases_store_check;
alter table public.product_aliases
  add constraint product_aliases_store_check
  check (
    store is null or store in (
      'Пятёрочка', 'В1', 'Перекрёсток', 'ДА!', 'Другой магазин',
      'pyaterochka', 'v1', 'perekrestok', 'da', 'other'
    )
  ) not valid;

create unique index if not exists product_aliases_user_store_name_unique
  on public.product_aliases(user_id, coalesce(store, ''), raw_name_key);

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.product_aliases enable row level security;

drop policy if exists "receipts_own" on public.receipts;
drop policy if exists "receipts_select_own" on public.receipts;
drop policy if exists "receipts_insert_own" on public.receipts;
drop policy if exists "receipts_update_own" on public.receipts;
drop policy if exists "receipts_delete_own" on public.receipts;
create policy "receipts_own" on public.receipts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "receipt_items_own" on public.receipt_items;
drop policy if exists "receipt_items_select_own" on public.receipt_items;
drop policy if exists "receipt_items_insert_own" on public.receipt_items;
drop policy if exists "receipt_items_update_own" on public.receipt_items;
drop policy if exists "receipt_items_delete_own" on public.receipt_items;
create policy "receipt_items_own" on public.receipt_items
  for all to authenticated
  using (exists (
    select 1 from public.receipts r
    where r.id = receipt_id and r.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.receipts r
    where r.id = receipt_id and r.user_id = (select auth.uid())
  ));

drop policy if exists "product_aliases_own" on public.product_aliases;
drop policy if exists "product_aliases_select_own" on public.product_aliases;
drop policy if exists "product_aliases_insert_own" on public.product_aliases;
drop policy if exists "product_aliases_update_own" on public.product_aliases;
drop policy if exists "product_aliases_delete_own" on public.product_aliases;
create policy "product_aliases_own" on public.product_aliases
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

grant select, insert, update, delete on public.receipts to authenticated;
grant select, insert, update, delete on public.receipt_items to authenticated;
grant select, insert, update, delete on public.product_aliases to authenticated;

drop function if exists public.import_receipt(uuid, jsonb, jsonb);

create or replace function public.import_receipt(
  p_receipt_id uuid,
  p_items jsonb,
  p_aliases jsonb default '[]'::jsonb,
  p_conflict_mode text default 'sum'
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_receipt public.receipts%rowtype;
  v_item jsonb;
  v_alias jsonb;
  v_name text;
  v_unit text;
  v_amount numeric;
  v_price numeric;
  v_fridge_id uuid;
  v_fridge_ids uuid[];
  v_existing_amount numeric;
  v_existing_expires date;
  v_expires date;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Receipt items must be a non-empty array';
  end if;
  if p_aliases is null or jsonb_typeof(p_aliases) <> 'array' then
    raise exception 'Aliases must be an array';
  end if;
  if p_conflict_mode not in ('replace', 'keep', 'sum') then
    raise exception 'Invalid fridge conflict mode';
  end if;

  select * into v_receipt
  from public.receipts
  where id = p_receipt_id
  for update;

  if not found or v_receipt.user_id <> auth.uid() then
    raise exception 'Receipt not found';
  end if;
  if v_receipt.status <> 'draft' then
    raise exception 'Only a draft receipt can be imported';
  end if;

  -- Отредактированные пользователем строки становятся окончательной версией чека.
  delete from public.receipt_items where receipt_id = p_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce(v_item->>'raw_name', '') = '' or coalesce(v_item->>'normalized_name', '') = '' then
      raise exception 'Item names cannot be empty';
    end if;

    insert into public.receipt_items (
      receipt_id, line_number, raw_name, normalized_name, receipt_quantity,
      receipt_unit, fridge_amount, fridge_unit, unit_price, total_price,
      include_in_fridge, match_status
    ) values (
      p_receipt_id,
      coalesce((v_item->>'line_number')::integer, 0),
      v_item->>'raw_name', v_item->>'normalized_name',
      nullif(v_item->>'receipt_quantity', '')::numeric,
      nullif(v_item->>'receipt_unit', ''),
      nullif(v_item->>'fridge_amount', '')::numeric,
      nullif(v_item->>'fridge_unit', ''),
      nullif(v_item->>'unit_price', '')::numeric,
      nullif(v_item->>'total_price', '')::numeric,
      coalesce((v_item->>'include_in_fridge')::boolean, false),
      coalesce(v_item->>'match_status', 'unmatched')
    );

    if coalesce((v_item->>'include_in_fridge')::boolean, false) then
      v_name := btrim(v_item->>'normalized_name');
      v_unit := v_item->>'fridge_unit';
      v_amount := nullif(v_item->>'fridge_amount', '')::numeric;
      v_price := nullif(v_item->>'total_price', '')::numeric;
      v_expires := nullif(v_item->>'expires_at', '')::date;
      if v_amount is null or v_amount <= 0 or v_unit not in ('г', 'мл', 'шт') then
        raise exception 'Invalid fridge quantity or unit for %', v_name;
      end if;

      -- Клиент передаёт id строк, которые относятся к той же канонической
      -- категории. Это позволяет объединить старые OCR-названия вроде двух
      -- вариантов «ТЕНД.Филе ...» без доверия к id чужого пользователя: RLS
      -- SECURITY INVOKER скрывает недоступные строки.
      select coalesce(array_agg(locked.id order by locked.id), '{}'::uuid[])
      into v_fridge_ids
      from (
        select fi.id
        from public.fridge_items fi
        where fi.unit = v_unit
          and fi.id in (
            select candidate.value::uuid
            from jsonb_array_elements_text(coalesce(v_item->'fridge_ids', '[]'::jsonb)) candidate(value)
            where candidate.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          )
        order by fi.id
        for update
      ) locked;

      if cardinality(v_fridge_ids) = 0 then
        select id into v_fridge_id
        from public.fridge_items
        where lower(btrim(name)) = lower(v_name) and unit = v_unit
        order by id
        limit 1
        for update;
        v_fridge_ids := case when found then array[v_fridge_id] else '{}'::uuid[] end;
      end if;

      if cardinality(v_fridge_ids) > 0 then
        v_fridge_id := v_fridge_ids[1];
        select sum(amount), min(expires_at)
        into v_existing_amount, v_existing_expires
        from public.fridge_items
        where id = any(v_fridge_ids);

        -- Несколько старых магазинных названий становятся одной общей позицией.
        delete from public.fridge_items
        where id = any(v_fridge_ids) and id <> v_fridge_id;

        update public.fridge_items
        set name = v_name,
            amount = case p_conflict_mode
              when 'replace' then v_amount
              when 'keep' then v_existing_amount
              else v_existing_amount + v_amount
            end,
            last_purchase_price = case
              when p_conflict_mode = 'keep' then last_purchase_price
              else coalesce(v_price, last_purchase_price)
            end,
            expires_at = case
              when p_conflict_mode = 'replace' then v_expires
              when p_conflict_mode = 'keep' then v_existing_expires
              when v_existing_expires is null then v_expires
              when v_expires is null then v_existing_expires
              else least(v_existing_expires, v_expires)
            end,
            updated_at = now()
        where id = v_fridge_id;
      else
        insert into public.fridge_items(name, amount, unit, expires_at, last_purchase_price)
        values (v_name, v_amount, v_unit, v_expires, v_price)
        on conflict (name, unit) do update
        set amount = case p_conflict_mode
              when 'replace' then excluded.amount
              when 'keep' then public.fridge_items.amount
              else public.fridge_items.amount + excluded.amount
            end,
            last_purchase_price = case
              when p_conflict_mode = 'keep' then public.fridge_items.last_purchase_price
              else coalesce(excluded.last_purchase_price, public.fridge_items.last_purchase_price)
            end,
            expires_at = case
              when p_conflict_mode = 'keep' then public.fridge_items.expires_at
              when p_conflict_mode = 'replace' then excluded.expires_at
              when public.fridge_items.expires_at is null then excluded.expires_at
              when excluded.expires_at is null then public.fridge_items.expires_at
              else least(public.fridge_items.expires_at, excluded.expires_at)
            end,
            updated_at = case when p_conflict_mode = 'keep' then public.fridge_items.updated_at else now() end;
      end if;
      v_count := v_count + 1;
    end if;
  end loop;

  for v_alias in select value from jsonb_array_elements(p_aliases)
  loop
    update public.product_aliases
    set product_name = v_alias->>'product_name',
        package_amount = nullif(v_alias->>'package_amount', '')::numeric,
        package_unit = nullif(v_alias->>'package_unit', ''),
        updated_at = now()
    where user_id = auth.uid()
      and coalesce(store, '') = coalesce(v_alias->>'store', '')
      and raw_name_key = v_alias->>'raw_name_key';

    if not found then
      insert into public.product_aliases(
        user_id, store, raw_name_key, product_name, package_amount, package_unit
      ) values (
        auth.uid(), nullif(v_alias->>'store', ''), v_alias->>'raw_name_key',
        v_alias->>'product_name', nullif(v_alias->>'package_amount', '')::numeric,
        nullif(v_alias->>'package_unit', '')
      );
    end if;
  end loop;

  update public.receipts
  set status = 'imported', imported_at = now()
  where id = p_receipt_id and status = 'draft';

  if not found then
    raise exception 'Receipt status changed during import';
  end if;
  return jsonb_build_object('success', true, 'imported', v_count);
end;
$$;

revoke all on function public.import_receipt(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.import_receipt(uuid, jsonb, jsonb, text) to authenticated;

create or replace function public.normalize_fridge_names(p_groups jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group jsonb;
  v_name text;
  v_unit text;
  v_ids uuid[];
  v_target_id uuid;
  v_amount numeric;
  v_expires date;
  v_normalized integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_groups is null or jsonb_typeof(p_groups) <> 'array' then
    raise exception 'Normalization groups must be an array';
  end if;

  for v_group in select value from jsonb_array_elements(p_groups)
  loop
    v_name := btrim(v_group->>'name');
    v_unit := v_group->>'unit';
    if v_name = '' or v_unit not in ('г', 'мл', 'шт') then
      raise exception 'Invalid normalization group';
    end if;

    select coalesce(array_agg(locked.id order by locked.is_canonical desc, locked.updated_at desc nulls last, locked.id), '{}'::uuid[])
    into v_ids
    from (
      select fi.id, fi.updated_at, lower(btrim(fi.name)) = lower(v_name) as is_canonical
      from public.fridge_items fi
      where fi.unit = v_unit
        and fi.id in (
          select candidate.value::uuid
          from jsonb_array_elements_text(coalesce(v_group->'ids', '[]'::jsonb)) candidate(value)
          where candidate.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        )
      for update
    ) locked;

    if cardinality(v_ids) = 0 then
      continue;
    end if;

    v_target_id := v_ids[1];
    select sum(amount), min(expires_at)
    into v_amount, v_expires
    from public.fridge_items
    where id = any(v_ids);

    delete from public.fridge_items
    where id = any(v_ids) and id <> v_target_id;

    update public.fridge_items
    set name = v_name,
        amount = v_amount,
        expires_at = v_expires,
        updated_at = now()
    where id = v_target_id;

    v_normalized := v_normalized + cardinality(v_ids);
  end loop;

  return jsonb_build_object('success', true, 'normalized', v_normalized);
end;
$$;

revoke all on function public.normalize_fridge_names(jsonb) from public, anon;
grant execute on function public.normalize_fridge_names(jsonb) to authenticated;

-- PostgREST иногда не подхватывает новые таблицы и RPC немедленно.
select pg_notify('pgrst', 'reload schema');

-- Последняя команда намеренно возвращает строку: в Results должно быть ready = true.
select
  current_database() as database_name,
  to_regclass('public.receipts') is not null as receipts_ready,
  to_regclass('public.receipt_items') is not null as receipt_items_ready,
  to_regclass('public.product_aliases') is not null as product_aliases_ready,
  to_regprocedure('public.import_receipt(uuid,jsonb,jsonb,text)') is not null as rpc_ready,
  to_regprocedure('public.normalize_fridge_names(jsonb)') is not null as normalize_rpc_ready,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'fridge_items'
      and column_name = 'last_purchase_price'
  ) as fridge_price_ready,
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'receipts'
      and c.conname = 'receipts_source_check'
      and pg_get_constraintdef(c.oid) like '%upload%'
  ) as source_constraint_ready,
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'receipts'
      and c.conname = 'receipts_store_check'
      and pg_get_constraintdef(c.oid) like '%Пятёрочка%'
  ) as store_constraint_ready,
  exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'receipt_items'
      and c.conname = 'receipt_items_match_status_check'
      and pg_get_constraintdef(c.oid) like '%manual%'
  ) as match_status_constraint_ready,
  (
    to_regclass('public.receipts') is not null
    and to_regclass('public.receipt_items') is not null
    and to_regclass('public.product_aliases') is not null
    and to_regprocedure('public.import_receipt(uuid,jsonb,jsonb,text)') is not null
    and to_regprocedure('public.normalize_fridge_names(jsonb)') is not null
    and exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'fridge_items'
        and column_name = 'last_purchase_price'
    )
    and exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'receipts'
        and c.conname = 'receipts_source_check'
        and pg_get_constraintdef(c.oid) like '%upload%'
    )
    and exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'receipts'
        and c.conname = 'receipts_store_check'
        and pg_get_constraintdef(c.oid) like '%Пятёрочка%'
    )
    and exists (
      select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = 'public'
        and t.relname = 'receipt_items'
        and c.conname = 'receipt_items_match_status_check'
        and pg_get_constraintdef(c.oid) like '%manual%'
    )
  ) as ready;
