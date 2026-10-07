# legacy-static — предыдущая версия книги

Это первая реализация кулинарной книги: чистые HTML + CSS + JavaScript, данные в
`localStorage` браузера, без сборки и без внешней базы. Она полностью рабочая и
оставлена как есть — на случай, если понадобится вернуться к офлайн-варианту.

Текущая версия сайта (React + Vite + TypeScript + Tailwind + Supabase) лежит в корне
репозитория и **эту папку не использует**: Vite собирает только `index.html`, `src/`
и `public/`, поэтому в `dist/` ничего отсюда не попадает.

## Запуск

```bash
python -m http.server 8080   # и открыть http://localhost:8080
```

Файл можно открыть и двойным щелчком — сборки нет.

## Проверки

```bash
node tests/smoke.test.mjs    # логика: хранилище, сопоставление, списание, CSV
node tests/static.test.mjs   # связка index.html ↔ app.js
node tests/ui.test.mjs       # интерфейс в jsdom (нужен: npm install jsdom)
```

## Что внутри

```
index.html      разметка пяти вкладок
css/styles.css  тема
js/store.js     localStorage, CRUD, валидация, экспорт/импорт
js/matcher.js   сопоставление ингредиентов и холодильника
js/csv.js       разбор CSV и выгрузка
js/app.js       интерфейс
examples/       примеры CSV и JSON
tests/          автотесты
```

Отличия от текущей версии: четыре раздела (включая полдник), данные только в браузере,
импорт CSV холодильника в формате `name,amount,unit`, приготовление считалось на клиенте.
