-- Полное списание должно записать движение до удаления остатка: внешний ключ
-- product_movements.fridge_item_id настроен как ON DELETE SET NULL.
create or replace function public.waste_product(p_item_id uuid, p_amount numeric) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_item public.fridge_items%rowtype;
  v_after public.fridge_items%rowtype;
  v_cost numeric;
  v_priced numeric;
  v_operation uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into v_item from public.fridge_items where id = p_item_id for update;
  if not found then raise exception 'Product not found'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_item.amount then
    raise exception 'Invalid waste amount';
  end if;

  v_cost := case when p_amount = v_item.amount then v_item.total_cost
                 else round(v_item.total_cost * p_amount / v_item.amount, 4) end;
  v_priced := case when p_amount = v_item.amount then v_item.priced_amount
                   else v_item.priced_amount * p_amount / v_item.amount end;

  if p_amount = v_item.amount then
    v_after := v_item;
    v_after.amount := 0;
    v_after.total_cost := 0;
    v_after.priced_amount := 0;
    perform app_private.write_product_movement(
      v_operation, v_item.id, v_item.name, v_item.unit, 'waste', 'waste',
      -p_amount, -v_cost, -v_priced, 0, 0, 0
    );
    delete from public.fridge_items where id = v_item.id;
  else
    update public.fridge_items
    set amount = v_item.amount - p_amount,
        total_cost = greatest(0, v_item.total_cost - v_cost),
        priced_amount = greatest(0, v_item.priced_amount - v_priced)
    where id = v_item.id
    returning * into v_after;
    perform app_private.write_product_movement(
      v_operation, v_item.id, v_item.name, v_item.unit, 'waste', 'waste',
      -p_amount, -v_cost, -v_priced,
      v_after.amount, v_after.total_cost, v_after.priced_amount
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'amount', p_amount,
    'cost', v_cost,
    'cost_complete', v_priced = p_amount
  );
end;
$$;

revoke all on function public.waste_product(uuid, numeric) from public, anon;
grant execute on function public.waste_product(uuid, numeric) to authenticated, service_role;

notify pgrst, 'reload schema';
