-- Атомарное восстановление JSON-бэкапа: блюда, ингредиенты, остатки и аудит.
create or replace function public.restore_backup(p_fridge jsonb, p_dishes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private, pg_temp
as $$
declare
  v_entry jsonb;
  v_ingredient jsonb;
  v_old public.fridge_items%rowtype;
  v_new public.fridge_items%rowtype;
  v_operation uuid := gen_random_uuid();
  v_dish_id uuid;
  v_name text;
  v_unit text;
  v_amount numeric;
  v_total numeric;
  v_priced numeric;
  v_fridge_count integer := 0;
  v_dish_count integer := 0;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_fridge is null or jsonb_typeof(p_fridge) <> 'array' then raise exception 'Backup fridge must be an array'; end if;
  if p_dishes is null or jsonb_typeof(p_dishes) <> 'array' then raise exception 'Backup dishes must be an array'; end if;

  lock table public.fridge_items in share row exclusive mode;
  lock table public.dishes in share row exclusive mode;

  for v_old in select * from public.fridge_items order by id loop
    perform app_private.write_product_movement(
      v_operation, v_old.id, v_old.name, v_old.unit, 'adjustment', 'json',
      -v_old.amount, -v_old.total_cost, -v_old.priced_amount, 0, 0, 0
    );
  end loop;
  delete from public.fridge_items;
  delete from public.dishes;

  for v_entry in select value from jsonb_array_elements(p_fridge) loop
    v_name := btrim(v_entry->>'name');
    v_unit := v_entry->>'unit';
    v_amount := nullif(v_entry->>'amount', '')::numeric;
    v_total := coalesce(nullif(v_entry->>'total_cost', '')::numeric, 0);
    v_priced := coalesce(nullif(v_entry->>'priced_amount', '')::numeric, 0);
    if v_name = '' or length(v_name) > 80 or v_amount is null or v_amount <= 0
      or v_unit not in ('г', 'мл', 'шт') or v_total < 0 or v_priced < 0
      or v_priced > v_amount or (v_priced = 0 and v_total <> 0) then
      raise exception 'Invalid backup fridge item';
    end if;

    insert into public.fridge_items(
      name, amount, unit, expires_at, last_purchase_price, total_cost, priced_amount
    ) values (
      v_name, v_amount, v_unit, nullif(v_entry->>'expires_at', '')::date,
      nullif(v_entry->>'last_purchase_price', '')::numeric, round(v_total, 4), v_priced
    ) returning * into v_new;
    perform app_private.write_product_movement(
      v_operation, v_new.id, v_new.name, v_new.unit, 'adjustment', 'json',
      v_new.amount, v_new.total_cost, v_new.priced_amount,
      v_new.amount, v_new.total_cost, v_new.priced_amount
    );
    v_fridge_count := v_fridge_count + 1;
  end loop;

  for v_entry in select value from jsonb_array_elements(p_dishes) loop
    if btrim(v_entry->>'title') = '' or btrim(v_entry->>'section_id') = ''
      or jsonb_typeof(coalesce(v_entry->'steps', '[]'::jsonb)) <> 'array'
      or jsonb_typeof(coalesce(v_entry->'ingredients', '[]'::jsonb)) <> 'array' then
      raise exception 'Invalid backup dish';
    end if;
    v_dish_id := gen_random_uuid();
    insert into public.dishes(id, title, section_id, time_min, steps, notes)
    values (
      v_dish_id,
      btrim(v_entry->>'title'),
      v_entry->>'section_id',
      nullif(v_entry->>'time_min', '')::integer,
      array(select jsonb_array_elements_text(coalesce(v_entry->'steps', '[]'::jsonb))),
      nullif(v_entry->>'notes', '')
    );

    for v_ingredient in select value from jsonb_array_elements(coalesce(v_entry->'ingredients', '[]'::jsonb)) loop
      v_name := btrim(v_ingredient->>'name');
      v_unit := v_ingredient->>'unit';
      v_amount := nullif(v_ingredient->>'amount', '')::numeric;
      if v_name = '' or v_amount is null or v_amount <= 0 or v_unit not in ('г', 'мл', 'шт') then
        raise exception 'Invalid backup ingredient';
      end if;
      insert into public.dish_ingredients(dish_id, name, amount, unit, sort_order)
      values (
        v_dish_id, v_name, v_amount, v_unit,
        coalesce(nullif(v_ingredient->>'sort_order', '')::integer, 0)
      );
    end loop;
    v_dish_count := v_dish_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'fridge', v_fridge_count,
    'dishes', v_dish_count,
    'operation_id', v_operation
  );
end;
$$;

revoke all on function public.restore_backup(jsonb, jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
