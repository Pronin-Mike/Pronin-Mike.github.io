-- PROPOSAL ONLY — DO NOT APPLY WITHOUT EXPLICIT APPROVAL.
-- Safe, atomic and idempotent replacement contract for cooking.
-- New signature: public.cook_dish(p_dish_id uuid, p_operation_id uuid).

create table if not exists app_private.cook_operations (
  operation_id uuid primary key,
  created_by uuid not null,
  dish_id uuid not null,
  result jsonb,
  created_at timestamptz not null default now()
);

revoke all on table app_private.cook_operations from public, anon, authenticated;

create or replace function public.cook_dish(
  p_dish_id uuid,
  p_operation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_claimed boolean := false;
  v_existing app_private.cook_operations%rowtype;
  v_ing record;
  v_item public.fridge_items%rowtype;
  v_missing jsonb := '[]'::jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_cost numeric;
  v_priced numeric;
  v_total_cost numeric := 0;
  v_complete boolean := true;
  v_after_amount numeric;
  v_after_cost numeric;
  v_after_priced numeric;
  v_result jsonb;
  v_requirements jsonb;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_dish_id is null or p_operation_id is null then raise exception 'Dish id and operation id are required'; end if;

  insert into app_private.cook_operations(operation_id, created_by, dish_id)
  values (p_operation_id, v_user_id, p_dish_id)
  on conflict (operation_id) do nothing
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select * into v_existing from app_private.cook_operations
    where operation_id = p_operation_id for update;
    if not found or v_existing.created_by <> v_user_id or v_existing.dish_id <> p_dish_id then
      raise exception 'Operation id conflict';
    end if;
    if v_existing.result is null then raise exception 'Operation result is unavailable'; end if;
    return v_existing.result;
  end if;

  if not exists (select 1 from public.dishes where id = p_dish_id) then raise exception 'Dish not found'; end if;

  select coalesce(jsonb_agg(jsonb_build_object('normalized_name', normalized_name, 'name', name, 'unit', unit, 'amount', amount) order by normalized_name, unit), '[]'::jsonb)
  into v_requirements
  from (
    select lower(btrim(name)) normalized_name, min(name) name, unit, sum(amount) amount
    from public.dish_ingredients where dish_id = p_dish_id
    group by lower(btrim(name)), unit
  ) requirements;

  -- Aggregate duplicate recipe rows and lock products in deterministic order.
  for v_ing in
    select * from jsonb_to_recordset(v_requirements)
      as requirement(normalized_name text, name text, unit text, amount numeric)
  loop
    select * into v_item from public.fridge_items
    where lower(btrim(name)) = v_ing.normalized_name and unit = v_ing.unit
    order by id limit 1 for update;

    if not found then
      v_missing := v_missing || jsonb_build_object('name', v_ing.name, 'need', v_ing.amount, 'have', 0, 'unit', v_ing.unit, 'reason', 'absent');
    elsif v_item.expires_at is not null and v_item.expires_at < current_date then
      v_missing := v_missing || jsonb_build_object('name', v_ing.name, 'need', v_ing.amount, 'have', v_item.amount, 'unit', v_ing.unit, 'reason', 'expired');
    elsif v_item.amount < v_ing.amount then
      v_missing := v_missing || jsonb_build_object('name', v_ing.name, 'need', v_ing.amount, 'have', v_item.amount, 'unit', v_ing.unit, 'reason', 'short');
    end if;
  end loop;

  if jsonb_array_length(v_missing) > 0 then
    v_result := jsonb_build_object('success', false, 'operation_id', p_operation_id, 'missing', v_missing);
    update app_private.cook_operations set result = v_result where operation_id = p_operation_id;
    return v_result;
  end if;

  for v_ing in
    select * from jsonb_to_recordset(v_requirements)
      as requirement(normalized_name text, name text, unit text, amount numeric)
  loop
    select * into strict v_item from public.fridge_items
    where lower(btrim(name)) = v_ing.normalized_name and unit = v_ing.unit
    order by id limit 1 for update;

    v_cost := case when v_ing.amount = v_item.amount then v_item.total_cost else round(v_item.total_cost * v_ing.amount / v_item.amount, 4) end;
    v_priced := case when v_ing.amount = v_item.amount then v_item.priced_amount else v_item.priced_amount * v_ing.amount / v_item.amount end;
    v_after_amount := v_item.amount - v_ing.amount;
    v_after_cost := greatest(0, v_item.total_cost - v_cost);
    v_after_priced := greatest(0, v_item.priced_amount - v_priced);

    -- Write history while the FK target still exists. ON DELETE SET NULL then preserves it.
    perform app_private.write_product_movement(
      p_operation_id, v_item.id, v_item.name, v_item.unit, 'cook', 'cook',
      -v_ing.amount, -v_cost, -v_priced, v_after_amount, v_after_cost, v_after_priced,
      null, p_dish_id
    );

    if v_after_amount = 0 then
      delete from public.fridge_items where id = v_item.id;
    else
      update public.fridge_items set amount = v_after_amount, total_cost = v_after_cost,
        priced_amount = v_after_priced where id = v_item.id;
    end if;

    v_total_cost := v_total_cost + v_cost;
    v_complete := v_complete and (v_priced = v_ing.amount);
    v_movements := v_movements || jsonb_build_object(
      'item_id', v_item.id, 'name', v_item.name, 'unit', v_item.unit,
      'amount', v_ing.amount, 'cost', v_cost, 'cost_complete', v_priced = v_ing.amount,
      'remaining_amount', v_after_amount
    );
  end loop;

  insert into public.cook_log(dish_id) values (p_dish_id);
  v_result := jsonb_build_object(
    'success', true, 'operation_id', p_operation_id, 'dish_id', p_dish_id,
    'cost', round(v_total_cost, 4), 'cost_complete', v_complete, 'movements', v_movements
  );
  update app_private.cook_operations set result = v_result where operation_id = p_operation_id;
  return v_result;
end;
$$;

revoke all on function public.cook_dish(uuid, uuid) from public, anon;
grant execute on function public.cook_dish(uuid, uuid) to authenticated, service_role;

-- Disable the unsafe legacy entry point only when the frontend is deployed with the new contract.
revoke execute on function public.cook_dish(uuid) from authenticated;

notify pgrst, 'reload schema';

-- Rollback plan:
-- grant execute on function public.cook_dish(uuid) to authenticated;
-- revoke execute on function public.cook_dish(uuid, uuid) from authenticated;
-- drop function public.cook_dish(uuid, uuid);
-- drop table app_private.cook_operations;
