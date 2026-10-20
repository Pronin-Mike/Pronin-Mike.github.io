-- Атомарное ручное использование продукта с идемпотентностью.
-- fridge_items в текущей модели является общим холодильником для всех authenticated;
-- отдельного owner_id у позиции нет, поэтому доступ совпадает с остальными RPC проекта.

alter table public.product_movements
  drop constraint if exists product_movements_movement_type_check,
  drop constraint if exists product_movements_source_check;

alter table public.product_movements
  add constraint product_movements_movement_type_check
    check (movement_type in ('purchase', 'cook', 'waste', 'adjustment', 'consume')) not valid,
  add constraint product_movements_source_check
    check (source in ('manual', 'receipt', 'csv', 'json', 'cook', 'waste', 'system', 'manual_use')) not valid;

alter table public.product_movements
  validate constraint product_movements_movement_type_check;
alter table public.product_movements
  validate constraint product_movements_source_check;

-- operation_id нельзя сделать уникальным в product_movements: cook_dish намеренно
-- записывает несколько строк с одним идентификатором операции. Приватная таблица
-- хранит только ключ запроса, его аргументы и неизменный ответ consume_product.
create table if not exists app_private.consume_operations (
  operation_id uuid primary key,
  created_by uuid not null,
  item_id uuid not null,
  amount numeric not null check (amount > 0),
  result jsonb,
  created_at timestamptz not null default now()
);

revoke all on table app_private.consume_operations from public, anon, authenticated;

create or replace function public.consume_product(
  p_item_id uuid,
  p_amount numeric,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_claimed boolean := false;
  v_existing app_private.consume_operations%rowtype;
  v_item public.fridge_items%rowtype;
  v_after_amount numeric;
  v_after_cost numeric;
  v_after_priced numeric;
  v_cost numeric;
  v_priced numeric;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_item_id is null or p_operation_id is null then
    raise exception 'Item id and operation id are required';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Invalid consume amount';
  end if;

  insert into app_private.consume_operations(operation_id, created_by, item_id, amount)
  values (p_operation_id, v_user_id, p_item_id, p_amount)
  on conflict (operation_id) do nothing
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select * into v_existing
    from app_private.consume_operations
    where operation_id = p_operation_id
    for update;

    if not found
       or v_existing.created_by <> v_user_id
       or v_existing.item_id <> p_item_id
       or v_existing.amount <> p_amount then
      raise exception 'Operation id conflict';
    end if;
    if v_existing.result is null then
      raise exception 'Operation result is unavailable';
    end if;
    return v_existing.result;
  end if;

  -- Та же блокировка используется waste_product и cook_dish: конкурирующие
  -- списания одной позиции сериализуются и повторно проверяют актуальный остаток.
  select * into v_item
  from public.fridge_items
  where id = p_item_id
  for update;

  if not found then
    raise exception 'Product not found';
  end if;
  if p_amount > v_item.amount then
    raise exception 'Insufficient product amount';
  end if;

  v_cost := case
    when p_amount = v_item.amount then v_item.total_cost
    else round(v_item.total_cost * p_amount / v_item.amount, 4)
  end;
  v_priced := case
    when p_amount = v_item.amount then v_item.priced_amount
    else v_item.priced_amount * p_amount / v_item.amount
  end;
  v_after_amount := v_item.amount - p_amount;
  v_after_cost := greatest(0, v_item.total_cost - v_cost);
  v_after_priced := greatest(0, v_item.priced_amount - v_priced);

  -- Движение пишется до удаления, чтобы существующий FK был действителен;
  -- ON DELETE SET NULL затем сохраняет историческую строку без остатка.
  perform app_private.write_product_movement(
    p_operation_id,
    v_item.id,
    v_item.name,
    v_item.unit,
    'consume',
    'manual_use',
    -p_amount,
    -v_cost,
    -v_priced,
    v_after_amount,
    v_after_cost,
    v_after_priced
  );

  if v_after_amount = 0 then
    delete from public.fridge_items where id = v_item.id;
  else
    update public.fridge_items
    set amount = v_after_amount,
        total_cost = v_after_cost,
        priced_amount = v_after_priced
    where id = v_item.id;
  end if;

  v_result := jsonb_build_object(
    'success', true,
    'operation_id', p_operation_id,
    'amount', p_amount,
    'remaining_amount', v_after_amount,
    'cost', v_cost,
    'cost_complete', v_priced = p_amount
  );

  update app_private.consume_operations
  set result = v_result
  where operation_id = p_operation_id;

  return v_result;
end;
$$;

revoke all on function public.consume_product(uuid, numeric, uuid) from public, anon;
grant execute on function public.consume_product(uuid, numeric, uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
