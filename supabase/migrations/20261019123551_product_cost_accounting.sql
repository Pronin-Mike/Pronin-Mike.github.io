-- Средневзвешенная стоимость остатков и неизменяемый журнал движений.
-- Целевой проект на момент подготовки: eehlbxdhwngmbqzghjyw.
-- Существующий last_purchase_price сохраняется только как справочное поле:
-- его нельзя безопасно использовать для восстановления стоимости остатков.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

alter table public.fridge_items
  add column if not exists total_cost numeric(14,4) not null default 0,
  add column if not exists priced_amount numeric not null default 0;

alter table public.fridge_items drop constraint if exists fridge_items_total_cost_check;
alter table public.fridge_items drop constraint if exists fridge_items_priced_amount_check;
alter table public.fridge_items drop constraint if exists fridge_items_cost_consistency_check;
alter table public.fridge_items
  add constraint fridge_items_total_cost_check check (total_cost >= 0),
  add constraint fridge_items_priced_amount_check check (priced_amount >= 0 and priced_amount <= amount),
  add constraint fridge_items_cost_consistency_check check (priced_amount > 0 or total_cost = 0);

create table if not exists public.product_movements (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null,
  fridge_item_id uuid references public.fridge_items(id) on delete set null,
  product_name text not null,
  unit text not null check (unit in ('г', 'мл', 'шт')),
  movement_type text not null check (movement_type in ('purchase', 'cook', 'waste', 'adjustment')),
  source text not null check (source in ('manual', 'receipt', 'csv', 'json', 'cook', 'waste', 'system')),
  amount_delta numeric not null,
  cost_delta numeric(14,4) not null,
  priced_amount_delta numeric not null,
  amount_after numeric not null check (amount_after >= 0),
  total_cost_after numeric(14,4) not null check (total_cost_after >= 0),
  priced_amount_after numeric not null check (priced_amount_after >= 0 and priced_amount_after <= amount_after),
  receipt_id uuid references public.receipts(id) on delete set null,
  dish_id uuid references public.dishes(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (priced_amount_after > 0 or total_cost_after = 0)
);

create index if not exists product_movements_operation_idx on public.product_movements(operation_id);
create index if not exists product_movements_item_created_idx on public.product_movements(fridge_item_id, created_at desc);
create index if not exists product_movements_type_created_idx on public.product_movements(movement_type, created_at desc);
create index if not exists product_movements_receipt_idx on public.product_movements(receipt_id) where receipt_id is not null;
create index if not exists product_movements_dish_idx on public.product_movements(dish_id) where dish_id is not null;

alter table public.product_movements enable row level security;
drop policy if exists product_movements_read_authenticated on public.product_movements;
create policy product_movements_read_authenticated
  on public.product_movements for select to authenticated using (true);

revoke all on table public.product_movements from public, anon, authenticated;
grant select on table public.product_movements to authenticated;

create or replace function app_private.write_product_movement(
  p_operation_id uuid,
  p_fridge_item_id uuid,
  p_product_name text,
  p_unit text,
  p_movement_type text,
  p_source text,
  p_amount_delta numeric,
  p_cost_delta numeric,
  p_priced_amount_delta numeric,
  p_amount_after numeric,
  p_total_cost_after numeric,
  p_priced_amount_after numeric,
  p_receipt_id uuid default null,
  p_dish_id uuid default null
) returns void
language sql
security invoker
set search_path = pg_catalog, public, app_private, pg_temp
as $$
  insert into public.product_movements(
    operation_id, fridge_item_id, product_name, unit, movement_type, source,
    amount_delta, cost_delta, priced_amount_delta,
    amount_after, total_cost_after, priced_amount_after,
    receipt_id, dish_id, created_by
  ) values (
    p_operation_id, p_fridge_item_id, p_product_name, p_unit, p_movement_type, p_source,
    p_amount_delta, round(p_cost_delta, 4), p_priced_amount_delta,
    p_amount_after, round(p_total_cost_after, 4), p_priced_amount_after,
    p_receipt_id, p_dish_id, auth.uid()
  );
$$;
revoke all on function app_private.write_product_movement(uuid,uuid,text,text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,uuid,uuid) from public, anon, authenticated;

create or replace function public.mutate_fridge_item(
  p_item_id uuid,
  p_name text,
  p_amount numeric,
  p_unit text,
  p_expires_at date,
  p_purchase_cost numeric,
  p_mode text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_old public.fridge_items%rowtype;
  v_new public.fridge_items%rowtype;
  v_operation uuid := gen_random_uuid();
  v_total numeric;
  v_priced numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  p_name := btrim(p_name);
  if p_name = '' or length(p_name) > 80 then raise exception 'Invalid product name'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then raise exception 'Invalid amount'; end if;
  if p_unit not in ('г','мл','шт') then raise exception 'Invalid unit'; end if;
  if p_purchase_cost is not null and p_purchase_cost < 0 then raise exception 'Invalid cost'; end if;
  if p_mode not in ('create','sum','replace','adjust') then raise exception 'Invalid mode'; end if;

  if p_mode = 'create' then
    if p_item_id is not null then raise exception 'Item id is not allowed for create'; end if;
    insert into public.fridge_items(name, amount, unit, expires_at, last_purchase_price, total_cost, priced_amount)
    values (p_name, p_amount, p_unit, p_expires_at, p_purchase_cost,
      coalesce(p_purchase_cost, 0), case when p_purchase_cost is null then 0 else p_amount end)
    returning * into v_new;
    perform app_private.write_product_movement(v_operation, v_new.id, v_new.name, v_new.unit,
      'purchase', 'manual', v_new.amount, v_new.total_cost, v_new.priced_amount,
      v_new.amount, v_new.total_cost, v_new.priced_amount);
    return to_jsonb(v_new);
  end if;

  select * into v_old from public.fridge_items where id = p_item_id for update;
  if not found then raise exception 'Product not found'; end if;

  if p_mode = 'sum' then
    if p_unit <> v_old.unit then raise exception 'Unit mismatch'; end if;
    update public.fridge_items set
      name = p_name,
      amount = v_old.amount + p_amount,
      expires_at = case when v_old.expires_at is null then p_expires_at when p_expires_at is null then v_old.expires_at else least(v_old.expires_at, p_expires_at) end,
      total_cost = v_old.total_cost + coalesce(p_purchase_cost, 0),
      priced_amount = v_old.priced_amount + case when p_purchase_cost is null then 0 else p_amount end,
      last_purchase_price = coalesce(p_purchase_cost, v_old.last_purchase_price)
    where id = v_old.id returning * into v_new;
    perform app_private.write_product_movement(v_operation, v_new.id, v_new.name, v_new.unit,
      'purchase', 'manual', p_amount, coalesce(p_purchase_cost, 0),
      case when p_purchase_cost is null then 0 else p_amount end,
      v_new.amount, v_new.total_cost, v_new.priced_amount);
    return to_jsonb(v_new);
  end if;

  if p_mode = 'replace' then
    perform app_private.write_product_movement(v_operation, v_old.id, v_old.name, v_old.unit,
      'adjustment', 'manual', -v_old.amount, -v_old.total_cost, -v_old.priced_amount, 0, 0, 0);
    update public.fridge_items set name=p_name, amount=p_amount, unit=p_unit, expires_at=p_expires_at,
      last_purchase_price=p_purchase_cost, total_cost=coalesce(p_purchase_cost,0),
      priced_amount=case when p_purchase_cost is null then 0 else p_amount end
    where id=v_old.id returning * into v_new;
    perform app_private.write_product_movement(v_operation, v_new.id, v_new.name, v_new.unit,
      'purchase', 'manual', v_new.amount, v_new.total_cost, v_new.priced_amount,
      v_new.amount, v_new.total_cost, v_new.priced_amount);
    return to_jsonb(v_new);
  end if;

  -- Ручная правка: уменьшение распределяет известную стоимость пропорционально;
  -- увеличение без цены добавляет неизвестную часть. Явная цена оценивает весь остаток.
  if p_purchase_cost is not null then
    v_total := p_purchase_cost;
    v_priced := p_amount;
  elsif p_amount < v_old.amount and v_old.amount > 0 then
    v_total := round(v_old.total_cost * p_amount / v_old.amount, 4);
    v_priced := v_old.priced_amount * p_amount / v_old.amount;
  else
    v_total := v_old.total_cost;
    v_priced := least(v_old.priced_amount, p_amount);
  end if;
  update public.fridge_items set name=p_name, amount=p_amount, unit=p_unit, expires_at=p_expires_at,
    total_cost=v_total, priced_amount=v_priced,
    last_purchase_price=case when p_purchase_cost is null then v_old.last_purchase_price else p_purchase_cost end
  where id=v_old.id returning * into v_new;
  if v_new.amount <> v_old.amount or v_new.total_cost <> v_old.total_cost or v_new.priced_amount <> v_old.priced_amount then
    perform app_private.write_product_movement(v_operation, v_new.id, v_new.name, v_new.unit,
      'adjustment', 'manual', v_new.amount-v_old.amount, v_new.total_cost-v_old.total_cost,
      v_new.priced_amount-v_old.priced_amount, v_new.amount, v_new.total_cost, v_new.priced_amount);
  end if;
  return to_jsonb(v_new);
end;
$$;

create or replace function public.delete_fridge_item(p_item_id uuid) returns void
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare v_item public.fridge_items%rowtype; v_operation uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_item from public.fridge_items where id=p_item_id for update;
  if not found then raise exception 'Product not found'; end if;
  perform app_private.write_product_movement(v_operation,v_item.id,v_item.name,v_item.unit,'adjustment','manual',
    -v_item.amount,-v_item.total_cost,-v_item.priced_amount,0,0,0);
  delete from public.fridge_items where id=v_item.id;
end;
$$;

create or replace function public.clear_fridge() returns integer
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare v_item public.fridge_items%rowtype; v_operation uuid := gen_random_uuid(); v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  for v_item in select * from public.fridge_items order by id for update loop
    perform app_private.write_product_movement(v_operation,v_item.id,v_item.name,v_item.unit,'adjustment','manual',
      -v_item.amount,-v_item.total_cost,-v_item.priced_amount,0,0,0);
    v_count:=v_count+1;
  end loop;
  delete from public.fridge_items;
  return v_count;
end;
$$;

create or replace function public.waste_product(p_item_id uuid, p_amount numeric) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_item public.fridge_items%rowtype; v_after public.fridge_items%rowtype;
  v_cost numeric; v_priced numeric; v_operation uuid:=gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_item from public.fridge_items where id=p_item_id for update;
  if not found then raise exception 'Product not found'; end if;
  if p_amount is null or p_amount<=0 or p_amount>v_item.amount then raise exception 'Invalid waste amount'; end if;
  v_cost:=case when p_amount=v_item.amount then v_item.total_cost else round(v_item.total_cost*p_amount/v_item.amount,4) end;
  v_priced:=case when p_amount=v_item.amount then v_item.priced_amount else v_item.priced_amount*p_amount/v_item.amount end;
  if p_amount=v_item.amount then
    delete from public.fridge_items where id=v_item.id;
    v_after:=v_item; v_after.amount:=0; v_after.total_cost:=0; v_after.priced_amount:=0;
  else
    update public.fridge_items set amount=v_item.amount-p_amount,
      total_cost=greatest(0,v_item.total_cost-v_cost), priced_amount=greatest(0,v_item.priced_amount-v_priced)
    where id=v_item.id returning * into v_after;
  end if;
  perform app_private.write_product_movement(v_operation,v_item.id,v_item.name,v_item.unit,'waste','waste',
    -p_amount,-v_cost,-v_priced,v_after.amount,v_after.total_cost,v_after.priced_amount);
  return jsonb_build_object('success',true,'amount',p_amount,'cost',v_cost,'cost_complete',v_priced=p_amount);
end;
$$;

create or replace function public.waste_expired_products() returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare v_item public.fridge_items%rowtype; v_operation uuid:=gen_random_uuid(); v_count integer:=0; v_cost numeric:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  for v_item in select * from public.fridge_items where expires_at<current_date order by id for update loop
    perform app_private.write_product_movement(v_operation,v_item.id,v_item.name,v_item.unit,'waste','waste',
      -v_item.amount,-v_item.total_cost,-v_item.priced_amount,0,0,0);
    v_count:=v_count+1; v_cost:=v_cost+v_item.total_cost;
  end loop;
  delete from public.fridge_items where expires_at<current_date;
  return jsonb_build_object('success',true,'count',v_count,'cost',round(v_cost,4));
end;
$$;

create or replace function public.apply_fridge_import(p_plan jsonb, p_source text default 'csv') returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_entry jsonb; v_old public.fridge_items%rowtype; v_new public.fridge_items%rowtype;
  v_operation uuid:=gen_random_uuid(); v_count integer:=0;
  v_amount numeric; v_total numeric; v_priced numeric; v_unit text; v_name text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_plan is null or jsonb_typeof(p_plan)<>'object' then raise exception 'Invalid import plan'; end if;
  if p_source not in ('csv','json') then raise exception 'Invalid import source'; end if;

  for v_entry in select value from jsonb_array_elements(coalesce(p_plan->'deletes','[]'::jsonb)) loop
    select * into v_old from public.fridge_items where id=(v_entry#>>'{}')::uuid for update;
    if found then
      perform app_private.write_product_movement(v_operation,v_old.id,v_old.name,v_old.unit,'adjustment',p_source,
        -v_old.amount,-v_old.total_cost,-v_old.priced_amount,0,0,0);
      delete from public.fridge_items where id=v_old.id; v_count:=v_count+1;
    end if;
  end loop;

  for v_entry in select value from jsonb_array_elements(coalesce(p_plan->'updates','[]'::jsonb)) loop
    select * into v_old from public.fridge_items where id=(v_entry->>'id')::uuid for update;
    if not found then raise exception 'Import target not found'; end if;
    v_name:=btrim(v_entry->>'name'); v_unit:=v_entry->>'unit'; v_amount:=(v_entry->>'amount')::numeric;
    v_total:=coalesce((v_entry->>'total_cost')::numeric,0); v_priced:=coalesce((v_entry->>'priced_amount')::numeric,0);
    if v_name='' or length(v_name)>80 or v_unit not in ('г','мл','шт') or v_amount<=0 or v_total<0 or v_priced<0 or v_priced>v_amount or (v_priced=0 and v_total<>0) then
      raise exception 'Invalid import item';
    end if;
    update public.fridge_items set name=v_name,amount=v_amount,unit=v_unit,
      expires_at=nullif(v_entry->>'expires_at','')::date,total_cost=v_total,priced_amount=v_priced,
      last_purchase_price=nullif(v_entry->>'last_purchase_price','')::numeric
    where id=v_old.id returning * into v_new;
    if v_new.amount<>v_old.amount or v_new.total_cost<>v_old.total_cost or v_new.priced_amount<>v_old.priced_amount then
      perform app_private.write_product_movement(v_operation,v_new.id,v_new.name,v_new.unit,'adjustment',p_source,
        v_new.amount-v_old.amount,v_new.total_cost-v_old.total_cost,v_new.priced_amount-v_old.priced_amount,
        v_new.amount,v_new.total_cost,v_new.priced_amount);
    end if;
    v_count:=v_count+1;
  end loop;

  for v_entry in select value from jsonb_array_elements(coalesce(p_plan->'inserts','[]'::jsonb)) loop
    v_name:=btrim(v_entry->>'name'); v_unit:=v_entry->>'unit'; v_amount:=(v_entry->>'amount')::numeric;
    v_total:=coalesce((v_entry->>'total_cost')::numeric,0); v_priced:=coalesce((v_entry->>'priced_amount')::numeric,0);
    if v_name='' or length(v_name)>80 or v_unit not in ('г','мл','шт') or v_amount<=0 or v_total<0 or v_priced<0 or v_priced>v_amount or (v_priced=0 and v_total<>0) then
      raise exception 'Invalid import item';
    end if;
    insert into public.fridge_items(name,amount,unit,expires_at,total_cost,priced_amount,last_purchase_price)
    values(v_name,v_amount,v_unit,nullif(v_entry->>'expires_at','')::date,v_total,v_priced,nullif(v_entry->>'last_purchase_price','')::numeric)
    returning * into v_new;
    perform app_private.write_product_movement(v_operation,v_new.id,v_new.name,v_new.unit,'adjustment',p_source,
      v_new.amount,v_new.total_cost,v_new.priced_amount,v_new.amount,v_new.total_cost,v_new.priced_amount);
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('success',true,'processed',v_count,'operation_id',v_operation);
end;
$$;

create or replace function public.cook_dish(p_dish_id uuid) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_missing jsonb:='[]'::jsonb; v_ing record; v_item public.fridge_items%rowtype;
  v_cost numeric; v_priced numeric; v_total_cost numeric:=0; v_complete boolean:=true;
  v_operation uuid:=gen_random_uuid(); v_after_amount numeric; v_after_cost numeric; v_after_priced numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists(select 1 from public.dishes where id=p_dish_id) then raise exception 'Dish not found'; end if;
  for v_ing in select name,amount,unit from public.dish_ingredients where dish_id=p_dish_id order by lower(name),unit loop
    select * into v_item from public.fridge_items where lower(btrim(name))=lower(btrim(v_ing.name)) and unit=v_ing.unit order by id limit 1 for update;
    if not found or v_item.amount<v_ing.amount then
      v_missing:=v_missing||jsonb_build_object('name',v_ing.name,'need',v_ing.amount,'have',coalesce(v_item.amount,0),'unit',v_ing.unit);
    end if;
  end loop;
  if jsonb_array_length(v_missing)>0 then return jsonb_build_object('success',false,'missing',v_missing); end if;

  for v_ing in select name,amount,unit from public.dish_ingredients where dish_id=p_dish_id order by lower(name),unit loop
    select * into v_item from public.fridge_items where lower(btrim(name))=lower(btrim(v_ing.name)) and unit=v_ing.unit order by id limit 1 for update;
    v_cost:=case when v_ing.amount=v_item.amount then v_item.total_cost else round(v_item.total_cost*v_ing.amount/v_item.amount,4) end;
    v_priced:=case when v_ing.amount=v_item.amount then v_item.priced_amount else v_item.priced_amount*v_ing.amount/v_item.amount end;
    v_after_amount:=v_item.amount-v_ing.amount; v_after_cost:=greatest(0,v_item.total_cost-v_cost); v_after_priced:=greatest(0,v_item.priced_amount-v_priced);
    if v_after_amount=0 then delete from public.fridge_items where id=v_item.id;
    else update public.fridge_items set amount=v_after_amount,total_cost=v_after_cost,priced_amount=v_after_priced where id=v_item.id; end if;
    perform app_private.write_product_movement(v_operation,v_item.id,v_item.name,v_item.unit,'cook','cook',
      -v_ing.amount,-v_cost,-v_priced,v_after_amount,v_after_cost,v_after_priced,null,p_dish_id);
    v_total_cost:=v_total_cost+v_cost; v_complete:=v_complete and (v_item.priced_amount=v_item.amount);
  end loop;
  insert into public.cook_log(dish_id) values(p_dish_id);
  return jsonb_build_object('success',true,'cost',round(v_total_cost,4),'cost_complete',v_complete,'operation_id',v_operation);
end;
$$;

-- Импорт чека: цена строки считается стоимостью всего добавляемого количества.
create or replace function public.import_receipt(
  p_receipt_id uuid, p_items jsonb, p_aliases jsonb default '[]'::jsonb,
  p_conflict_mode text default 'sum'
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_receipt public.receipts%rowtype; v_item jsonb; v_alias jsonb;
  v_name text; v_unit text; v_amount numeric; v_price numeric; v_expires date;
  v_ids uuid[]; v_target uuid; v_old public.fridge_items%rowtype; v_new public.fridge_items%rowtype;
  v_sum_amount numeric; v_sum_cost numeric; v_sum_priced numeric; v_sum_expires date;
  v_operation uuid:=gen_random_uuid(); v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Receipt items must be a non-empty array'; end if;
  if p_aliases is null or jsonb_typeof(p_aliases)<>'array' then raise exception 'Aliases must be an array'; end if;
  if p_conflict_mode not in ('replace','keep','sum') then raise exception 'Invalid fridge conflict mode'; end if;
  select * into v_receipt from public.receipts where id=p_receipt_id for update;
  if not found or v_receipt.user_id<>auth.uid() then raise exception 'Receipt not found'; end if;
  if v_receipt.status<>'draft' then raise exception 'Only a draft receipt can be imported'; end if;
  delete from public.receipt_items where receipt_id=p_receipt_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'raw_name','')='' or coalesce(v_item->>'normalized_name','')='' then raise exception 'Item names cannot be empty'; end if;
    insert into public.receipt_items(receipt_id,line_number,raw_name,normalized_name,receipt_quantity,receipt_unit,fridge_amount,fridge_unit,unit_price,total_price,include_in_fridge,match_status)
    values(p_receipt_id,(v_item->>'line_number')::integer,v_item->>'raw_name',v_item->>'normalized_name',nullif(v_item->>'receipt_quantity','')::numeric,
      nullif(v_item->>'receipt_unit',''),nullif(v_item->>'fridge_amount','')::numeric,nullif(v_item->>'fridge_unit',''),nullif(v_item->>'unit_price','')::numeric,
      nullif(v_item->>'total_price','')::numeric,coalesce((v_item->>'include_in_fridge')::boolean,false),coalesce(v_item->>'match_status','unmatched'));
    if not coalesce((v_item->>'include_in_fridge')::boolean,false) then continue; end if;
    v_name:=btrim(v_item->>'normalized_name'); v_unit:=v_item->>'fridge_unit'; v_amount:=nullif(v_item->>'fridge_amount','')::numeric;
    v_price:=nullif(v_item->>'total_price','')::numeric; v_expires:=nullif(v_item->>'expires_at','')::date;
    if v_amount is null or v_amount<=0 or v_unit not in ('г','мл','шт') or v_price<0 then raise exception 'Invalid fridge quantity, unit or price for %',v_name; end if;

    select coalesce(array_agg(x.id order by x.id),'{}'::uuid[]) into v_ids from (
      select fi.id from public.fridge_items fi where fi.unit=v_unit and fi.id in (
        select c.value::uuid from jsonb_array_elements_text(coalesce(v_item->'fridge_ids','[]'::jsonb)) c(value)
        where c.value~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') order by fi.id for update
    ) x;
    if cardinality(v_ids)=0 then
      select id into v_target from public.fridge_items where lower(btrim(name))=lower(v_name) and unit=v_unit order by id limit 1 for update;
      v_ids:=case when found then array[v_target] else '{}'::uuid[] end;
    end if;

    if cardinality(v_ids)>0 then
      v_target:=v_ids[1];
      select sum(amount),sum(total_cost),sum(priced_amount),min(expires_at) into v_sum_amount,v_sum_cost,v_sum_priced,v_sum_expires from public.fridge_items where id=any(v_ids);
      update public.product_movements set fridge_item_id=v_target where fridge_item_id=any(v_ids) and fridge_item_id<>v_target;
      delete from public.fridge_items where id=any(v_ids) and id<>v_target;
      select * into v_old from public.fridge_items where id=v_target for update;
      update public.fridge_items set amount=v_sum_amount,total_cost=v_sum_cost,priced_amount=v_sum_priced,expires_at=v_sum_expires where id=v_target returning * into v_old;
      if p_conflict_mode='keep' then continue; end if;
      if p_conflict_mode='replace' then
        perform app_private.write_product_movement(v_operation,v_old.id,v_old.name,v_old.unit,'adjustment','receipt',
          -v_old.amount,-v_old.total_cost,-v_old.priced_amount,0,0,0,p_receipt_id,null);
        update public.fridge_items set name=v_name,amount=v_amount,unit=v_unit,expires_at=v_expires,total_cost=coalesce(v_price,0),
          priced_amount=case when v_price is null then 0 else v_amount end,last_purchase_price=v_price where id=v_target returning * into v_new;
      else
        update public.fridge_items set name=v_name,amount=v_old.amount+v_amount,
          expires_at=case when v_old.expires_at is null then v_expires when v_expires is null then v_old.expires_at else least(v_old.expires_at,v_expires) end,
          total_cost=v_old.total_cost+coalesce(v_price,0),priced_amount=v_old.priced_amount+case when v_price is null then 0 else v_amount end,
          last_purchase_price=coalesce(v_price,v_old.last_purchase_price) where id=v_target returning * into v_new;
      end if;
    else
      insert into public.fridge_items(name,amount,unit,expires_at,total_cost,priced_amount,last_purchase_price)
      values(v_name,v_amount,v_unit,v_expires,coalesce(v_price,0),case when v_price is null then 0 else v_amount end,v_price) returning * into v_new;
    end if;
    perform app_private.write_product_movement(v_operation,v_new.id,v_new.name,v_new.unit,'purchase','receipt',v_amount,coalesce(v_price,0),
      case when v_price is null then 0 else v_amount end,v_new.amount,v_new.total_cost,v_new.priced_amount,p_receipt_id,null);
    v_count:=v_count+1;
  end loop;

  for v_alias in select value from jsonb_array_elements(p_aliases) loop
    insert into public.product_aliases(user_id,store,raw_name_key,product_name,package_amount,package_unit)
    values(auth.uid(),nullif(v_alias->>'store',''),v_alias->>'raw_name_key',v_alias->>'product_name',nullif(v_alias->>'package_amount','')::numeric,nullif(v_alias->>'package_unit',''))
    on conflict (user_id,(coalesce(store,'')),raw_name_key) do update set product_name=excluded.product_name,package_amount=excluded.package_amount,package_unit=excluded.package_unit,updated_at=now();
  end loop;
  update public.receipts set status='imported',imported_at=now() where id=p_receipt_id and status='draft';
  if not found then raise exception 'Receipt status changed during import'; end if;
  return jsonb_build_object('success',true,'imported',v_count,'operation_id',v_operation);
end;
$$;

create or replace function public.normalize_fridge_names(p_groups jsonb) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare v_group jsonb; v_name text; v_unit text; v_ids uuid[]; v_target uuid; v_amount numeric; v_cost numeric; v_priced numeric; v_expires date; v_count integer:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_groups is null or jsonb_typeof(p_groups)<>'array' then raise exception 'Normalization groups must be an array'; end if;
  for v_group in select value from jsonb_array_elements(p_groups) loop
    v_name:=btrim(v_group->>'name'); v_unit:=v_group->>'unit';
    if v_name='' or v_unit not in ('г','мл','шт') then raise exception 'Invalid normalization group'; end if;
    select coalesce(array_agg(x.id order by x.canonical desc,x.updated_at desc nulls last,x.id),'{}'::uuid[]) into v_ids from (
      select fi.id,fi.updated_at,lower(btrim(fi.name))=lower(v_name) canonical from public.fridge_items fi where fi.unit=v_unit and fi.id in (
        select c.value::uuid from jsonb_array_elements_text(coalesce(v_group->'ids','[]'::jsonb)) c(value)
        where c.value~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') for update
    ) x;
    if cardinality(v_ids)=0 then continue; end if;
    v_target:=v_ids[1];
    select sum(amount),sum(total_cost),sum(priced_amount),min(expires_at) into v_amount,v_cost,v_priced,v_expires from public.fridge_items where id=any(v_ids);
    update public.product_movements set fridge_item_id=v_target where fridge_item_id=any(v_ids) and fridge_item_id<>v_target;
    delete from public.fridge_items where id=any(v_ids) and id<>v_target;
    update public.fridge_items set name=v_name,amount=v_amount,total_cost=v_cost,priced_amount=v_priced,expires_at=v_expires where id=v_target;
    v_count:=v_count+cardinality(v_ids);
  end loop;
  return jsonb_build_object('success',true,'normalized',v_count);
end;
$$;

-- Денежные поля должны меняться только атомарными RPC выше.
revoke insert, update, delete on public.fridge_items from authenticated;
grant select on public.fridge_items to authenticated;

do $$
declare v_signature regprocedure;
begin
  foreach v_signature in array array[
    'public.mutate_fridge_item(uuid,text,numeric,text,date,numeric,text)'::regprocedure,
    'public.delete_fridge_item(uuid)'::regprocedure,
    'public.clear_fridge()'::regprocedure,
    'public.waste_product(uuid,numeric)'::regprocedure,
    'public.waste_expired_products()'::regprocedure,
    'public.apply_fridge_import(jsonb,text)'::regprocedure,
    'public.cook_dish(uuid)'::regprocedure,
    'public.import_receipt(uuid,jsonb,jsonb,text)'::regprocedure,
    'public.normalize_fridge_names(jsonb)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public, anon', v_signature);
    execute format('grant execute on function %s to authenticated, service_role', v_signature);
  end loop;
end $$;

notify pgrst, 'reload schema';
