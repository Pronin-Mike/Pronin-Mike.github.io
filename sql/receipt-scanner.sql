-- Сканер чеков: выполнить вручную в Supabase SQL Editor.
-- Скрипт не меняет существующие блюда и не запускается приложением автоматически.

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

create unique index if not exists receipts_user_key_unique
  on public.receipts(user_id, receipt_key)
  where receipt_key is not null;

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

create unique index if not exists product_aliases_user_store_name_unique
  on public.product_aliases(user_id, coalesce(store, ''), raw_name_key);

alter table public.receipts enable row level security;
alter table public.receipt_items enable row level security;
alter table public.product_aliases enable row level security;

drop policy if exists "receipts_own" on public.receipts;
create policy "receipts_own" on public.receipts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "receipt_items_own" on public.receipt_items;
create policy "receipt_items_own" on public.receipt_items
  for all to authenticated
  using (exists (
    select 1 from public.receipts r
    where r.id = receipt_id and r.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.receipts r
    where r.id = receipt_id and r.user_id = auth.uid()
  ));

drop policy if exists "product_aliases_own" on public.product_aliases;
create policy "product_aliases_own" on public.product_aliases
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.receipts to authenticated;
grant select, insert, update, delete on public.receipt_items to authenticated;
grant select, insert, update, delete on public.product_aliases to authenticated;

create or replace function public.import_receipt(
  p_receipt_id uuid,
  p_items jsonb,
  p_aliases jsonb default '[]'::jsonb
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
      v_expires := nullif(v_item->>'expires_at', '')::date;
      if v_amount is null or v_amount <= 0 or v_unit not in ('г', 'мл', 'шт') then
        raise exception 'Invalid fridge quantity or unit for %', v_name;
      end if;

      -- Существующая клиентская логика сравнивает названия без учёта регистра.
      update public.fridge_items
      set amount = amount + v_amount,
          expires_at = case
            when expires_at is null then v_expires
            when v_expires is null then expires_at
            else least(expires_at, v_expires)
          end,
          updated_at = now()
      where id = (
        select id from public.fridge_items
        where lower(btrim(name)) = lower(v_name) and unit = v_unit
        order by id
        limit 1
      );

      if not found then
        insert into public.fridge_items(name, amount, unit, expires_at)
        values (v_name, v_amount, v_unit, v_expires)
        on conflict (name, unit) do update
        set amount = public.fridge_items.amount + excluded.amount,
            expires_at = case
              when public.fridge_items.expires_at is null then excluded.expires_at
              when excluded.expires_at is null then public.fridge_items.expires_at
              else least(public.fridge_items.expires_at, excluded.expires_at)
            end,
            updated_at = now();
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

revoke all on function public.import_receipt(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.import_receipt(uuid, jsonb, jsonb) to authenticated;

-- PostgREST иногда не подхватывает новые таблицы и RPC немедленно.
select pg_notify('pgrst', 'reload schema');

-- Последняя команда намеренно возвращает строку: в Results должно быть ready = true.
select
  current_database() as database_name,
  to_regclass('public.receipts') is not null as receipts_ready,
  to_regclass('public.receipt_items') is not null as receipt_items_ready,
  to_regclass('public.product_aliases') is not null as product_aliases_ready,
  to_regprocedure('public.import_receipt(uuid,jsonb,jsonb)') is not null as rpc_ready,
  (
    to_regclass('public.receipts') is not null
    and to_regclass('public.receipt_items') is not null
    and to_regclass('public.product_aliases') is not null
    and to_regprocedure('public.import_receipt(uuid,jsonb,jsonb)') is not null
  ) as ready;
