/**
 * Статические проверки связки index.html ↔ js/app.js:
 *   • все локальные файлы из index.html существуют;
 *   • каждый id, к которому обращается app.js, есть в разметке
 *     (или создаётся самим скриптом);
 *   • у каждой вкладки в навигации есть своя панель.
 *
 * Запуск: node tests/static.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'css/styles.css'), 'utf8');

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

function matchAll(source, regex) {
  const result = [];
  let match = regex.exec(source);
  while (match) {
    result.push(match[1]);
    match = regex.exec(source);
  }
  return result;
}

const htmlIds = new Set(matchAll(html, /\sid="([^"]+)"/g));
const createdIds = new Set(matchAll(app, /\bid:\s*'([^']+)'/g));
const knownIds = new Set([...htmlIds, ...createdIds]);

test('все локальные ресурсы из index.html существуют', () => {
  const refs = [
    ...matchAll(html, /<link[^>]+href="([^"]+)"/g),
    ...matchAll(html, /<script[^>]+src="([^"]+)"/g)
  ].filter((ref) => !/^(https?:|data:|#)/.test(ref));

  assert.ok(refs.length >= 3, 'ожидались подключения стилей и скриптов');
  refs.forEach((ref) => {
    assert.ok(fs.existsSync(path.join(root, ref)), 'нет файла ' + ref);
  });
});

test('пути относительные — годятся для GitHub Pages', () => {
  const refs = [
    ...matchAll(html, /<link[^>]+href="([^"]+)"/g),
    ...matchAll(html, /<script[^>]+src="([^"]+)"/g)
  ];
  refs.forEach((ref) => {
    assert.ok(!ref.startsWith('/'), 'абсолютный путь сломает GitHub Pages: ' + ref);
  });
});

test('каждый byId(...) из app.js есть в разметке или создаётся скриптом', () => {
  const used = [...new Set(matchAll(app, /byId\('([^']+)'\)/g))];
  assert.ok(used.length > 20, 'ожидалось много обращений к элементам');
  const missing = used.filter((id) => !knownIds.has(id));
  assert.deepEqual(missing, [], 'неизвестные id: ' + missing.join(', '));
});

test('у каждой вкладки навигации есть панель', () => {
  const tabs = [...new Set(matchAll(html, /data-tab="([^"]+)"/g))];
  assert.deepEqual(tabs.slice().sort(), ['add', 'fridge', 'import', 'recipes', 'settings']);
  tabs.forEach((tab) => {
    assert.ok(htmlIds.has('panel-' + tab), 'нет панели для вкладки ' + tab);
    assert.ok(htmlIds.has('tab-' + tab), 'нет кнопки для вкладки ' + tab);
  });
});

test('в разметке есть 4 фиксированных раздела', () => {
  ['breakfast', 'snack', 'lunch', 'dinner'].forEach((section) => {
    assert.ok(html.includes('data-section="' + section + '"'), 'раздел ' + section + ' отсутствует в разметке');
  });
});

test('в app.js нет innerHTML с пользовательскими данными', () => {
  assert.equal(/innerHTML/.test(app), false, 'innerHTML не используется — тексты идут через textContent');
});

test('единицы измерения в разметке ограничены г, мл, шт', () => {
  const allowed = ['г', 'мл', 'шт', 'breakfast', 'snack', 'lunch', 'dinner'];
  const options = matchAll(html, /<option value="([^"]+)"/g);
  const strange = options.filter((value) => !allowed.includes(value));
  assert.deepEqual(strange, [], 'неожиданные значения в select: ' + strange.join(', '));
  const unitOptions = options.filter((value) => ['г', 'мл', 'шт'].includes(value));
  assert.ok(unitOptions.length >= 3, 'селект единиц измерения должен содержать только г, мл, шт');
});

test('стили содержат класс серой карточки с надписью о нехватке', () => {
  assert.ok(css.includes('.recipe.is-missing'));
  assert.ok(css.includes('.recipe__miss'));
});

if (failures.length) {
  console.error('\n❌ Провалено проверок: ' + failures.length + '\n');
  failures.forEach((failure) => {
    console.error('— ' + failure.name);
    console.error('  ' + String(failure.error && failure.error.message));
  });
  process.exit(1);
}

console.log('✅ Статические проверки пройдены: ' + passed);
