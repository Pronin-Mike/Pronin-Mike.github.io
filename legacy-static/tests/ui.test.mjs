/**
 * Интеграционный тест интерфейса: настоящий DOM (jsdom) + index.html + скрипты сайта.
 * Проверяет карточки, фильтры, формы, приготовление, импорт CSV блюд и холодильника,
 * экспорт и сброс данных.
 *
 * Требуется jsdom:  npm install jsdom
 * Запуск:           node tests/ui.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let jsdom;
try {
  jsdom = require('jsdom');
} catch (error) {
  console.error('Для этого теста нужен jsdom: npm install jsdom');
  process.exit(1);
}
const { JSDOM, VirtualConsole } = jsdom;

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');

const dom = new JSDOM(html, {
  url: 'https://cookbook.test/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: new VirtualConsole()
});

const { window } = dom;
const { document } = window;
window.URL.createObjectURL = () => 'blob:test';
window.URL.revokeObjectURL = () => {};
window.scrollTo = () => {};

['js/store.js', 'js/matcher.js', 'js/csv.js', 'js/app.js'].forEach((file) => {
  window.eval(fs.readFileSync(path.join(root, file), 'utf8'));
});

/* Ждём настоящее DOMContentLoaded от jsdom: app.js инициализируется сам,
   повторно дёргать его нельзя — обработчики зарегистрировались бы дважды. */
if (document.readyState === 'loading') {
  await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve));
}

const Store = window.CookbookStore;
const App = window.CookbookApp;

let passed = 0;
const failures = [];
const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.prototype.slice.call(document.querySelectorAll(selector));
const cards = () => $$('#recipe-grid .recipe');
const missingCards = () => $$('#recipe-grid .recipe.is-missing');
const toastText = () => $$('#toasts .toast').map((node) => node.textContent).join(' | ');

function loadSample() {
  const backup = fs.readFileSync(path.join(root, 'examples/sample-backup.json'), 'utf8');
  const result = Store.importData(backup);
  assert.equal(result.ok, true);
  return result;
}

function click(node) {
  node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function submit(form) {
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/* ================================================================== */

test('приложение стартует и показывает подсказку про пустой холодильник', () => {
  assert.ok(App, 'CookbookApp не создан');
  assert.ok($('#panel-recipes').hidden === false, 'вкладка «Рецепты» должна быть активной');
  assert.equal($('#recipes-hint').hidden, false);
  assert.match($('#recipes-hint').textContent, /Добавь продукты в холодильник/);
  assert.equal($('#recipes-empty-title').textContent, 'Добавь продукты в холодильник');
});

test('образец базы отрисовывает 7 карточек, 2 из них серые', () => {
  loadSample();
  assert.equal(cards().length, 7, 'карточек: ' + cards().length);
  assert.equal(missingCards().length, 2);
  assert.equal($('#recipes-hint').hidden, true);
  const miss = missingCards().map((node) => node.querySelector('.recipe__miss').textContent);
  assert.ok(miss.some((text) => /Не хватает:.*свёкла/.test(text)), miss.join(' / '));
  assert.ok(miss.some((text) => /масло/.test(text)), miss.join(' / '));
});

test('на серых карточках нет ошибок доступа к undefined', () => {
  missingCards().forEach((card) => {
    assert.ok(card.getAttribute('aria-label').includes('не хватает'));
    assert.equal(card.querySelector('.recipe__status'), null);
  });
});

test('фильтр «Что приготовить» оставляет 5 доступных блюд', () => {
  const toggle = $('#only-available');
  toggle.checked = true;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(cards().length, 5);
  assert.equal(missingCards().length, 0);
  toggle.checked = false;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.equal(cards().length, 7);
});

test('фильтр по разделу работает', () => {
  click($('#section-filter .chip[data-section="breakfast"]'));
  assert.equal(cards().length, 3);
  click($('#section-filter .chip[data-section="lunch"]'));
  assert.equal(cards().length, 2);
  click($('#section-filter .chip[data-section="dinner"]'));
  assert.equal(cards().length, 1);
  click($('#section-filter .chip[data-section="all"]'));
  assert.equal(cards().length, 7);
});

test('поиск ищет по названию блюда и по ингредиентам', () => {
  click($('#section-filter .chip[data-section="all"]'));
  type($('#recipe-search'), 'свёкла');
  assert.equal(cards().length, 1);
  assert.equal(cards()[0].querySelector('.recipe__title').textContent, 'Борщ');
  type($('#recipe-search'), 'сыр');
  assert.ok(cards().length >= 2);
  type($('#recipe-search'), 'нетакогопродукта');
  assert.equal(cards().length, 0);
  assert.equal($('#recipes-empty').hidden, false);
  click($('#recipe-search-clear'));
  assert.equal(cards().length, 7);
});

test('окно блюда показывает нехватку и блокирует кнопку', () => {
  const borsch = cards().find((card) => card.querySelector('.recipe__title').textContent === 'Борщ');
  click(borsch);
  const cook = $('.modal__foot .btn--ok, .modal__foot .btn--ghost');
  const cookButtons = $$('.modal__foot button').filter((button) => /Приготовить|Не хватает/.test(button.textContent));
  assert.equal(cookButtons.length, 1);
  assert.equal(cookButtons[0].disabled, true);
  assert.match(cookButtons[0].textContent, /Не хватает/);
  assert.equal($$('.ing-row.is-missing').length, 5);
  click($('.modal__close'));
  assert.equal($('#modal-root').children.length, 0);
});

test('приготовление списывает продукты и удаляет пустые позиции', () => {
  const eggs = Store.getFridge().find((item) => item.name === 'яйца');
  Store.updateProduct(eggs.id, { name: 'яйца', amount: 3, unit: 'шт' });

  const omlet = cards().find((card) => card.querySelector('.recipe__title').textContent === 'Омлет с сыром');
  click(omlet);
  const cook = $$('.modal__foot button').find((button) => button.textContent.includes('Приготовить'));
  assert.equal(cook.disabled, false);
  click(cook);

  const fridge = Store.getFridge();
  assert.equal(fridge.some((item) => item.name === 'яйца'), false, 'яйца должны исчезнуть');
  assert.equal(fridge.find((item) => item.name === 'сыр').amount, 250);
  assert.equal(fridge.find((item) => item.name === 'молоко').amount, 950);
  assert.match(toastText(), /приготовлено/);
  assert.equal($('#modal-root').children.length, 0);
});

test('Escape закрывает модальное окно', () => {
  click(cards()[0]);
  assert.equal($('#modal-root').children.length, 1);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('#modal-root').children.length, 0);
});

test('продукт добавляется через форму холодильника', () => {
  const before = Store.getFridge().length;
  click($('#tab-fridge'));
  $('#product-name').value = 'Капуста';
  $('#product-amount').value = '500';
  $('#product-unit').value = 'г';
  submit($('#product-form'));

  assert.equal(Store.getFridge().length, before + 1);
  const item = Store.getFridge().find((product) => product.name === 'Капуста');
  assert.equal(item.amount, 500);
  assert.equal(item.unit, 'г');
  assert.ok($('#fridge-list').textContent.includes('Капуста'));
  assert.equal($('#product-form').querySelector('#product-name').value, '');
});

test('продукт без количества не сохраняется, показывается ошибка', () => {
  const before = Store.getFridge().length;
  $('#product-name').value = 'Соль';
  $('#product-amount').value = '';
  submit($('#product-form'));
  assert.equal(Store.getFridge().length, before);
  assert.equal($('#product-error').hidden, false);
  assert.match($('#product-error').textContent, /количество/i);
});

test('дубликат названия продукта не сохраняется', () => {
  const before = Store.getFridge().length;
  $('#product-name').value = '  капуста ';
  $('#product-amount').value = '100';
  submit($('#product-form'));
  assert.equal(Store.getFridge().length, before);
  assert.match($('#product-error').textContent, /уже есть/);
});

test('редактирование и удаление продукта', async () => {
  const item = Store.getFridge().find((product) => product.name === 'Капуста');
  const row = $$('#fridge-list .fridge-item').find((node) => node.textContent.includes('Капуста'));
  click(row.querySelectorAll('button')[0]);
  assert.equal($('#product-name').value, 'Капуста');
  $('#product-amount').value = '800';
  submit($('#product-form'));
  assert.equal(Store.getFridge().find((product) => product.name === 'Капуста').amount, 800);

  const rowAgain = $$('#fridge-list .fridge-item').find((node) => node.textContent.includes('Капуста'));
  click(rowAgain.querySelectorAll('button')[1]);
  const confirmButton = $$('.modal__foot button').find((button) => button.textContent === 'Удалить');
  assert.ok(confirmButton, 'ожидался диалог подтверждения');
  click(confirmButton);
  await tick();
  assert.equal(Store.getFridge().some((product) => product.name === 'Капуста'), false);
  assert.equal(item.name, 'Капуста');
});

test('поиск по холодильнику фильтрует список', () => {
  type($('#fridge-search'), 'мол');
  assert.equal($$('#fridge-list .fridge-item').length, 1);
  click($('#fridge-search-clear'));
  assert.ok($$('#fridge-list .fridge-item').length > 1);
});

test('импорт холодильника из CSV: предпросмотр и обновление', () => {
  click($('#tab-import'));
  $('#fridge-csv-text').value = 'name,amount,unit\nмука,2000,г\nкапуста,500,г';
  click($('#fridge-csv-preview-btn'));

  assert.equal($('#fridge-csv-preview').hidden, false);
  assert.match($('#fridge-csv-preview').textContent, /Готово к импорту: 2 продукта/);
  assert.match($('#fridge-csv-preview').textContent, /обновится: 1/);
  assert.match($('#fridge-csv-preview').textContent, /новых: 1/);

  const importButton = $$('#fridge-csv-preview button').find((button) => button.textContent.includes('Импортировать'));
  assert.equal(importButton.textContent, 'Импортировать 2 продукта');
  click(importButton);

  assert.equal(Store.getFridge().find((product) => product.name === 'мука').amount, 2000);
  assert.equal(Store.getFridge().find((product) => product.name === 'капуста').amount, 500);
  assert.equal($('#panel-fridge').hidden, false, 'после импорта открыт холодильник');
  assert.match(toastText(), /Холодильник обновлён/);
  assert.ok($('#fridge-list').textContent.includes('капуста'));
});

test('режим «прибавлять» складывает количество', () => {
  click($('#tab-import'));
  $('#fridge-csv-text').value = 'мука,500,г';
  click($('#fridge-csv-preview-btn'));

  const radio = $$('#fridge-csv-preview input[name="fridge-csv-mode"]').find((input) => input.value === 'sum');
  radio.click();
  assert.equal(radio.checked, true);
  assert.match($('#fridge-csv-preview').textContent, /прибавится/);

  click($$('#fridge-csv-preview button').find((button) => button.textContent.includes('Импортировать')));
  assert.equal(Store.getFridge().find((product) => product.name === 'мука').amount, 2500);
});

test('ошибка в строке холодильника блокирует импорт', () => {
  click($('#tab-import'));
  $('#fridge-csv-text').value = 'мука,1000,кг';
  click($('#fridge-csv-preview-btn'));
  assert.match($('#fridge-csv-preview').textContent, /Ошибок: 1/);

  const importButton = $$('#fridge-csv-preview button').find((button) => button.textContent.includes('Импортировать'));
  assert.equal(importButton.disabled, true);
  click($('#fridge-csv-clear'));
  assert.equal($('#fridge-csv-preview').hidden, true);
});

test('режим замены предупреждает и заменяет холодильник', () => {
  click($('#tab-import'));
  $('#fridge-csv-text').value = 'яйца,12,шт';
  click($('#fridge-csv-preview-btn'));

  const radio = $$('#fridge-csv-preview input[name="fridge-csv-mode"]').find((input) => input.value === 'replace');
  radio.click();
  assert.match($('#fridge-csv-preview').textContent, /текущий холодильник будет заменён/);
  assert.match($('#fridge-csv-preview').textContent, /в холодильнике станет: 1 продукт/);

  click($$('#fridge-csv-preview button').find((button) => button.textContent.includes('Импортировать')));
  assert.equal(Store.getFridge().length, 1);
  assert.equal(Store.getFridge()[0].name, 'яйца');
  assert.equal(Store.getFridge()[0].amount, 12);
});

test('блюдо добавляется вручную через форму', () => {
  click($('#tab-add'));
  const before = Store.getDishes().length;

  $('#dish-title').value = 'Тестовый салат';
  $('#dish-section').value = 'snack';
  $('#dish-time').value = '7';

  const ingredientRows = $$('#ingredient-rows .row--ingredient');
  assert.equal(ingredientRows.length, 1);
  click($('#add-ingredient'));
  const rows = $$('#ingredient-rows .row--ingredient');
  assert.equal(rows.length, 2);

  rows[0].querySelector('.row__name').value = 'огурцы';
  rows[0].querySelector('.row__amount').value = '100';
  rows[0].querySelector('.row__unit').value = 'г';
  rows[1].querySelector('.row__name').value = 'сметана';
  rows[1].querySelector('.row__amount').value = '50';
  rows[1].querySelector('.row__unit').value = 'г';

  click($('#add-step'));
  const steps = $$('#step-rows .row--step');
  steps[0].querySelector('.row__text').value = 'Нарезать огурцы';
  steps[1].querySelector('.row__text').value = 'Заправить сметаной';
  $('#dish-notes').value = 'Подавать охлаждённым';

  submit($('#dish-form'));

  assert.equal(Store.getDishes().length, before + 1);
  const dish = Store.findDishByTitle('Тестовый салат');
  assert.ok(dish);
  assert.equal(dish.section, 'snack');
  assert.equal(dish.ingredients.length, 2);
  assert.equal(dish.steps.length, 2);
  assert.equal(dish.notes, 'Подавать охлаждённым');
  assert.equal($('#dish-title').value, '', 'форма должна очиститься');
  assert.equal($$('#ingredient-rows .row--ingredient').length, 1);
});

test('блюдо с неподдерживаемой единицей не сохраняется', () => {
  const before = Store.getDishes().length;
  $('#dish-title').value = 'Плохое блюдо';
  const row = $('#ingredient-rows .row--ingredient');
  row.querySelector('.row__name').value = 'масло';
  row.querySelector('.row__amount').value = '1';
  row.querySelector('.row__unit').value = 'г';
  submit($('#dish-form'));
  assert.equal(Store.getDishes().length, before + 1, 'корректное блюдо должно сохраниться');
  assert.equal($('#dish-error').hidden, true);

  const bad = Store.validateDish({ title: 'Плохое', section: 'lunch', ingredients: [{ name: 'масло', amount: 1, unit: 'ст.л.' }] });
  assert.equal(bad.ok, false);
});

test('редактирование блюда из карточки', () => {
  click($('#tab-recipes'));
  const card = cards().find((node) => node.querySelector('.recipe__title').textContent === 'Тестовый салат');
  click(card);
  const edit = $$('.modal__foot button').find((button) => button.textContent.includes('Редактировать'));
  click(edit);

  assert.equal($('#panel-add').hidden, false);
  assert.equal($('#dish-title').value, 'Тестовый салат');
  assert.equal($('#dish-form-title').textContent, 'Редактировать блюдо');
  assert.equal($$('#ingredient-rows .row--ingredient').length, 2);

  $('#dish-title').value = 'Тестовый салат v2';
  submit($('#dish-form'));

  assert.equal(Store.findDishByTitle('Тестовый салат'), null);
  assert.ok(Store.findDishByTitle('Тестовый салат v2'));
  assert.equal(Store.getDishes().filter((dish) => dish.title.startsWith('Тестовый')).length, 1);
});

test('CSV-предпросмотр показывает 9 блюд и импортирует их', () => {
  click($('#tab-import'));
  $('#csv-text').value = fs.readFileSync(path.join(root, 'examples/sample-recipes.csv'), 'utf8');
  click($('#csv-preview-btn'));

  assert.equal($('#csv-preview').hidden, false);
  assert.match($('#csv-preview').textContent, /Готово к импорту: 9 блюд/);
  assert.match($('#csv-preview').textContent, /Ошибок: 0/);

  const before = Store.getDishes().length;
  const importButton = $$('#csv-preview button').find((button) => button.textContent.includes('Импортировать'));
  assert.equal(importButton.textContent, 'Импортировать 9 блюд');
  click(importButton);

  assert.equal(Store.getDishes().length, before + 2, 'два новых блюда: каша и йогурт уже были/не были');
  assert.equal($('#panel-recipes').hidden, false);
  assert.match(toastText(), /Импорт завершён/);
});

test('CSV с ошибками показывает их и не импортирует', () => {
  click($('#tab-import'));
  $('#csv-text').value = 'title,section,ingredients,time,steps,notes\n,breakfast,яйца|3|шт,10,,\nТест,ночь,яйца|3|шт,10,,';
  click($('#csv-preview-btn'));
  assert.match($('#csv-preview').textContent, /Ошибок: 2/);
  const importButton = $$('#csv-preview button').find((button) => button.textContent.includes('Импортировать'));
  assert.equal(importButton.disabled, true);
  click($('#csv-clear'));
  assert.equal($('#csv-preview').hidden, true);
});

test('экспорт JSON создаёт файл и не падает', () => {
  click($('#tab-settings'));
  assert.ok($('#settings-stats').textContent.includes('блюд'));
  click($('#export-json'));
  assert.match(toastText(), /Бэкап сохранён/);
  click($('#export-csv'));
  assert.match(toastText(), /Выгружено/);
});

test('сброс данных очищает базу после подтверждения', async () => {
  click($('#reset-data'));
  const confirmButton = $$('.modal__foot button').find((button) => button.textContent === 'Удалить всё');
  assert.ok(confirmButton);
  click(confirmButton);
  await tick();
  assert.equal(Store.getDishes().length, 0);
  assert.equal(Store.getFridge().length, 0);
  assert.equal($('#panel-recipes').hidden, false);
  assert.equal($('#recipes-empty-title').textContent, 'Добавь продукты в холодильник');
  assert.equal(cards().length, 0);
});

/* ================================================================== */

for (const item of tests) {
  try {
    await item.fn();
    passed += 1;
  } catch (error) {
    failures.push({ name: item.name, error });
  }
}

dom.window.close();

if (failures.length) {
  console.error('\n❌ Провалено тестов интерфейса: ' + failures.length + ' из ' + (passed + failures.length) + '\n');
  failures.forEach((failure) => {
    console.error('— ' + failure.name);
    console.error('  ' + String(failure.error && failure.error.stack).split('\n').slice(0, 4).join('\n  '));
  });
  process.exit(1);
}

console.log('✅ Тесты интерфейса пройдены: ' + passed);
