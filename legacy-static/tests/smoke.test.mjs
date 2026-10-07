import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

/* ------------------------------------------------------------------ *
 * Заглушка localStorage — модули рассчитаны на браузер.
 * ------------------------------------------------------------------ */
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
};

const root = path.resolve(import.meta.dirname, '..');
const sources = ['js/store.js', 'js/matcher.js', 'js/csv.js']
  .map((file) => fs.readFileSync(path.join(root, file), 'utf8'))
  .join('\n');

new Function(sources).call(globalThis);

const Store = globalThis.CookbookStore;
const Matcher = globalThis.CookbookMatcher;
const CSV = globalThis.CookbookCSV;

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error });
  }
}

function freshStore() {
  Store.resetAll();
}

/* ================================================================== *
 * 1. Продукты холодильника
 * ================================================================== */

test('продукт без единицы измерения не сохраняется', () => {
  freshStore();
  const result = Store.addProduct({ name: 'мука', amount: 1000, unit: 'ст.л.' });
  assert.equal(result.ok, false);
  assert.equal(Store.getFridge().length, 0);
});

test('продукт без количества не сохраняется', () => {
  freshStore();
  assert.equal(Store.addProduct({ name: 'мука', amount: '', unit: 'г' }).ok, false);
  assert.equal(Store.addProduct({ name: 'мука', amount: 0, unit: 'г' }).ok, false);
  assert.equal(Store.getFridge().length, 0);
});

test('названия уникальны без учёта регистра и пробелов', () => {
  freshStore();
  assert.equal(Store.addProduct({ name: 'Мука', amount: 1000, unit: 'г' }).ok, true);
  const duplicate = Store.addProduct({ name: '  мука  ', amount: 500, unit: 'г' });
  assert.equal(duplicate.ok, false);
  assert.equal(Store.getFridge().length, 1);
});

test('«1,5» разбирается как 1.5', () => {
  freshStore();
  const result = Store.addProduct({ name: 'масло', amount: '1,5', unit: 'мл' });
  assert.equal(result.ok, true);
  assert.equal(result.value.amount, 1.5);
});

/* ================================================================== *
 * 2. Сопоставление ингредиентов
 * ================================================================== */

const fridge = [
  { id: 'p1', name: 'яйца', amount: 10, unit: 'шт' },
  { id: 'p2', name: 'сыр', amount: 120, unit: 'г' },
  { id: 'p3', name: 'Масло сливочное', amount: 200, unit: 'мл' }
];

test('название сравнивается без регистра и пробелов', () => {
  const check = Matcher.checkIngredient({ name: ' ЯЙЦА ', amount: 3, unit: 'шт' }, Matcher.indexFridge(fridge));
  assert.equal(check.status, 'ok');
  assert.equal(check.have, 10);
});

test('единица измерения должна совпадать строго', () => {
  const check = Matcher.checkIngredient({ name: 'масло сливочное', amount: 30, unit: 'г' }, Matcher.indexFridge(fridge));
  assert.equal(check.status, 'unit');
  assert.equal(check.actualUnit, 'мл');
});

test('недостаточное количество помечается как нехватка', () => {
  const check = Matcher.checkIngredient({ name: 'сыр', amount: 200, unit: 'г' }, Matcher.indexFridge(fridge));
  assert.equal(check.status, 'short');
  assert.equal(check.have, 120);
});

test('неизвестный продукт отсутствует', () => {
  const check = Matcher.checkIngredient({ name: 'бекон', amount: 50, unit: 'г' }, Matcher.indexFridge(fridge));
  assert.equal(check.status, 'absent');
});

test('оценка блюда сообщает, чего не хватает', () => {
  const dish = {
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [
      { name: 'яйца', amount: 3, unit: 'шт' },
      { name: 'сыр', amount: 200, unit: 'г' },
      { name: 'бекон', amount: 50, unit: 'г' }
    ]
  };
  const evaluation = Matcher.evaluate(dish, fridge);
  assert.equal(evaluation.available, false);
  assert.equal(evaluation.total, 3);
  assert.equal(evaluation.ready, 1);
  assert.equal(evaluation.missingText, 'сыр 200 г, бекон 50 г');
});

test('блюдо доступно, когда всё есть', () => {
  const dish = {
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [
      { name: 'яйца', amount: 3, unit: 'шт' },
      { name: 'сыр', amount: 50, unit: 'г' }
    ]
  };
  assert.equal(Matcher.canCook(dish, fridge), true);
  assert.equal(Matcher.availableDishes([dish], fridge).length, 1);
});

/* ================================================================== *
 * 3. Приготовление
 * ================================================================== */

const cookFridge = [
  { id: 'p1', name: 'яйца', amount: 3, unit: 'шт' },
  { id: 'p2', name: 'сыр', amount: 120, unit: 'г' },
  { id: 'p3', name: 'молоко', amount: 50, unit: 'мл' }
];

test('приготовление списывает продукты', () => {
  const dish = {
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [
      { name: 'яйца', amount: 2, unit: 'шт' },
      { name: 'сыр', amount: 50, unit: 'г' }
    ]
  };
  const plan = Matcher.planCooking(dish, cookFridge);
  assert.equal(plan.ok, true);
  assert.equal(plan.fridge.find((p) => p.name === 'яйца').amount, 1);
  assert.equal(plan.fridge.find((p) => p.name === 'сыр').amount, 70);
});

test('продукт с нулевым остатком удаляется', () => {
  const dish = {
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [
      { name: 'яйца', amount: 3, unit: 'шт' },
      { name: 'молоко', amount: 50, unit: 'мл' }
    ]
  };
  const plan = Matcher.planCooking(dish, cookFridge);
  assert.equal(plan.ok, true);
  assert.equal(plan.fridge.some((p) => p.name === 'яйца'), false);
  assert.equal(plan.fridge.some((p) => p.name === 'молоко'), false);
  assert.deepEqual(plan.removed.sort(), ['молоко', 'яйца']);
  assert.equal(plan.fridge.length, 1);
});

test('приготовить блюдо, которого не хватает, нельзя', () => {
  const dish = {
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [{ name: 'сыр', amount: 500, unit: 'г' }]
  };
  const plan = Matcher.planCooking(dish, cookFridge);
  assert.equal(plan.ok, false);
  assert.match(plan.error, /Не хватает: сыр 500 г/);
  assert.equal(plan.fridge.find((p) => p.name === 'сыр').amount, 120);
});

test('исходный холодильник не меняется при планировании', () => {
  const dish = {
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [{ name: 'сыр', amount: 50, unit: 'г' }]
  };
  Matcher.planCooking(dish, cookFridge);
  assert.equal(cookFridge.find((p) => p.name === 'сыр').amount, 120);
});

/* ================================================================== *
 * 4. Блюда
 * ================================================================== */

test('блюдо требует название, раздел и ингредиенты', () => {
  const noTitle = Store.validateDish({ title: '  ', section: 'breakfast', ingredients: [{ name: 'яйца', amount: 1, unit: 'шт' }] });
  assert.equal(noTitle.ok, false);
  const badSection = Store.validateDish({ title: 'Тест', section: 'ночь', ingredients: [{ name: 'яйца', amount: 1, unit: 'шт' }] });
  assert.equal(badSection.ok, false);
  const noIngredients = Store.validateDish({ title: 'Тест', section: 'snack', ingredients: [] });
  assert.equal(noIngredients.ok, false);
});

test('ингредиент с неподдерживаемой единицей отклоняется', () => {
  const result = Store.validateDish({
    title: 'Тест',
    section: 'lunch',
    ingredients: [{ name: 'масло', amount: 1, unit: 'ст.л.' }]
  });
  assert.equal(result.ok, false);
});

test('действия CRUD по блюдам сохраняются в localStorage', () => {
  freshStore();
  const added = Store.addDish({
    title: 'Омлет с сыром',
    section: 'breakfast',
    ingredients: [{ name: 'яйца', amount: 3, unit: 'шт' }],
    time: 15,
    steps: ['Взбить яйца'],
    notes: ''
  });
  assert.equal(added.ok, true);

  Store.updateDish(added.value.id, {
    title: 'Омлет с сыром и томатами',
    section: 'breakfast',
    ingredients: [{ name: 'яйца', amount: 3, unit: 'шт' }],
    time: 20
  });
  assert.equal(Store.getDish(added.value.id).title, 'Омлет с сыром и томатами');

  const raw = JSON.parse(localStorage.getItem(Store.KEYS.dishes));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].time, 20);

  Store.removeDish(added.value.id);
  assert.equal(Store.getDishes().length, 0);
});

test('экспорт и импорт базы сохраняют данные', () => {
  freshStore();
  Store.addProduct({ name: 'мука', amount: 1000, unit: 'г' });
  Store.addDish({
    title: 'Блины',
    section: 'breakfast',
    ingredients: [{ name: 'мука', amount: 200, unit: 'г' }, { name: 'молоко', amount: 500, unit: 'мл' }]
  });
  const backup = JSON.parse(JSON.stringify(Store.exportData()));

  freshStore();
  assert.equal(Store.getDishes().length, 0);

  const result = Store.importData(backup);
  assert.equal(result.ok, true);
  assert.equal(result.imported.dishes, 1);
  assert.equal(result.imported.fridge, 1);
  assert.equal(Store.getDishes()[0].title, 'Блины');
});

test('повреждённый JSON не ломает импорт', () => {
  const result = Store.importData('{ это не json');
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
});

test('замена холодильника после готовки сохраняет остальные продукты', () => {
  freshStore();
  Store.addProduct({ name: 'мука', amount: 1000, unit: 'г' });
  Store.addProduct({ name: 'сыр', amount: 300, unit: 'г' });
  Store.addProduct({ name: 'молоко', amount: 1000, unit: 'мл' });
  Store.addProduct({ name: 'яйца', amount: 3, unit: 'шт' });

  const dish = {
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [
      { name: 'яйца', amount: 3, unit: 'шт' },
      { name: 'сыр', amount: 50, unit: 'г' },
      { name: 'молоко', amount: 50, unit: 'мл' }
    ]
  };
  const plan = Matcher.planCooking(dish, Store.getFridge());
  assert.equal(plan.ok, true);

  const left = Store.commitFridge(plan.fridge);
  assert.equal(left.length, 3, 'должны остаться мука, сыр и молоко');
  assert.equal(left.find((p) => p.name === 'сыр').amount, 250);
  assert.equal(left.find((p) => p.name === 'молоко').amount, 950);
  assert.equal(left.find((p) => p.name === 'мука').amount, 1000);
  assert.equal(left.some((p) => p.name === 'яйца'), false);
});

test('повторный импорт базы поверх непустого холодильника ничего не теряет', () => {
  freshStore();
  Store.addProduct({ name: 'мука', amount: 500, unit: 'г' });
  Store.addProduct({ name: 'сыр', amount: 100, unit: 'г' });
  const backup = Store.exportData();

  const result = Store.importData(JSON.parse(JSON.stringify(backup)));
  assert.equal(result.ok, true);
  assert.equal(result.imported.fridge, 2, 'оба продукта должны остаться');
  assert.equal(Store.getFridge().length, 2);
});

/* ================================================================== *
 * 5. CSV
 * ================================================================== */

test('образец CSV разбирается без ошибок', () => {
  const text = fs.readFileSync(path.join(root, 'examples/sample-recipes.csv'), 'utf8');
  const parsed = CSV.parseDishes(text);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.dishes.length, 9);
  assert.equal(parsed.dishes[0].title, 'Омлет с сыром');
  assert.equal(parsed.dishes[0].ingredients.length, 3);
  assert.equal(parsed.dishes[0].ingredients[1].unit, 'г');
  assert.equal(parsed.dishes[0].steps.length, 3);
});

test('CSV с точкой с запятой тоже читается', () => {
  const text = 'title;section;ingredients;time;steps\nСырники;завтрак;творог|400|г;25;Смешать и обжарить';
  const parsed = CSV.parseDishes(text);
  assert.equal(parsed.delimiter, ';');
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.dishes.length, 1);
  assert.equal(parsed.dishes[0].section, 'breakfast');
  assert.equal(parsed.dishes[0].steps.length, 1);
});

test('ошибки CSV сообщают номер строки и причину', () => {
  const text = [
    'title,section,ingredients,time,steps,notes',
    ',breakfast,яйца|3|шт,10,,',
    'Тест,ночь,яйца|3|шт,10,,',
    'Тест2,lunch,яйца|три|шт,10,,',
    'Тест3,lunch,яйца|3|ст.л.,10,,',
    'Хорошее блюдо,dinner,яйца|3|шт,5,Пожарить,'
  ].join('\n');
  const parsed = CSV.parseDishes(text);
  assert.equal(parsed.dishes.length, 1);
  assert.equal(parsed.dishes[0].title, 'Хорошее блюдо');
  assert.equal(parsed.errors.length, 4);
  assert.equal(parsed.errors[0].row, 2);
  assert.match(parsed.errors[0].message, /название/);
  assert.match(parsed.errors[1].message, /раздел/);
  assert.match(parsed.errors[2].message, /количество/);
  assert.match(parsed.errors[3].message, /единица/);
});

test('кавычки и запятые внутри полей не ломают разбор', () => {
  const text = 'title,section,ingredients,time,steps,notes\n"Омлет, с сыром",breakfast,яйца|3|шт,15,"Взбить;Обжарить","Соль, перец"';
  const parsed = CSV.parseDishes(text);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.dishes[0].title, 'Омлет, с сыром');
  assert.equal(parsed.dishes[0].notes, 'Соль, перец');
});

test('выгрузка CSV читается обратно (round-trip)', () => {
  freshStore();
  Store.addDish({
    title: 'Борщ; со сметаной',
    section: 'lunch',
    ingredients: [{ name: 'свёкла', amount: 300, unit: 'г' }, { name: 'вода', amount: 2000, unit: 'мл' }],
    time: 90,
    steps: ['Сварить бульон', 'Добавить свёклу'],
    notes: 'Настоять час'
  });
  const csv = CSV.toCSV(Store.getDishes());
  const parsed = CSV.parseDishes(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.dishes.length, 1);
  assert.equal(parsed.dishes[0].title, 'Борщ; со сметаной');
  assert.equal(parsed.dishes[0].ingredients[1].amount, 2000);
  assert.equal(parsed.dishes[0].steps.length, 2);
});

test('шаблон CSV содержит заголовки', () => {
  const template = CSV.template();
  assert.ok(template.includes('title,section,ingredients,time,steps,notes'));
  const parsed = CSV.parseDishes(template);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.dishes.length, 2);
});

/* ================================================================== *
 * 6. Массовый импорт блюд
 * ================================================================== */

test('повторный импорт CSV обновляет блюдо, а не дублирует', () => {
  freshStore();
  const first = Store.importDishes([{
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [{ name: 'яйца', amount: 3, unit: 'шт' }]
  }]);
  assert.equal(first.added, 1);

  const second = Store.importDishes([{
    title: 'омлет',
    section: 'breakfast',
    ingredients: [{ name: 'яйца', amount: 4, unit: 'шт' }]
  }]);
  assert.equal(second.updated, 1);
  assert.equal(Store.getDishes().length, 1);
  assert.equal(Store.getDishes()[0].ingredients[0].amount, 4);
});

/* ================================================================== *
 * 7. Холодильник из CSV (name,amount,unit)
 * ================================================================== */

test('CSV холодильника разбирается с заголовками', () => {
  const parsed = CSV.parseProducts('name,amount,unit\nмука,1000,г\nяйца,10,шт');
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.hasHeader, true);
  assert.equal(parsed.products.length, 2);
  assert.deepEqual(parsed.products[0], { name: 'мука', amount: 1000, unit: 'г' });
});

test('CSV холодильника читается и без строки заголовков', () => {
  const parsed = CSV.parseProducts('мука,1000,г\nмолоко,"1,5",мл');
  assert.equal(parsed.hasHeader, false);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.products.length, 2);
  assert.equal(parsed.products[1].amount, 1.5, 'дробное количество в кавычках');
  assert.equal(parsed.products[1].unit, 'мл');

  const dots = CSV.parseProducts('мука,1000,г\nмолоко,1.5,мл');
  assert.equal(dots.products[1].amount, 1.5, 'точка как разделитель дробной части тоже работает');
});

test('русские заголовки и точка с запятой поддерживаются', () => {
  const parsed = CSV.parseProducts('название;количество;единица\nсыр;300;г');
  assert.equal(parsed.delimiter, ';');
  assert.equal(parsed.errors.length, 0);
  assert.deepEqual(parsed.products[0], { name: 'сыр', amount: 300, unit: 'г' });
});

test('латиница в единицах приводится к г/мл/шт, мусор — отклоняется', () => {
  const parsed = CSV.parseProducts('name,amount,unit\nмука,1,kg\nсыр,200,g\nмолоко,1,л');
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].unit, 'г');
  assert.equal(parsed.errors.length, 2);
  assert.equal(parsed.errors[0].row, 2);
  assert.match(parsed.errors[0].message, /Единица измерения/);
});

test('ошибки в строках холодильника сообщают номер строки', () => {
  const parsed = CSV.parseProducts([
    'name,amount,unit',
    'мука,,г',
    ',500,г',
    'сахар,0,г',
    'соль,200,г'
  ].join('\n'));
  assert.equal(parsed.products.length, 1);
  assert.equal(parsed.products[0].name, 'соль');
  assert.deepEqual(parsed.errors.map((error) => error.row), [2, 3, 4]);
});

test('файл без колонки unit отклоняется целиком', () => {
  const parsed = CSV.parseProducts('name,amount\nмука,1000');
  assert.equal(parsed.products.length, 0);
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].message, /Не найдены колонки: unit/);
});

test('пример файла холодильника разбирается без ошибок', () => {
  const text = fs.readFileSync(path.join(root, 'examples/sample-fridge.csv'), 'utf8');
  const parsed = CSV.parseProducts(text);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.products.length, 13);
});

test('режим merge добавляет новые и обновляет существующие', () => {
  freshStore();
  Store.addProduct({ name: 'мука', amount: 500, unit: 'г' });
  const result = Store.importProducts([
    { name: 'Мука', amount: 2000, unit: 'г' },
    { name: 'сыр', amount: 300, unit: 'г' }
  ], { mode: 'merge' });

  assert.equal(result.counts.updated, 1);
  assert.equal(result.counts.added, 1);
  assert.equal(Store.getFridge().find((p) => p.name === 'мука').amount, 2000);
  assert.equal(Store.getFridge().find((p) => p.name === 'сыр').amount, 300);
  assert.equal(Store.getFridge().length, 2);
});

test('режим sum складывает количества только при совпадении единиц', () => {
  freshStore();
  Store.addProduct({ name: 'мука', amount: 500, unit: 'г' });
  Store.addProduct({ name: 'молоко', amount: 500, unit: 'мл' });

  const result = Store.importProducts([
    { name: 'мука', amount: 250, unit: 'г' },
    { name: 'молоко', amount: 1, unit: 'шт' }
  ], { mode: 'sum' });

  assert.equal(result.counts.summed, 1);
  assert.equal(result.counts.skipped, 1);
  assert.equal(Store.getFridge().find((p) => p.name === 'мука').amount, 750);
  assert.equal(Store.getFridge().find((p) => p.name === 'молоко').amount, 500, 'единица не совпала — количество не изменилось');
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /единица не совпадает/);
});

test('режим replace полностью заменяет холодильник', () => {
  freshStore();
  Store.addProduct({ name: 'мука', amount: 500, unit: 'г' });
  Store.addProduct({ name: 'сахар', amount: 500, unit: 'г' });

  const result = Store.importProducts([
    { name: 'яйца', amount: 10, unit: 'шт' },
    { name: 'сыр', amount: 300, unit: 'г' }
  ], { mode: 'replace' });

  assert.equal(result.counts.added, 2);
  assert.deepEqual(Store.getFridge().map((p) => p.name), ['сыр', 'яйца']);
});

test('дубликат названия внутри файла не создаёт второй продукт', () => {
  freshStore();
  const result = Store.importProducts([
    { name: 'мука', amount: 500, unit: 'г' },
    { name: 'мука', amount: 700, unit: 'г' }
  ], { mode: 'merge' });
  assert.equal(Store.getFridge().length, 1);
  assert.equal(Store.getFridge()[0].amount, 700);
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.updated, 1);
});

test('план импорта ничего не меняет до применения', () => {
  freshStore();
  Store.addProduct({ name: 'мука', amount: 500, unit: 'г' });
  const before = JSON.stringify(Store.getFridge());

  const plan = Store.planProductImport([{ name: 'мука', amount: 1, unit: 'г' }], { mode: 'replace' });
  assert.equal(plan.next.length, 1);
  assert.equal(plan.next[0].amount, 1);
  assert.equal(JSON.stringify(Store.getFridge()), before, 'холодильник не должен меняться');
});

test('некорректные строки в импорте холодильника пропускаются', () => {
  freshStore();
  const result = Store.importProducts([
    { name: 'мука', amount: 1000, unit: 'г' },
    { name: 'сыр', amount: -5, unit: 'г' },
    { name: '', amount: 10, unit: 'шт' }
  ], { mode: 'merge' });
  assert.equal(Store.getFridge().length, 1);
  assert.equal(result.counts.skipped, 2);
  assert.equal(result.entries.filter((entry) => entry.action === 'invalid').length, 2);
});

test('выгрузка холодильника читается обратно', () => {
  freshStore();
  Store.addProduct({ name: 'мука, пшеничная', amount: 1000, unit: 'г' });
  Store.addProduct({ name: 'яйца', amount: 10, unit: 'шт' });

  const csv = CSV.toProductsCSV(Store.getFridge());
  const parsed = CSV.parseProducts(csv);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.products.length, 2);
  assert.equal(parsed.products[0].name, 'мука, пшеничная');
});

test('шаблон холодильника содержит заголовки и читается', () => {
  const template = CSV.productsTemplate();
  assert.ok(template.includes('name,amount,unit'));
  const parsed = CSV.parseProducts(template);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.products.length, 3);
});

test('импортированный холодильник сразу делает блюда доступными', () => {
  freshStore();
  Store.addDish({
    title: 'Омлет',
    section: 'breakfast',
    ingredients: [
      { name: 'яйца', amount: 3, unit: 'шт' },
      { name: 'сыр', amount: 50, unit: 'г' }
    ]
  });
  assert.equal(Matcher.canCook(Store.getDish(Store.getDishes()[0].id), Store.getFridge()), false);

  const parsed = CSV.parseProducts('name,amount,unit\nяйца,10,шт\nсыр,300,г');
  Store.importProducts(parsed.products, { mode: 'merge' });

  assert.equal(Matcher.canCook(Store.getDishes()[0], Store.getFridge()), true);
});

/* ================================================================== *
 * Итог
 * ================================================================== */

if (failures.length) {
  console.error('\n❌ Провалено тестов: ' + failures.length + ' из ' + (passed + failures.length) + '\n');
  failures.forEach((failure) => {
    console.error('— ' + failure.name);
    console.error('  ' + String(failure.error && failure.error.message).split('\n').join('\n  '));
  });
  process.exit(1);
}

console.log('✅ Все тесты пройдены: ' + passed);
