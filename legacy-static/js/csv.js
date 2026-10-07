/* ============================================================================
 * csv.js — импорт блюд из CSV и выгрузка базы в CSV.
 *
 * Формат (первая строка — заголовки):
 *   title,section,ingredients,time,steps,notes
 *
 *   section     — breakfast | snack | lunch | dinner (можно по-русски: завтрак …)
 *   ingredients — «название|количество|единица» через «;»
 *                 например: яйца|3|шт;сыр|50|г
 *   steps       — шаги через «;»
 *   time        — минуты (можно оставить пустым)
 *
 * Разделитель колонок определяется автоматически: «,», «;» или табуляция.
 * Модуль чистый, DOM не использует. Публикует window.CookbookCSV.
 * ========================================================================== */
(function (global) {
  'use strict';

  const Store = global.CookbookStore;
  const { cleanText, canonicalUnit, parseAmount, round3, uid } = Store.utils;

  const COLUMNS = ['title', 'section', 'ingredients', 'time', 'steps', 'notes'];

  /** Колонки файла холодильника. */
  const PRODUCT_COLUMNS = ['name', 'amount', 'unit'];

  /** Русские и сокращённые заголовки. */
  const HEADER_ALIASES = {
    title: 'title', 'название': 'title', 'блюдо': 'title', 'наименование': 'title',
    section: 'section', 'раздел': 'section', 'категория': 'section',
    ingredients: 'ingredients', 'ингредиенты': 'ingredients', 'состав': 'ingredients',
    time: 'time', 'время': 'time', 'минуты': 'time',
    steps: 'steps', 'шаги': 'steps', 'приготовление': 'steps', 'рецепт': 'steps',
    notes: 'notes', 'заметки': 'notes', 'примечания': 'notes', 'комментарий': 'notes'
  };

  /** Заголовки файла холодильника: name,amount,unit. */
  const PRODUCT_HEADER_ALIASES = {
    name: 'name', 'название': 'name', 'продукт': 'name', 'наименование': 'name',
    amount: 'amount', 'количество': 'amount', 'кол-во': 'amount', 'кол': 'amount',
    unit: 'unit', 'единица': 'unit', 'ед': 'unit', 'ед.': 'unit', 'ед.изм': 'unit', 'единицаизмерения': 'unit'
  };

  /** Разделы на двух языках. */
  const SECTION_ALIASES = {
    breakfast: 'breakfast', 'завтрак': 'breakfast', 'завтраки': 'breakfast', b: 'breakfast',
    snack: 'snack', 'полдник': 'snack', 'перекус': 'snack', s: 'snack',
    lunch: 'lunch', 'обед': 'lunch', 'обеды': 'lunch', l: 'lunch',
    dinner: 'dinner', 'ужин': 'dinner', 'ужины': 'dinner', d: 'dinner'
  };

  const SECTION_FOR_EXPORT = {
    breakfast: 'breakfast',
    snack: 'snack',
    lunch: 'lunch',
    dinner: 'dinner'
  };

  /* ------------------------------------------------------------------ *
   * Низкоуровневый разбор CSV
   * ------------------------------------------------------------------ */

  /** Определяет разделитель колонок по строке заголовков. */
  function detectDelimiter(text) {
    const firstLine = String(text).replace(/^\uFEFF/, '').split(/\r?\n/)[0] || '';
    const candidates = [',', ';', '\t'];
    let best = ',';
    let bestCount = 0;
    candidates.forEach((candidate) => {
      const count = firstLine.split(candidate).length - 1;
      if (count > bestCount) {
        bestCount = count;
        best = candidate;
      }
    });
    return best;
  }

  /**
   * Разбирает CSV в массив массивов ячеек (поддержаны кавычки и переносы строк).
   * @param {string} text
   * @param {string} [delimiter]
   * @returns {string[][]}
   */
  function parseRows(text, delimiter) {
    const source = String(text === null || text === undefined ? '' : text).replace(/^\uFEFF/, '');
    const delim = delimiter || detectDelimiter(source);
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];

      if (inQuotes) {
        if (char === '"') {
          if (source[i + 1] === '"') {
            field += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') {
        inQuotes = true;
      } else if (char === delim) {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char === '\r') {
        /* пропускаем, перенос обработает \n */
      } else {
        field += char;
      }
    }

    row.push(field);
    rows.push(row);

    // Отбрасываем полностью пустые строки.
    return rows.filter((cells) => cells.some((cell) => cleanText(cell) !== ''));
  }

  /* ------------------------------------------------------------------ *
   * Разбор предметных значений
   * ------------------------------------------------------------------ */

  function mapHeader(cell) {
    const key = cleanText(cell).toLowerCase().replace(/[«»"']/g, '');
    return HEADER_ALIASES[key] || '';
  }

  function mapSection(value) {
    const key = cleanText(value).toLowerCase();
    return SECTION_ALIASES[key] || '';
  }

  /**
   * «яйца|3|шт;сыр|50|г» → массив ингредиентов.
   * @returns {{ingredients:Array, errors:string[]}}
   */
  function parseIngredients(value) {
    const errors = [];
    const ingredients = [];
    const chunks = cleanText(value)
      .split(/[;\n]/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);

    if (!chunks.length) {
      errors.push('не заполнено поле «ingredients»');
      return { ingredients, errors };
    }

    chunks.forEach((chunk) => {
      const parts = chunk.split('|').map((part) => part.trim());
      const name = parts[0] || '';
      const amountRaw = parts.length > 1 ? parts[1] : '';
      const unitRaw = parts.length > 2 ? parts[2] : '';

      if (parts.length < 3) {
        errors.push('ингредиент «' + chunk + '»: нужен формат название|количество|единица');
        return;
      }
      if (!name) {
        errors.push('ингредиент «' + chunk + '»: нет названия');
        return;
      }
      const amount = parseAmount(amountRaw);
      if (Number.isNaN(amount) || amount <= 0) {
        errors.push('ингредиент «' + name + '»: количество «' + amountRaw + '» не число больше нуля');
        return;
      }
      const unit = canonicalUnit(unitRaw);
      if (!unit) {
        errors.push('ингредиент «' + name + '»: единица «' + unitRaw + '» не поддерживается (г, мл, шт)');
        return;
      }
      ingredients.push({ name, amount: round3(amount), unit });
    });

    return { ingredients, errors };
  }

  function parseSteps(value) {
    return cleanText(value)
      .split(/[;\n]/)
      .map((step) => step.trim())
      .filter(Boolean);
  }

  /* ------------------------------------------------------------------ *
   * Основной разбор файла
   * ------------------------------------------------------------------ */

  /**
   * Превращает CSV-текст в список блюд.
   * @param {string} text
   * @returns {{dishes:Array, errors:Array<{row:number,message:string}>,
   *            rows:number, delimiter:string}}
   */
  function parseDishes(text) {
    const delimiter = detectDelimiter(text);
    const rows = parseRows(text, delimiter);
    const errors = [];
    const dishes = [];

    if (!rows.length) {
      return { dishes, errors: [{ row: 0, message: 'Файл пустой.' }], rows: 0, delimiter };
    }

    const header = rows[0].map(mapHeader);
    const hasHeader = header.indexOf('title') !== -1;

    if (!hasHeader) {
      return {
        dishes,
        errors: [{
          row: 1,
          message: 'Не найдена колонка «title». Ожидаются заголовки: ' + COLUMNS.join(', ')
        }],
        rows: rows.length,
        delimiter
      };
    }

    const dataRows = rows.slice(1);

    dataRows.forEach((cells, index) => {
      const rowNumber = index + 2; // +1 заголовок, +1 нумерация с единицы
      const record = {};

      header.forEach((column, position) => {
        if (!column) return;
        record[column] = cells[position] === undefined ? '' : cells[position];
      });

      const title = cleanText(record.title);
      if (!title) {
        errors.push({ row: rowNumber, message: 'не заполнено название блюда' });
        return;
      }

      const section = mapSection(record.section);
      if (!section) {
        errors.push({
          row: rowNumber,
          message: 'раздел «' + cleanText(record.section) + '» неизвестен (breakfast, snack, lunch, dinner)'
        });
        return;
      }

      const parsedIngredients = parseIngredients(record.ingredients);
      if (parsedIngredients.errors.length) {
        parsedIngredients.errors.forEach((message) => {
          errors.push({ row: rowNumber, message: title + ': ' + message });
        });
        return;
      }

      const timeRaw = cleanText(record.time);
      let time = 0;
      if (timeRaw !== '') {
        time = parseAmount(timeRaw);
        if (Number.isNaN(time) || time < 0) {
          errors.push({ row: rowNumber, message: title + ': время «' + timeRaw + '» не число' });
          return;
        }
      }

      const dish = {
        id: uid(),
        title,
        section,
        ingredients: parsedIngredients.ingredients,
        time: round3(time),
        steps: parseSteps(record.steps),
        notes: cleanText(record.notes)
      };

      // Финальная проверка теми же правилами, что и ручной ввод.
      const validation = Store.validateDish(dish);
      if (!validation.ok) {
        validation.errors.forEach((message) => {
          errors.push({ row: rowNumber, message: title + ': ' + message });
        });
        return;
      }

      dishes.push(validation.value);
    });

    return { dishes, errors, rows: dataRows.length, delimiter };
  }

  /* ------------------------------------------------------------------ *
   * Холодильник: name,amount,unit
   * ------------------------------------------------------------------ */

  function mapProductHeader(cell) {
    const key = cleanText(cell).toLowerCase().replace(/[«»"'.]/g, '');
    return PRODUCT_HEADER_ALIASES[key] || '';
  }

  /**
   * Разбирает CSV холодильника. Строка заголовков не обязательна:
   * файл из одних данных (мука,1000,г) читается так же, как с заголовками.
   *
   * @param {string} text
   * @returns {{products:Array, errors:Array<{row:number,message:string}>,
   *            rows:number, delimiter:string, hasHeader:boolean}}
   */
  function parseProducts(text) {
    const delimiter = detectDelimiter(text);
    const rows = parseRows(text, delimiter);
    const errors = [];
    const products = [];

    if (!rows.length) {
      return { products, errors: [{ row: 0, message: 'Файл пустой.' }], rows: 0, delimiter, hasHeader: false };
    }

    const header = rows[0].map(mapProductHeader);
    const hasHeader = header.indexOf('name') !== -1;

    if (hasHeader) {
      const missing = PRODUCT_COLUMNS.filter((column) => header.indexOf(column) === -1);
      if (missing.length) {
        return {
          products,
          errors: [{
            row: 1,
            message: 'Не найдены колонки: ' + missing.join(', ') + '. Ожидаются name, amount, unit.'
          }],
          rows: 0,
          delimiter,
          hasHeader: true
        };
      }
    }

    const map = hasHeader ? header : PRODUCT_COLUMNS.slice();
    const start = hasHeader ? 1 : 0;
    const dataRows = rows.slice(start);

    dataRows.forEach((cells, index) => {
      const rowNumber = start === 1 ? index + 2 : index + 1;
      const record = {};

      map.forEach((column, position) => {
        if (!column) return;
        record[column] = cells[position] === undefined ? '' : cells[position];
      });

      const shape = Store.validateProductShape(record);
      if (!shape.ok) {
        errors.push({ row: rowNumber, message: shape.errors.join(' ') });
        return;
      }
      products.push(shape.value);
    });

    return { products, errors, rows: dataRows.length, delimiter, hasHeader };
  }

  /** @returns {string} CSV холодильника (с BOM — Excel откроет в UTF-8). */
  function toProductsCSV(products) {
    const lines = [PRODUCT_COLUMNS.join(',')];
    (Array.isArray(products) ? products : []).forEach((product) => {
      lines.push([product.name, product.amount, product.unit].map(escapeCell).join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /** Шаблон файла холодильника. */
  function productsTemplate() {
    return toProductsCSV([
      { name: 'мука', amount: 1000, unit: 'г' },
      { name: 'молоко', amount: 1000, unit: 'мл' },
      { name: 'яйца', amount: 10, unit: 'шт' }
    ]);
  }

  /* ------------------------------------------------------------------ *
   * Выгрузка
   * ------------------------------------------------------------------ */

  function escapeCell(value) {
    const text = String(value === null || value === undefined ? '' : value);
    if (/[",;\n\r]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }

  function dishToRow(dish) {
    const ingredients = (dish.ingredients || [])
      .map((item) => item.name + '|' + item.amount + '|' + item.unit)
      .join(';');
    const steps = (dish.steps || []).join(';');
    return [
      dish.title,
      SECTION_FOR_EXPORT[dish.section] || dish.section,
      ingredients,
      dish.time || '',
      steps,
      dish.notes || ''
    ];
  }

  /** @returns {string} CSV со всеми блюдами (с BOM — Excel откроет в UTF-8). */
  function toCSV(dishes) {
    const lines = [COLUMNS.join(',')];
    (Array.isArray(dishes) ? dishes : []).forEach((dish) => {
      lines.push(dishToRow(dish).map(escapeCell).join(','));
    });
    return '\uFEFF' + lines.join('\r\n') + '\r\n';
  }

  /** Шаблон с примерами — чтобы было видно формат. */
  function template() {
    const sample = [
      {
        title: 'Омлет с сыром',
        section: 'breakfast',
        ingredients: [
          { name: 'яйца', amount: 3, unit: 'шт' },
          { name: 'сыр', amount: 50, unit: 'г' },
          { name: 'молоко', amount: 50, unit: 'мл' }
        ],
        time: 15,
        steps: ['Взбить яйца с молоком', 'Добавить тёртый сыр', 'Обжарить под крышкой 5 минут'],
        notes: 'Солить в самом конце'
      },
      {
        title: 'Салат из огурцов и помидоров',
        section: 'lunch',
        ingredients: [
          { name: 'огурцы', amount: 200, unit: 'г' },
          { name: 'помидоры', amount: 200, unit: 'г' }
        ],
        time: 10,
        steps: ['Нарезать овощи', 'Посолить и заправить маслом'],
        notes: ''
      }
    ];
    return toCSV(sample);
  }

  /* ------------------------------------------------------------------ *
   * Публичный API
   * ------------------------------------------------------------------ */

  global.CookbookCSV = {
    COLUMNS,
    PRODUCT_COLUMNS,
    detectDelimiter,
    parseRows,
    parseIngredients,
    parseDishes,
    parseProducts,
    toCSV,
    toProductsCSV,
    template,
    productsTemplate
  };
})(typeof window !== 'undefined' ? window : globalThis);
