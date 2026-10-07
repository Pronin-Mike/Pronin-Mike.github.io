/* ============================================================================
 * matcher.js — сопоставление ингредиентов рецепта и холодильника.
 *
 * Вся «математика доступности» живёт только здесь:
 *   • индекс холодильника по названию и единице измерения;
 *   • проверка одного ингредиента;
 *   • оценка блюда (можно ли приготовить и чего не хватает);
 *   • расчёт списания продуктов при приготовлении.
 *
 * Правила строгие (по требованию задачи):
 *   1. название сравнивается без учёта регистра и пробелов;
 *   2. единица измерения должна совпадать точно (г ≠ мл ≠ шт);
 *   3. количество в холодильнике должно быть ≥ требуемого;
 *   4. никаких пересчётов, синонимов и «примерно подходит».
 *
 * Модуль чистый: ничего не пишет в хранилище и не трогает DOM.
 * Подключается после store.js, публикует window.CookbookMatcher.
 * ========================================================================== */
(function (global) {
  'use strict';

  const Store = global.CookbookStore;
  const utils = Store.utils;
  const { nameKey, canonicalUnit, round3, cleanText } = utils;

  /** Погрешность сравнения дробных количеств. */
  const EPS = 1e-9;

  /* ------------------------------------------------------------------ *
   * Индекс холодильника
   * ------------------------------------------------------------------ */

  /**
   * Строит быстрые индексы по списку продуктов.
   * @param {Array} fridge
   * @returns {{byKey: Map<string, object>, byName: Map<string, object[]>}}
   */
  function indexFridge(fridge) {
    const byKey = new Map();
    const byName = new Map();

    (Array.isArray(fridge) ? fridge : []).forEach((product) => {
      const unit = canonicalUnit(product.unit);
      const key = nameKey(product.name) + '|' + unit;
      const name = nameKey(product.name);

      if (byKey.has(key)) {
        // Одна и та же позиция, записанная дважды, — суммируем.
        const existing = byKey.get(key);
        existing.amount = round3(existing.amount + product.amount);
      } else {
        byKey.set(key, {
          id: product.id,
          name: product.name,
          amount: product.amount,
          unit
        });
      }

      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(byKey.get(key));
    });

    return { byKey, byName };
  }

  /* ------------------------------------------------------------------ *
   * Проверка одного ингредиента
   * ------------------------------------------------------------------ */

  /**
   * @param {{name:string, amount:number, unit:string}} ingredient
   * @param {{byKey:Map, byName:Map}} index
   * @returns {{status:'ok'|'absent'|'unit'|'short', product:object|null,
   *            need:number, have:number, unit:string, name:string}}
   */
  function checkIngredient(ingredient, index) {
    const unit = canonicalUnit(ingredient.unit);
    const name = cleanText(ingredient.name);
    const need = round3(Number(ingredient.amount));
    const base = { name, need, unit, product: null, have: 0, status: 'absent' };

    const product = index.byKey.get(nameKey(name) + '|' + unit) || null;

    if (!product) {
      // Продукт есть под этим названием, но в другой единице измерения?
      const sameName = index.byName.get(nameKey(name)) || [];
      if (sameName.length) {
        return Object.assign({}, base, {
          status: 'unit',
          product: sameName[0],
          have: sameName[0].amount,
          actualUnit: sameName[0].unit
        });
      }
      return base;
    }

    base.product = product;
    base.have = product.amount;

    if (product.amount - need >= -EPS) {
      base.status = 'ok';
    } else {
      base.status = 'short';
    }
    return base;
  }

  /* ------------------------------------------------------------------ *
   * Оценка блюда
   * ------------------------------------------------------------------ */

  /** Человекочитаемая причина нехватки. */
  function reasonText(check) {
    if (check.status === 'absent') return 'нет в холодильнике';
    if (check.status === 'unit') {
      return 'нужен ' + check.unit + ', а есть ' + check.actualUnit;
    }
    if (check.status === 'short') {
      return 'есть только ' + check.have + ' ' + check.unit;
    }
    return '';
  }

  /**
   * Оценивает блюдо относительно текущего холодильника.
   * @param {object} dish
   * @param {Array} fridge
   * @returns {{available:boolean, total:number, ready:number,
   *            checks:Array, missing:Array, missingText:string}}
   */
  function evaluate(dish, fridge) {
    const index = indexFridge(fridge);
    const ingredients = Array.isArray(dish && dish.ingredients) ? dish.ingredients : [];

    const checks = ingredients.map((ingredient) => {
      const check = checkIngredient(ingredient, index);
      check.reason = reasonText(check);
      return check;
    });

    const missing = checks.filter((check) => check.status !== 'ok');

    return {
      available: missing.length === 0,
      total: checks.length,
      ready: checks.length - missing.length,
      checks,
      missing,
      missingText: missingText(missing)
    };
  }

  /** «сыр 50 г, молоко 200 мл» */
  function missingText(missing) {
    return (Array.isArray(missing) ? missing : [])
      .map((check) => check.name + ' ' + check.need + ' ' + check.unit)
      .join(', ');
  }

  /** Быстрая проверка: хватает ли всего. */
  function canCook(dish, fridge) {
    const ingredients = Array.isArray(dish && dish.ingredients) ? dish.ingredients : [];
    if (!ingredients.length) return false;
    const index = indexFridge(fridge);
    return ingredients.every((ingredient) => checkIngredient(ingredient, index).status === 'ok');
  }

  /** Только те блюда, которые можно приготовить прямо сейчас. */
  function availableDishes(dishes, fridge) {
    return (Array.isArray(dishes) ? dishes : []).filter((dish) => canCook(dish, fridge));
  }

  /* ------------------------------------------------------------------ *
   * Приготовление: расчёт нового состояния холодильника
   * ------------------------------------------------------------------ */

  /**
   * Списывает ингредиенты блюда из холодильника.
   * Возвращает НОВЫЙ список продуктов; исходный массив не меняется.
   *
   * Если после списания количество стало 0 (или меньше) — продукт удаляется.
   *
   * @param {object} dish
   * @param {Array} fridge
   * @returns {{ok:boolean, error:string, fridge:Array, consumed:Array, removed:Array, missing:Array}}
   */
  function planCooking(dish, fridge) {
    const source = Array.isArray(fridge) ? fridge : [];
    const index = indexFridge(source);
    const ingredients = Array.isArray(dish && dish.ingredients) ? dish.ingredients : [];

    if (!ingredients.length) {
      return {
        ok: false,
        error: 'В блюде нет ингредиентов.',
        fridge: source.slice(),
        consumed: [],
        removed: [],
        missing: []
      };
    }

    // Оценка «до» — если чего-то не хватает, готовить нельзя.
    const evaluation = evaluate(dish, source);
    if (!evaluation.available) {
      return {
        ok: false,
        error: 'Не хватает: ' + evaluation.missingText,
        fridge: source.slice(),
        consumed: [],
        removed: [],
        missing: evaluation.missing
      };
    }

    // Работаем с копиями, чтобы не портить состояние приложения.
    const next = source.map((product) => Object.assign({}, product));
    const byId = new Map(next.map((product) => [product.id, product]));
    const consumed = [];
    const removed = [];

    for (const ingredient of ingredients) {
      const unit = canonicalUnit(ingredient.unit);
      const key = nameKey(ingredient.name) + '|' + unit;
      const found = index.byKey.get(key);
      const product = found ? byId.get(found.id) : null;

      if (!product) {
        // Возможно только при повторяющихся ингредиентах в одном рецепте.
        return {
          ok: false,
          error: 'Не хватает: ' + cleanText(ingredient.name) + ' ' + round3(Number(ingredient.amount)) + ' ' + unit,
          fridge: source.slice(),
          consumed: [],
          removed: [],
          missing: [checkIngredient(ingredient, indexFridge(next))]
        };
      }

      const left = round3(product.amount - Number(ingredient.amount));
      consumed.push({
        name: product.name,
        amount: round3(Number(ingredient.amount)),
        unit: product.unit
      });

      if (left <= EPS) {
        byId.delete(product.id);
        removed.push(product.name);
      } else {
        product.amount = left;
      }
    }

    const resultFridge = next
      .filter((product) => byId.has(product.id))
      .map((product) => ({
        id: product.id,
        name: product.name,
        amount: round3(product.amount),
        unit: product.unit
      }));

    return {
      ok: true,
      error: '',
      fridge: resultFridge,
      consumed,
      removed,
      missing: []
    };
  }

  /* ------------------------------------------------------------------ *
   * Публичный API
   * ------------------------------------------------------------------ */

  global.CookbookMatcher = {
    EPS,
    indexFridge,
    checkIngredient,
    reasonText,
    evaluate,
    missingText,
    canCook,
    availableDishes,
    planCooking
  };
})(typeof window !== 'undefined' ? window : globalThis);
