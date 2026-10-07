/* ============================================================================
 * store.js — база данных кулинарной книги.
 *
 * Отвечает только за данные:
 *   • константы модели (разделы, единицы измерения);
 *   • чтение/запись localStorage;
 *   • CRUD блюд и продуктов холодильника;
 *   • валидацию входных данных;
 *   • экспорт/импорт всей базы.
 *
 * Никакого DOM здесь нет — модуль можно тестировать в Node.js.
 * Подключается первым, публикует window.CookbookStore.
 * ========================================================================== */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Константы модели
   * ------------------------------------------------------------------ */

  const KEYS = {
    dishes: 'cookbook.v1.dishes',
    fridge: 'cookbook.v1.fridge',
    ui: 'cookbook.v1.ui'
  };

  const SCHEMA_VERSION = 1;
  const APP_ID = 'home-cookbook';

  /** Единственные допустимые единицы измерения. */
  const UNITS = ['г', 'мл', 'шт'];

  /** Четыре фиксированных раздела. */
  const SECTIONS = [
    { id: 'breakfast', title: 'Завтрак', emoji: '🍳', hint: 'Начать день вкусно' },
    { id: 'snack', title: 'Полдник', emoji: '🍎', hint: 'Лёгкий перекус' },
    { id: 'lunch', title: 'Обед', emoji: '🍲', hint: 'Сытная середина дня' },
    { id: 'dinner', title: 'Ужин', emoji: '🌙', hint: 'Спокойный вечер' }
  ];

  const SECTION_IDS = SECTIONS.map((s) => s.id);

  /* ------------------------------------------------------------------ *
   * Мелкие утилиты (используются и модулем сопоставления ингредиентов)
   * ------------------------------------------------------------------ */

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** Округление до 3 знаков — чтобы 0.30000000000000004 не попадало в базу. */
  function round3(n) {
    return Math.round(n * 1000) / 1000;
  }

  /** Убирает лишние пробелы и обрезает края. */
  function cleanText(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Ключ названия для сравнения: без регистра и без пробелов.
   * «Мука  пшеничная» и «мукапшеничная» дадут один и тот же ключ.
   */
  function nameKey(name) {
    return cleanText(name).toLowerCase().replace(/\s+/g, '');
  }

  /**
   * Приводит единицу измерения к канонической (г / мл / шт).
   * Возвращает '' если единица неизвестна — тогда её нельзя сохранить.
   * Латиница и лишние точки допускаются только при вводе/импорте,
   * в базе всегда лежит одно из трёх значений.
   */
  function canonicalUnit(unit) {
    const key = cleanText(unit).toLowerCase().replace(/\.+$/, '');
    const aliases = {
      'г': 'г', 'гр': 'г', 'g': 'г', 'gr': 'г',
      'мл': 'мл', 'ml': 'мл',
      'шт': 'шт', 'pcs': 'шт', 'pc': 'шт', 'ед': 'шт'
    };
    return aliases[key] || '';
  }

  /** Разбор числа: принимает «1,5», «1.5», « 200 ». Возвращает NaN если нельзя. */
  function parseAmount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    const text = cleanText(value).replace(/\s/g, '').replace(',', '.');
    if (text === '') return NaN;
    const num = Number(text);
    return Number.isFinite(num) ? num : NaN;
  }

  function isSection(id) {
    return SECTION_IDS.indexOf(cleanText(id).toLowerCase()) !== -1;
  }

  function sectionById(id) {
    const key = cleanText(id).toLowerCase();
    return SECTIONS.find((s) => s.id === key) || SECTIONS[0];
  }

  /* ------------------------------------------------------------------ *
   * Хранилище (localStorage с запасным вариантом в памяти)
   * ------------------------------------------------------------------ */

  const memory = new Map();

  function storageGet(key) {
    try {
      const raw = global.localStorage.getItem(key);
      if (raw !== null) return raw;
    } catch (err) {
      /* приватный режим или запрет cookies — падаем в память */
    }
    return memory.has(key) ? memory.get(key) : null;
  }

  function storageSet(key, value) {
    memory.set(key, value);
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.warn('Не удалось записать в localStorage:', err);
      return false;
    }
  }

  function storageRemove(key) {
    memory.delete(key);
    try {
      global.localStorage.removeItem(key);
    } catch (err) {
      /* игнорируем */
    }
  }

  function readJSON(key, fallback) {
    const raw = storageGet(key);
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (err) {
      console.warn('Повреждённые данные в ' + key + ', начинаю с пустого списка');
      return fallback;
    }
  }

  function writeJSON(key, value) {
    return storageSet(key, JSON.stringify(value));
  }

  /* ------------------------------------------------------------------ *
   * Состояние и подписки
   * ------------------------------------------------------------------ */

  const state = {
    dishes: [],
    fridge: [],
    loaded: false
  };

  const listeners = new Set();

  function emit() {
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (err) {
        console.error('Ошибка подписчика:', err);
      }
    });
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  /* ------------------------------------------------------------------ *
   * Валидация продуктов холодильника
   * ------------------------------------------------------------------ */

  /**
   * Проверка полей продукта без обращения к базе.
   * @param {{name:string, amount:*, unit:string}} input
   * @returns {{ok:boolean, errors:string[], value:{name:string, amount:number, unit:string}|null}}
   */
  function validateProductShape(input) {
    const errors = [];
    const name = cleanText(input && input.name);
    const amount = parseAmount(input && input.amount);
    const unit = canonicalUnit(input && input.unit);

    if (!name) errors.push('Укажите название продукта.');
    else if (name.length > 60) errors.push('Название продукта длиннее 60 символов.');
    if (Number.isNaN(amount)) errors.push('Укажите количество числом.');
    else if (amount <= 0) errors.push('Количество должно быть больше нуля.');
    else if (amount > 10000000) errors.push('Слишком большое количество.');
    if (!unit) errors.push('Единица измерения — только г, мл или шт.');

    if (errors.length) return { ok: false, errors, value: null };

    return { ok: true, errors: [], value: { name, amount: round3(amount), unit } };
  }

  /**
   * Валидация продукта для ручного ввода: поля + уникальность названия.
   * @param {{name:string, amount:*, unit:string}} input
   * @param {{id?:string, ignoreId?:string}} [options]
   * @returns {{ok:boolean, errors:string[], value:object|null}}
   */
  function validateProduct(input, options) {
    const opts = options || {};
    const shape = validateProductShape(input);
    if (!shape.ok) return shape;

    // Названия уникальны: сравниваем без учёта регистра и пробелов.
    const key = nameKey(shape.value.name);
    const duplicate = state.fridge.find((p) => nameKey(p.name) === key && p.id !== opts.ignoreId);
    if (duplicate) {
      return {
        ok: false,
        errors: ['Продукт «' + duplicate.name + '» уже есть в холодильнике — отредактируйте его.'],
        value: null
      };
    }

    return {
      ok: true,
      errors: [],
      value: {
        id: cleanText(opts.id) || uid(),
        name: shape.value.name,
        amount: shape.value.amount,
        unit: shape.value.unit
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Валидация блюда
   * ------------------------------------------------------------------ */

  /**
   * @param {object} input {title, section, ingredients[], time, steps[], notes}
   * @returns {{ok:boolean, errors:string[], value:object|null}}
   */
  function validateDish(input) {
    const errors = [];
    const src = input || {};

    const title = cleanText(src.title);
    if (!title) errors.push('Укажите название блюда.');
    else if (title.length > 80) errors.push('Название блюда длиннее 80 символов.');

    const section = cleanText(src.section).toLowerCase();
    if (!isSection(section)) {
      errors.push('Раздел должен быть одним из: breakfast, snack, lunch, dinner.');
    }

    const rawIngredients = Array.isArray(src.ingredients) ? src.ingredients : [];
    const ingredients = [];
    const seen = new Set();

    rawIngredients.forEach((item, index) => {
      const number = index + 1;
      const name = cleanText(item && item.name);
      const amount = parseAmount(item && item.amount);
      const unit = canonicalUnit(item && item.unit);

      if (!name) {
        errors.push('Ингредиент №' + number + ': укажите название.');
        return;
      }
      if (Number.isNaN(amount) || amount <= 0) {
        errors.push('Ингредиент «' + name + '»: количество должно быть больше нуля.');
        return;
      }
      if (!unit) {
        errors.push('Ингредиент «' + name + '»: единица измерения — только г, мл или шт.');
        return;
      }
      const key = nameKey(name) + '|' + unit;
      if (seen.has(key)) {
        errors.push('Ингредиент «' + name + '» указан дважды с одной единицей.');
        return;
      }
      seen.add(key);
      ingredients.push({ name, amount: round3(amount), unit });
    });

    if (!ingredients.length && !errors.length) {
      errors.push('Добавьте хотя бы один ингредиент.');
    } else if (!ingredients.length && errors.length) {
      errors.push('В блюде не осталось ни одного корректного ингредиента.');
    }

    const time = src.time === '' || src.time === null || src.time === undefined
      ? 0
      : parseAmount(src.time);
    if (Number.isNaN(time) || time < 0) {
      errors.push('Время приготовления — число минут (0, если не важно).');
    } else if (time > 1440) {
      errors.push('Время приготовления больше 1440 минут.');
    }

    const steps = (Array.isArray(src.steps) ? src.steps : [])
      .map(cleanText)
      .filter((step) => step.length > 0);

    const notes = cleanText(src.notes);

    if (errors.length) return { ok: false, errors, value: null };

    return {
      ok: true,
      errors: [],
      value: {
        id: cleanText(src.id) || uid(),
        title,
        section,
        ingredients,
        time: round3(time),
        steps,
        notes
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Загрузка / сохранение
   * ------------------------------------------------------------------ */

  /** Мягкая починка записи из localStorage (или из импортируемого файла). */
  function normalizeProduct(raw) {
    // Проверяем только поля: внутри уже готового списка дубликаты не ищем,
    // иначе импорт и списание продуктов отбрасывали бы сами себя.
    const shape = validateProductShape(raw);
    if (!shape.ok) return null;
    return {
      id: cleanText(raw && raw.id) || uid(),
      name: shape.value.name,
      amount: shape.value.amount,
      unit: shape.value.unit
    };
  }

  function normalizeDish(raw) {
    const result = validateDish(raw);
    return result.ok ? result.value : null;
  }

  function dedupeProducts(list) {
    const byKey = new Map();
    list.forEach((product) => {
      const key = nameKey(product.name);
      const existing = byKey.get(key);
      if (existing) {
        // Дубликаты по названию складываем, если единицы совпадают.
        if (existing.unit === product.unit) {
          existing.amount = round3(existing.amount + product.amount);
        }
        return;
      }
      byKey.set(key, product);
    });
    return Array.from(byKey.values());
  }

  function load() {
    const rawDishes = readJSON(KEYS.dishes, []);
    const rawFridge = readJSON(KEYS.fridge, []);
    const dishes = (Array.isArray(rawDishes) ? rawDishes : [])
      .map(normalizeDish)
      .filter(Boolean);
    const fridge = dedupeProducts(
      (Array.isArray(rawFridge) ? rawFridge : []).map(normalizeProduct).filter(Boolean)
    );
    state.dishes = dishes;
    state.fridge = fridge;
    state.loaded = true;
    return state;
  }

  function persistDishes() {
    return writeJSON(KEYS.dishes, state.dishes);
  }

  function persistFridge() {
    return writeJSON(KEYS.fridge, state.fridge);
  }

  /* ------------------------------------------------------------------ *
   * CRUD: холодильник
   * ------------------------------------------------------------------ */

  function getFridge() {
    return state.fridge.slice();
  }

  function getProduct(id) {
    return state.fridge.find((p) => p.id === id) || null;
  }

  function addProduct(input) {
    const result = validateProduct(input);
    if (!result.ok) return result;
    state.fridge.push(result.value);
    state.fridge.sort(compareProducts);
    persistFridge();
    emit();
    return result;
  }

  function updateProduct(id, input) {
    const index = state.fridge.findIndex((p) => p.id === id);
    if (index === -1) {
      return { ok: false, errors: ['Продукт не найден.'], value: null };
    }
    const result = validateProduct(input, { id, ignoreId: id });
    if (!result.ok) return result;
    state.fridge[index] = result.value;
    state.fridge.sort(compareProducts);
    persistFridge();
    emit();
    return result;
  }

  function removeProduct(id) {
    const before = state.fridge.length;
    state.fridge = state.fridge.filter((p) => p.id !== id);
    if (state.fridge.length !== before) {
      persistFridge();
      emit();
      return true;
    }
    return false;
  }

  function compareProducts(a, b) {
    return a.name.localeCompare(b.name, 'ru');
  }

  /** Полная замена списка продуктов (используется после приготовления блюда). */
  function commitFridge(products) {
    state.fridge = dedupeProducts(
      (Array.isArray(products) ? products : []).map(normalizeProduct).filter(Boolean)
    ).sort(compareProducts);
    persistFridge();
    emit();
    return state.fridge;
  }

  /* ------------------------------------------------------------------ *
   * Массовое заполнение холодильника (импорт CSV / списка продуктов)
   * ------------------------------------------------------------------ */

  const PRODUCT_IMPORT_MODES = ['merge', 'sum', 'replace'];

  /**
   * План импорта продуктов: что станет с холодильником.
   * Чистая функция — состояние не меняет, поэтому её же использует предпросмотр.
   *
   * Режимы:
   *   merge   — совпадающие названия обновляются, новые добавляются;
   *   sum     — количества складываются (только при совпадении единиц);
   *   replace — холодильник заменяется содержимым файла.
   *
   * @param {Array} products
   * @param {{mode?:string}} [options]
   * @returns {{mode:string, next:Array, entries:Array, counts:object, warnings:string[]}}
   */
  function planProductImport(products, options) {
    const opts = options || {};
    const mode = PRODUCT_IMPORT_MODES.indexOf(opts.mode) !== -1 ? opts.mode : 'merge';
    const next = mode === 'replace'
      ? []
      : state.fridge.map((p) => ({ id: p.id, name: p.name, amount: p.amount, unit: p.unit }));

    const entries = [];
    const warnings = [];
    const counts = { added: 0, updated: 0, summed: 0, skipped: 0 };

    (Array.isArray(products) ? products : []).forEach((raw, index) => {
      const shape = validateProductShape(raw);
      if (!shape.ok) {
        counts.skipped += 1;
        entries.push({
          row: index + 1,
          name: cleanText(raw && raw.name),
          amount: null,
          unit: '',
          action: 'invalid',
          note: shape.errors.join(' ')
        });
        return;
      }

      const name = shape.value.name;
      const amount = shape.value.amount;
      const unit = shape.value.unit;
      const existing = next.find((product) => nameKey(product.name) === nameKey(name));

      if (existing && mode === 'sum') {
        if (existing.unit !== unit) {
          counts.skipped += 1;
          const note = 'единица не совпадает: в холодильнике ' + existing.unit + ', в файле ' + unit;
          warnings.push('«' + name + '» пропущен — ' + note + '.');
          entries.push({ name, amount, unit, action: 'skip', note, current: existing.amount });
          return;
        }
        existing.amount = round3(existing.amount + amount);
        counts.summed += 1;
        entries.push({ name, amount, unit, action: 'sum', note: '', current: existing.amount });
        return;
      }

      if (existing) {
        existing.amount = amount;
        existing.unit = unit;
        counts.updated += 1;
        entries.push({ name, amount, unit, action: 'update', note: '', current: amount });
        return;
      }

      next.push({ id: uid(), name, amount, unit });
      counts.added += 1;
      entries.push({ name, amount, unit, action: 'new', note: '' });
    });

    return {
      mode,
      next: dedupeProducts(next).sort(compareProducts),
      entries,
      counts,
      warnings
    };
  }

  /**
   * Применяет разобранный список продуктов к холодильнику.
   * @param {Array} products
   * @param {{mode?:string}} [options]
   */
  function importProducts(products, options) {
    const plan = planProductImport(products, options);
    state.fridge = plan.next;
    persistFridge();
    emit();
    return {
      ok: true,
      mode: plan.mode,
      counts: plan.counts,
      warnings: plan.warnings,
      entries: plan.entries,
      total: state.fridge.length
    };
  }

  /* ------------------------------------------------------------------ *
   * CRUD: блюда
   * ------------------------------------------------------------------ */

  function getDishes() {
    return state.dishes.slice();
  }

  function getDish(id) {
    return state.dishes.find((d) => d.id === id) || null;
  }

  function addDish(input) {
    const result = validateDish(input);
    if (!result.ok) return result;
    state.dishes.push(result.value);
    persistDishes();
    emit();
    return result;
  }

  function updateDish(id, input) {
    const index = state.dishes.findIndex((d) => d.id === id);
    if (index === -1) {
      return { ok: false, errors: ['Блюдо не найдено.'], value: null };
    }
    const payload = Object.assign({}, input, { id });
    const result = validateDish(payload);
    if (!result.ok) return result;
    state.dishes[index] = result.value;
    persistDishes();
    emit();
    return result;
  }

  function removeDish(id) {
    const before = state.dishes.length;
    state.dishes = state.dishes.filter((d) => d.id !== id);
    if (state.dishes.length !== before) {
      persistDishes();
      emit();
      return true;
    }
    return false;
  }

  /** Поиск блюда по названию (без учёта регистра и пробелов). */
  function findDishByTitle(title) {
    const key = nameKey(title);
    return state.dishes.find((d) => nameKey(d.title) === key) || null;
  }

  /** Массовое добавление/обновление блюд (импорт CSV). */
  function importDishes(dishes, options) {
    const opts = options || {};
    const updateExisting = opts.updateExisting !== false;
    let added = 0;
    let updated = 0;
    const errors = [];

    (Array.isArray(dishes) ? dishes : []).forEach((dish, index) => {
      const normalized = normalizeDish(dish);
      if (!normalized) {
        errors.push('Блюдо №' + (index + 1) + ' не прошло проверку.');
        return;
      }
      const existing = findDishByTitle(normalized.title);
      if (existing && updateExisting) {
        normalized.id = existing.id;
        const position = state.dishes.indexOf(existing);
        state.dishes[position] = normalized;
        updated += 1;
      } else {
        state.dishes.push(normalized);
        added += 1;
      }
    });

    persistDishes();
    emit();
    return { added, updated, errors };
  }

  /* ------------------------------------------------------------------ *
   * Экспорт / импорт / сброс
   * ------------------------------------------------------------------ */

  function exportData() {
    return {
      app: APP_ID,
      version: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      dishes: getDishes(),
      fridge: getFridge()
    };
  }

  /**
   * Импорт базы из JSON.
   * @param {object|string} payload
   * @returns {{ok:boolean, errors:string[], warnings:string[], imported:object}}
   */
  function importData(payload) {
    let data = payload;
    if (typeof payload === 'string') {
      try {
        data = JSON.parse(payload);
      } catch (err) {
        return { ok: false, errors: ['Файл не является корректным JSON.'], warnings: [], imported: null };
      }
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { ok: false, errors: ['Ожидается объект с полями «dishes» и «fridge».'], warnings: [], imported: null };
    }

    const warnings = [];
    const rawDishes = Array.isArray(data.dishes) ? data.dishes : [];
    const rawFridge = Array.isArray(data.fridge) ? data.fridge : [];

    if (!Array.isArray(data.dishes)) warnings.push('В файле нет списка блюд.');
    if (!Array.isArray(data.fridge)) warnings.push('В файле нет списка продуктов холодильника.');

    const dishes = [];
    rawDishes.forEach((item, index) => {
      const dish = normalizeDish(item);
      if (dish) dishes.push(dish);
      else warnings.push('Блюдо №' + (index + 1) + ' пропущено: неполные данные.');
    });

    const fridge = [];
    rawFridge.forEach((item, index) => {
      const product = normalizeProduct(item);
      if (product) fridge.push(product);
      else warnings.push('Продукт №' + (index + 1) + ' пропущен: нет названия, количества или единицы.');
    });

    state.dishes = dishes;
    state.fridge = dedupeProducts(fridge).sort(compareProducts);
    persistDishes();
    persistFridge();
    emit();

    return {
      ok: true,
      errors: [],
      warnings,
      imported: { dishes: dishes.length, fridge: state.fridge.length }
    };
  }

  function resetAll() {
    state.dishes = [];
    state.fridge = [];
    storageRemove(KEYS.dishes);
    storageRemove(KEYS.fridge);
    emit();
  }

  /* ------------------------------------------------------------------ *
   * Настройки интерфейса (последняя вкладка, фильтр)
   * ------------------------------------------------------------------ */

  function getUI() {
    const raw = readJSON(KEYS.ui, {});
    return raw && typeof raw === 'object' ? raw : {};
  }

  function setUI(patch) {
    const next = Object.assign(getUI(), patch);
    writeJSON(KEYS.ui, next);
    return next;
  }

  /* ------------------------------------------------------------------ *
   * Сводка
   * ------------------------------------------------------------------ */

  function stats() {
    return {
      dishes: state.dishes.length,
      fridge: state.fridge.length,
      bySection: SECTIONS.reduce((acc, section) => {
        acc[section.id] = state.dishes.filter((d) => d.section === section.id).length;
        return acc;
      }, {})
    };
  }

  /* ------------------------------------------------------------------ *
   * Публичный API
   * ------------------------------------------------------------------ */

  global.CookbookStore = {
    KEYS,
    UNITS,
    SECTIONS,
    SECTION_IDS,
    SCHEMA_VERSION,
    APP_ID,

    // утилиты, которые нужны модулю сопоставления и CSV-импорту
    utils: {
      uid,
      round3,
      cleanText,
      nameKey,
      canonicalUnit,
      parseAmount,
      isSection,
      sectionById
    },

    // чтение состояния
    load,
    subscribe,
    getState() {
      return state;
    },
    getDishes,
    getDish,
    getFridge,
    getProduct,
    stats,
    findDishByTitle,

    // запись
    addDish,
    updateDish,
    removeDish,
    importDishes,
    addProduct,
    updateProduct,
    removeProduct,
    commitFridge,
    planProductImport,
    importProducts,
    importData,
    exportData,
    resetAll,
    validateDish,
    validateProduct,
    validateProductShape,
    PRODUCT_IMPORT_MODES,

    // настройки интерфейса
    getUI,
    setUI
  };
})(typeof window !== 'undefined' ? window : globalThis);
