/* ============================================================================
 * app.js — интерфейс кулинарной книги.
 *
 * Здесь только представление и обработка событий:
 *   • вкладки, поиск, фильтры, карточки рецептов;
 *   • формы блюда и продукта;
 *   • модальные окна и уведомления;
 *   • импорт CSV/JSON и экспорт бэкапа.
 *
 * Логика сопоставления — в matcher.js, работа с данными — в store.js.
 * Пользовательские строки всегда попадают в DOM через textContent.
 * ========================================================================== */
(function (global) {
  'use strict';

  const Store = global.CookbookStore;
  const Matcher = global.CookbookMatcher;
  const CSV = global.CookbookCSV;
  const doc = global.document;
  const { SECTIONS, UNITS } = Store;
  const { cleanText, nameKey, sectionById } = Store.utils;

  /* ==================================================================== *
   * Мелкие помощники DOM
   * ==================================================================== */

  function byId(id) {
    return doc.getElementById(id);
  }

  const PROP_KEYS = { value: 1, checked: 1, disabled: 1, hidden: 1, selected: 1, tabIndex: 1 };

  /** Безопасный конструктор элементов: текст — только через textContent. */
  function el(tag, props, children) {
    const node = doc.createElement(tag);
    if (props) {
      Object.keys(props).forEach((key) => {
        const value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'dataset') Object.assign(node.dataset, value);
        else if (PROP_KEYS[key]) node[key] = value;
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      });
    }
    appendChildren(node, children);
    return node;
  }

  function appendChildren(node, children) {
    if (children === null || children === undefined || children === false) return;
    const list = Array.isArray(children) ? children : [children];
    list.forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(
        typeof child === 'object' ? child : doc.createTextNode(String(child))
      );
    });
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  function dishWord(count) {
    return count + ' ' + plural(count, 'блюдо', 'блюда', 'блюд');
  }

  function productWord(count) {
    return count + ' ' + plural(count, 'продукт', 'продукта', 'продуктов');
  }

  function formatAmount(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return String(Math.round(num * 1000) / 1000);
  }

  /* ==================================================================== *
   * Эмодзи для блюд (фотографий нет — визуальное разнообразие за счёт иконок)
   * ==================================================================== */

  const EMOJI_RULES = [
    [/(омлет|яичниц|шакшук|яйц)/, '🍳'],
    [/(сырник|творож|запеканк)/, '🥞'],
    [/(блин|оладь|панкейк|драник)/, '🥞'],
    [/(каш|овсян|гречк|рис|плов)/, '🥣'],
    [/(суп|борщ|щи|бульон|похлёб|окрошк)/, '🍲'],
    [/(салат|винегрет)/, '🥗'],
    [/(паст|макарон|спагетт|лапш|карбонар)/, '🍝'],
    [/(пицц|фокачч)/, '🍕'],
    [/(бургер|гамбургер|чизбургер)/, '🍔'],
    [/(шаурм|шаверм|ролл|буррито|тако)/, '🌯'],
    [/(пельмен|вареник|мант|равиол)/, '🥟'],
    [/(котлет|тефтел|фрикадел)/, '🍖'],
    [/(куриц|куриные|бедро|крыл)/, '🍗'],
    [/(стейк|говядин|свинин|мясо|баран)/, '🥩'],
    [/(рыб|лосос|треск|сельд|тунец)/, '🐟'],
    [/(кревет|морепродукт|мидии|кальмар)/, '🦐'],
    [/(картоф|картошк|пюре)/, '🥔'],
    [/(овощ|брокколи|кабач|баклажан|перец|морков)/, '🥦'],
    [/(гриб|шампиньон)/, '🍄'],
    [/(торт|пирог|кекс|маффин|бисквит|чизкейк)/, '🍰'],
    [/(печень|cookie|пряник)/, '🍪'],
    [/(хлеб|булочк|тост|багет|бутерброд|сэндвич|сендвич)/, '🥪'],
    [/(йогурт|кефир|ряженк|смузи)/, '🥛'],
    [/(компот|морс|сок|лимонад|напиток)/, '🥤'],
    [/(кофе|капучино|латте|эспрессо)/, '☕'],
    [/(чай|матэ)/, '🍵'],
    [/(шоколад|какао|брауни)/, '🍫'],
    [/(морожен|сорбет)/, '🍨'],
    [/(фрукт|яблок|груш|банан|апельсин|мандарин)/, '🍎'],
    [/(ягод|клубник|малин|черник|смородин)/, '🍓'],
    [/(орех|миндал|фундук|кешью)/, '🥜'],
    [/(авокадо|гуакамол)/, '🥑'],
    [/(мёд|мед)/, '🍯'],
    [/(фасол|горох|чечевиц|нут|боб)/, '🫘'],
    [/(кукуруз)/, '🌽'],
    [/(соус|заправк|подлив|аджик)/, '🥫']
  ];

  function dishEmoji(dish) {
    const haystack = (
      dish.title + ' ' + (dish.ingredients || []).map((item) => item.name).join(' ')
    ).toLowerCase();
    for (let i = 0; i < EMOJI_RULES.length; i += 1) {
      if (EMOJI_RULES[i][0].test(haystack)) return EMOJI_RULES[i][1];
    }
    return sectionById(dish.section).emoji;
  }

  /* ==================================================================== *
   * Состояние интерфейса
   * ==================================================================== */

  const ui = {
    tab: 'recipes',
    section: 'all',
    search: '',
    onlyAvailable: false,
    fridgeSearch: '',
    editingDishId: null,
    editingProductId: null,
    csvPreview: null,
    fridgeCsvPreview: null,
    fridgeCsvMode: 'merge'
  };

  const PANEL_IDS = ['recipes', 'fridge', 'add', 'import', 'settings'];
  const modalStack = [];
  let lastFocused = null;

  /* ==================================================================== *
   * Уведомления
   * ==================================================================== */

  function toast(message, type, duration) {
    const kinds = { ok: '✅', err: '⚠️', info: '💬' };
    const kind = kinds[type] ? type : 'info';
    const node = el('div', { class: 'toast toast--' + kind }, [
      el('span', { class: 'toast__icon', text: kinds[kind], 'aria-hidden': 'true' }),
      el('span', { class: 'toast__text', text: message })
    ]);
    byId('toasts').appendChild(node);

    const life = duration || (kind === 'err' ? 6500 : 4000);
    const timer = global.setTimeout(remove, life);

    function remove() {
      global.clearTimeout(timer);
      node.classList.add('is-out');
      global.setTimeout(() => {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 220);
    }

    node.addEventListener('click', remove);
    return remove;
  }

  /* ==================================================================== *
   * Модальные окна
   * ==================================================================== */

  function openModal(content, options) {
    const opts = options || {};
    lastFocused = doc.activeElement;

    const box = el('div', {
      class: 'modal__box',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': opts.ariaLabel || ''
    }, content);

    const overlay = el('div', {
      class: 'modal' + (opts.confirm ? ' modal--confirm' : ''),
      onclick: (event) => {
        if (event.target === overlay) close();
      }
    }, box);

    byId('modal-root').appendChild(overlay);
    const entry = { overlay, close };
    modalStack.push(entry);
    doc.body.style.overflow = 'hidden';

    const focusTarget = box.querySelector('[data-autofocus]') ||
      box.querySelector('button, [href], input, select, textarea');
    if (focusTarget && typeof focusTarget.focus === 'function') {
      global.setTimeout(() => focusTarget.focus(), 30);
    }

    function close() {
      const position = modalStack.indexOf(entry);
      if (position !== -1) modalStack.splice(position, 1);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      if (!modalStack.length) doc.body.style.overflow = '';
      if (lastFocused && typeof lastFocused.focus === 'function') {
        try {
          lastFocused.focus();
        } catch (err) {
          /* элемент мог исчезнуть */
        }
      }
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    return { close, box, overlay };
  }

  function closeTopModal() {
    const entry = modalStack[modalStack.length - 1];
    if (entry) entry.close();
  }

  /** Диалог подтверждения → Promise<boolean>. */
  function confirmDialog(options) {
    const opts = options || {};
    return new Promise((resolve) => {
      let settled = false;

      function finish(value) {
        if (settled) return;
        settled = true;
        handle.close();
        resolve(value);
      }

      const handle = openModal([
        el('div', { class: 'modal__head' }, [
          el('h2', { class: 'modal__title', id: 'confirm-title', text: opts.title || 'Подтвердите действие' }),
          el('button', {
            type: 'button',
            class: 'modal__close',
            'aria-label': 'Закрыть',
            text: '✕',
            onclick: () => finish(false)
          })
        ]),
        el('div', { class: 'modal__body' }, [
          el('p', { class: 'card__text', text: opts.text || '' }),
          opts.details ? el('p', { class: 'card__text', text: opts.details }) : null
        ]),
        el('div', { class: 'modal__foot' }, [
          el('button', {
            type: 'button',
            class: 'btn ' + (opts.danger ? 'btn--danger' : 'btn--primary'),
            text: opts.confirmLabel || 'Подтвердить',
            'data-autofocus': true,
            onclick: () => finish(true)
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--ghost',
            text: opts.cancelLabel || 'Отмена',
            onclick: () => finish(false)
          })
        ])
      ], { confirm: true, ariaLabel: opts.title || 'Подтверждение', onClose: () => finish(false) });
    });
  }

  /* ==================================================================== *
   * Вкладки
   * ==================================================================== */

  function setTab(name, options) {
    const opts = options || {};
    const target = PANEL_IDS.indexOf(name) === -1 ? 'recipes' : name;
    ui.tab = target;

    PANEL_IDS.forEach((key) => {
      const panel = byId('panel-' + key);
      if (panel) panel.hidden = key !== target;
    });

    Array.prototype.forEach.call(doc.querySelectorAll('.tab'), (button) => {
      const active = button.dataset.tab === target;
      button.classList.toggle('is-active', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });

    Store.setUI({ tab: target });
    if (opts.updateHash !== false) updateHash(target);
    if (opts.scroll !== false) global.scrollTo({ top: 0, behavior: 'auto' });
  }

  function updateHash(name) {
    if (global.location.hash.slice(1) === name) return;
    try {
      global.history.replaceState(null, '', '#' + name);
    } catch (err) {
      global.location.hash = name;
    }
  }

  /* ==================================================================== *
   * Карточки рецептов
   * ==================================================================== */

  function collectVisibleDishes() {
    const query = nameKey(ui.search);
    const fridge = Store.getFridge();
    let list = Store.getDishes();

    if (ui.section !== 'all') {
      list = list.filter((dish) => dish.section === ui.section);
    }

    if (query) {
      list = list.filter((dish) => {
        if (nameKey(dish.title).indexOf(query) !== -1) return true;
        return (dish.ingredients || []).some((item) => nameKey(item.name).indexOf(query) !== -1);
      });
    }

    const order = SECTIONS.reduce((acc, section, index) => {
      acc[section.id] = index;
      return acc;
    }, {});

    const decorated = list.map((dish) => ({
      dish,
      evaluation: Matcher.evaluate(dish, fridge)
    }));

    const visible = ui.onlyAvailable
      ? decorated.filter((item) => item.evaluation.available)
      : decorated;

    visible.sort((a, b) => {
      if (a.evaluation.available !== b.evaluation.available) {
        return a.evaluation.available ? -1 : 1;
      }
      const sectionDiff = order[a.dish.section] - order[b.dish.section];
      if (sectionDiff !== 0) return sectionDiff;
      return a.dish.title.localeCompare(b.dish.title, 'ru');
    });

    return visible;
  }

  function recipeCard(dish, evaluation) {
    const section = sectionById(dish.section);
    const ingredientLine = (dish.ingredients || [])
      .map((item) => item.name + ' ' + formatAmount(item.amount) + ' ' + item.unit)
      .join(' · ');

    const meta = [
      el('span', { class: 'recipe__tag', text: section.emoji + ' ' + section.title }),
      dish.time > 0 ? el('span', { text: '⏱ ' + formatAmount(dish.time) + ' мин' }) : null,
      el('span', { text: '🧾 ' + (dish.ingredients || []).length + ' ингр.' })
    ];

    const status = evaluation.available
      ? el('span', { class: 'recipe__status' }, ['✅ Можно готовить'])
      : el('span', { class: 'recipe__status recipe__status--missing' }, ['🛒 Не хватает продуктов']);

    const card = el('article', {
      class: 'recipe' + (evaluation.available ? '' : ' is-missing'),
      dataset: { section: dish.section, id: dish.id },
      tabindex: '0',
      role: 'button',
      'aria-label': dish.title + (evaluation.available ? ' — можно приготовить' : ' — не хватает: ' + evaluation.missingText),
      onclick: () => openDishModal(dish.id),
      onkeydown: (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDishModal(dish.id);
        }
      }
    }, [
      el('div', { class: 'recipe__top' }, [
        el('span', { class: 'recipe__emoji', 'aria-hidden': 'true', text: dishEmoji(dish) }),
        el('div', { class: 'recipe__headline' }, [
          el('h3', { class: 'recipe__title', text: dish.title }),
          el('div', { class: 'recipe__meta' }, meta)
        ])
      ]),
      el('p', { class: 'recipe__ingredients', text: ingredientLine }),
      evaluation.available
        ? status
        : el('span', { class: 'recipe__miss', text: 'Не хватает: ' + evaluation.missingText })
    ]);

    return card;
  }

  function renderRecipes() {
    const grid = byId('recipe-grid');
    const emptyBox = byId('recipes-empty');
    const hint = byId('recipes-hint');
    const fridge = Store.getFridge();
    const allDishes = Store.getDishes();
    const visible = collectVisibleDishes();

    /* Подсказка про пустой холодильник */
    clear(hint);
    if (!fridge.length) {
      hint.hidden = false;
      appendChildren(hint, [
        el('span', { class: 'hint__emoji', 'aria-hidden': 'true', text: '🧊' }),
        el('span', { class: 'hint__text', text: 'Холодильник пуст. Добавь продукты в холодильник — и книга покажет, что можно приготовить.' }),
        el('button', {
          type: 'button',
          class: 'btn btn--ghost btn--small',
          text: 'Заполнить',
          onclick: () => setTab('fridge')
        })
      ]);
    } else {
      hint.hidden = true;
    }

    /* Сетка карточек */
    clear(grid);
    visible.forEach((item) => grid.appendChild(recipeCard(item.dish, item.evaluation)));

    /* Пустые состояния */
    const searchClear = byId('recipe-search-clear');
    searchClear.hidden = ui.search === '';

    if (visible.length) {
      emptyBox.hidden = true;
      return;
    }

    emptyBox.hidden = false;
    const actions = clear(byId('recipes-empty-actions'));
    const titleNode = byId('recipes-empty-title');
    const textNode = byId('recipes-empty-text');

    if (!allDishes.length) {
      titleNode.textContent = 'Добавь продукты в холодильник';
      textNode.textContent = 'Книга пока пустая. Начни с холодильника — так сразу будет видно, какие блюда доступны.';
      appendChildren(actions, [
        el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: '🧊 Добавить продукты',
          onclick: () => setTab('fridge')
        }),
        el('button', {
          type: 'button',
          class: 'btn btn--ghost',
          text: '➕ Добавить блюдо',
          onclick: () => setTab('add')
        }),
        el('button', {
          type: 'button',
          class: 'btn btn--ghost',
          text: '📥 Загрузить CSV',
          onclick: () => setTab('import')
        })
      ]);
      return;
    }

    if (ui.onlyAvailable) {
      titleNode.textContent = 'Готовить нечего';
      textNode.textContent = 'Ни одно блюдо не подходит под текущий холодильник. Пополни продукты или выключи фильтр «Что приготовить».';
      appendChildren(actions, [
        el('button', {
          type: 'button',
          class: 'btn btn--primary',
          text: '🧊 Пополнить холодильник',
          onclick: () => setTab('fridge')
        }),
        el('button', {
          type: 'button',
          class: 'btn btn--ghost',
          text: 'Показать все блюда',
          onclick: () => {
            byId('only-available').checked = false;
            ui.onlyAvailable = false;
            Store.setUI({ onlyAvailable: false });
            renderRecipes();
          }
        })
      ]);
      return;
    }

    titleNode.textContent = 'Ничего не нашлось';
    textNode.textContent = ui.search
      ? 'По запросу «' + ui.search + '» ничего нет. Попробуй другое название блюда или ингредиента.'
      : 'В этом разделе пока нет блюд.';
    appendChildren(actions, [
      ui.search
        ? el('button', {
            type: 'button',
            class: 'btn btn--primary',
            text: 'Сбросить поиск',
            onclick: () => {
              ui.search = '';
              byId('recipe-search').value = '';
              renderRecipes();
            }
          })
        : null,
      el('button', {
        type: 'button',
        class: 'btn btn--ghost',
        text: '➕ Добавить блюдо',
        onclick: () => setTab('add')
      })
    ]);
  }

  /* ==================================================================== *
   * Детальный просмотр блюда
   * ==================================================================== */

  function openDishModal(dishId) {
    const dish = Store.getDish(dishId);
    if (!dish) {
      toast('Блюдо не найдено — возможно, оно было удалено.', 'err');
      return;
    }

    const evaluation = Matcher.evaluate(dish, Store.getFridge());
    const section = sectionById(dish.section);

    const ingredientRows = evaluation.checks.map((check) => {
      const unit = check.unit;
      const haveText = check.status === 'ok'
        ? 'есть' + (check.product ? ' ' + formatAmount(check.have) + ' ' + check.product.unit : '')
        : check.reason;

      return el('li', { class: 'ing-row ' + (check.status === 'ok' ? 'is-ok' : 'is-missing') }, [
        el('span', { class: 'ing-row__mark', 'aria-hidden': 'true', text: check.status === 'ok' ? '✓' : '✕' }),
        el('span', { class: 'ing-row__name' }, [
          check.name,
          ' ',
          el('span', { class: 'ing-row__amount', text: formatAmount(check.need) + ' ' + unit })
        ]),
        el('span', { class: 'ing-row__note', text: check.status === 'ok' ? '' : haveText })
      ]);
    });

    const body = [
      el('div', { class: 'detail-meta' }, [
        el('span', { class: 'badge badge--ok', text: section.emoji + ' ' + section.title }),
        dish.time > 0 ? el('span', { class: 'badge badge--warn', text: '⏱ ' + formatAmount(dish.time) + ' мин' }) : null,
        evaluation.available
          ? el('span', { class: 'badge badge--ok', text: '✅ Всё есть' })
          : el('span', { class: 'badge badge--err', text: '🛒 Не хватает: ' + evaluation.missingText })
      ]),
      el('div', { class: 'section-block' }, [
        el('h3', { class: 'section-block__title', text: 'Ингредиенты · ' + evaluation.ready + ' из ' + evaluation.total + ' есть' }),
        el('ul', { class: 'ing-list' }, ingredientRows)
      ]),
      dish.steps && dish.steps.length
        ? el('div', { class: 'section-block' }, [
            el('h3', { class: 'section-block__title', text: 'Как готовить' }),
            el('ol', { class: 'steps' }, dish.steps.map((step) => el('li', { text: step })))
          ])
        : null,
      dish.notes
        ? el('div', { class: 'section-block' }, [
            el('h3', { class: 'section-block__title', text: 'Заметки' }),
            el('p', { class: 'notes-box', text: dish.notes })
          ])
        : null
    ];

    const cookButton = el('button', {
      type: 'button',
      class: 'btn ' + (evaluation.available ? 'btn--ok' : 'btn--ghost'),
      text: evaluation.available ? '🍽 Приготовить' : 'Не хватает продуктов',
      disabled: !evaluation.available,
      title: evaluation.available ? 'Списать ингредиенты из холодильника' : 'Не хватает: ' + evaluation.missingText,
      'data-autofocus': evaluation.available,
      onclick: () => cookDish(dish)
    });

    const handle = openModal([
      el('div', { class: 'modal__head' }, [
        el('span', { class: 'modal__emoji', 'aria-hidden': 'true', text: dishEmoji(dish) }),
        el('h2', { class: 'modal__title', id: 'dish-modal-title', text: dish.title }),
        el('button', {
          type: 'button',
          class: 'modal__close',
          'aria-label': 'Закрыть',
          text: '✕',
          onclick: () => handle.close()
        })
      ]),
      el('div', { class: 'modal__body' }, body),
      el('div', { class: 'modal__foot' }, [
        cookButton,
        el('button', {
          type: 'button',
          class: 'btn btn--ghost',
          text: '✏️ Редактировать',
          onclick: () => {
            handle.close();
            startEditDish(dish.id);
          }
        }),
        el('button', {
          type: 'button',
          class: 'btn btn--ghost',
          text: '🗑 Удалить',
          onclick: () => {
            handle.close();
            removeDishFlow(dish);
          }
        })
      ])
    ], { ariaLabel: dish.title });
  }

  function cookDish(dish) {
    const plan = Matcher.planCooking(dish, Store.getFridge());
    if (!plan.ok) {
      toast(plan.error, 'err');
      return;
    }

    Store.commitFridge(plan.fridge);

    const consumed = plan.consumed
      .map((item) => item.name + ' — ' + formatAmount(item.amount) + ' ' + item.unit)
      .join(', ');
    let message = '«' + dish.title + '» приготовлено. Списано: ' + consumed + '.';
    if (plan.removed.length) {
      message += ' Закончились: ' + plan.removed.join(', ') + '.';
    }

    /* Обновляем открытое окно, если оно про это блюдо */
    closeTopModal();
    toast(message, 'ok', 8000);
  }

  function removeDishFlow(dish) {
    confirmDialog({
      title: 'Удалить блюдо?',
      text: '«' + dish.title + '» будет удалено из книги. Это действие нельзя отменить.',
      confirmLabel: 'Удалить',
      danger: true
    }).then((confirmed) => {
      if (!confirmed) return;
      Store.removeDish(dish.id);
      toast('Блюдо «' + dish.title + '» удалено.', 'info');
    });
  }

  /* ==================================================================== *
   * Форма блюда
   * ==================================================================== */

  function ingredientRow(data) {
    const nameInput = el('input', {
      class: 'input row__name',
      type: 'text',
      placeholder: 'мука',
      autocomplete: 'off',
      'aria-label': 'Название ингредиента',
      value: data ? data.name : ''
    });

    const amountInput = el('input', {
      class: 'input row__amount',
      type: 'text',
      inputmode: 'decimal',
      placeholder: '1000',
      autocomplete: 'off',
      'aria-label': 'Количество',
      value: data ? formatAmount(data.amount) : ''
    });

    const unitSelect = el('select', {
      class: 'input row__unit',
      'aria-label': 'Единица измерения'
    }, UNITS.map((unit) => el('option', { value: unit, text: unit })));
    unitSelect.value = data && UNITS.indexOf(data.unit) !== -1 ? data.unit : 'г';

    const row = el('div', { class: 'row row--ingredient' }, [
      nameInput,
      amountInput,
      unitSelect,
      el('button', {
        type: 'button',
        class: 'btn btn--icon btn--danger-ghost row__del',
        'aria-label': 'Удалить ингредиент',
        text: '🗑',
        onclick: () => {
          row.parentNode.removeChild(row);
          ensureIngredientRow();
        }
      })
    ]);

    return row;
  }

  function stepRow(data, index) {
    const textarea = el('textarea', {
      class: 'input row__text',
      rows: 2,
      placeholder: index === 0 ? 'Взбить яйца' : 'Следующий шаг',
      'aria-label': 'Шаг приготовления',
      value: data || ''
    });

    const row = el('div', { class: 'row row--step' }, [
      textarea,
      el('button', {
        type: 'button',
        class: 'btn btn--icon btn--danger-ghost row__del',
        'aria-label': 'Удалить шаг',
        text: '🗑',
        onclick: () => {
          row.parentNode.removeChild(row);
          ensureStepRow();
        }
      })
    ]);

    return row;
  }

  function ensureIngredientRow() {
    const container = byId('ingredient-rows');
    if (!container.querySelector('.row--ingredient')) {
      container.appendChild(ingredientRow(null));
    }
  }

  function ensureStepRow() {
    const container = byId('step-rows');
    if (!container.querySelector('.row--step')) {
      container.appendChild(stepRow('', 0));
    }
  }

  function readDishForm() {
    const ingredientRows = Array.prototype.slice.call(
      byId('ingredient-rows').querySelectorAll('.row--ingredient')
    );
    const stepRows = Array.prototype.slice.call(
      byId('step-rows').querySelectorAll('.row--step')
    );

    return {
      id: ui.editingDishId || undefined,
      title: byId('dish-title').value,
      section: byId('dish-section').value,
      time: byId('dish-time').value,
      ingredients: ingredientRows.map((row) => ({
        name: row.querySelector('.row__name').value,
        amount: row.querySelector('.row__amount').value,
        unit: row.querySelector('.row__unit').value
      })),
      steps: stepRows.map((row) => row.querySelector('.row__text').value),
      notes: byId('dish-notes').value
    };
  }

  function resetDishForm() {
    ui.editingDishId = null;
    byId('dish-form').reset();
    byId('dish-section').value = 'breakfast';
    clear(byId('ingredient-rows')).appendChild(ingredientRow(null));
    clear(byId('step-rows')).appendChild(stepRow('', 0));
    byId('dish-error').hidden = true;
    byId('dish-form-title').textContent = 'Добавить блюдо';
    byId('dish-submit').textContent = 'Сохранить блюдо';
    byId('dish-cancel').hidden = true;
  }

  function startEditDish(dishId) {
    const dish = Store.getDish(dishId);
    if (!dish) {
      toast('Блюдо не найдено.', 'err');
      return;
    }

    ui.editingDishId = dish.id;
    byId('dish-title').value = dish.title;
    byId('dish-section').value = dish.section;
    byId('dish-time').value = dish.time ? formatAmount(dish.time) : '';
    byId('dish-notes').value = dish.notes || '';

    const ingredientContainer = clear(byId('ingredient-rows'));
    (dish.ingredients || []).forEach((item) => ingredientContainer.appendChild(ingredientRow(item)));
    ensureIngredientRow();

    const stepContainer = clear(byId('step-rows'));
    (dish.steps || []).forEach((step, index) => stepContainer.appendChild(stepRow(step, index)));
    ensureStepRow();

    byId('dish-error').hidden = true;
    byId('dish-form-title').textContent = 'Редактировать блюдо';
    byId('dish-submit').textContent = 'Сохранить изменения';
    byId('dish-cancel').hidden = false;
    setTab('add');
    byId('dish-title').focus();
  }

  function submitDishForm(event) {
    event.preventDefault();
    const payload = readDishForm();
    const errorBox = byId('dish-error');
    const result = ui.editingDishId
      ? Store.updateDish(ui.editingDishId, payload)
      : Store.addDish(payload);

    if (!result.ok) {
      errorBox.hidden = false;
      errorBox.textContent = result.errors.join('\n');
      toast('Проверьте форму: ' + result.errors[0], 'err');
      return;
    }

    errorBox.hidden = true;
    const edited = Boolean(ui.editingDishId);
    resetDishForm();

    if (edited) {
      toast('Блюдо сохранено.', 'ok');
      setTab('recipes');
      openDishModal(result.value.id);
    } else {
      toast('«' + result.value.title + '» добавлено в раздел «' + sectionById(result.value.section).title + '».', 'ok');
      byId('dish-title').focus();
    }
  }

  /* ==================================================================== *
   * Холодильник
   * ==================================================================== */

  function renderFridge() {
    const list = byId('fridge-list');
    const emptyBox = byId('fridge-empty');
    const products = Store.getFridge();
    const query = nameKey(ui.fridgeSearch);

    const visible = query
      ? products.filter((product) => nameKey(product.name).indexOf(query) !== -1)
      : products;

    clear(list);
    visible.forEach((product) => {
      list.appendChild(el('li', { class: 'fridge-item' }, [
        el('span', { class: 'fridge-item__name', text: product.name }),
        el('span', { class: 'fridge-item__amount', text: formatAmount(product.amount) + ' ' + product.unit }),
        el('span', { class: 'fridge-item__actions' }, [
          el('button', {
            type: 'button',
            class: 'btn btn--icon',
            'aria-label': 'Изменить «' + product.name + '»',
            title: 'Изменить',
            text: '✏️',
            onclick: () => startEditProduct(product.id)
          }),
          el('button', {
            type: 'button',
            class: 'btn btn--icon btn--danger-ghost',
            'aria-label': 'Удалить «' + product.name + '»',
            title: 'Удалить',
            text: '🗑',
            onclick: () => removeProductFlow(product)
          })
        ])
      ]));
    });

    byId('fridge-search-clear').hidden = ui.fridgeSearch === '';

    if (visible.length) {
      emptyBox.hidden = true;
      return;
    }

    emptyBox.hidden = false;
    const title = emptyBox.querySelector('.empty__title');
    const text = emptyBox.querySelector('.empty__text');
    if (!products.length) {
      title.textContent = 'Холодильник пуст';
      text.textContent = 'Добавь продукты в холодильник — название, количество и единицу измерения (г, мл или шт).';
    } else {
      title.textContent = 'Ничего не найдено';
      text.textContent = 'Продукта с таким названием в холодильнике нет.';
    }
  }

  function startEditProduct(productId) {
    const product = Store.getProduct(productId);
    if (!product) return;
    ui.editingProductId = productId;
    byId('product-name').value = product.name;
    byId('product-amount').value = formatAmount(product.amount);
    byId('product-unit').value = product.unit;
    byId('product-form-title').textContent = 'Изменить продукт';
    byId('product-submit').textContent = 'Сохранить';
    byId('product-cancel').hidden = false;
    byId('product-error').hidden = true;
    byId('product-name').focus();
    global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetProductForm() {
    ui.editingProductId = null;
    byId('product-form').reset();
    byId('product-unit').value = 'г';
    byId('product-form-title').textContent = 'Добавить продукт';
    byId('product-submit').textContent = 'Добавить';
    byId('product-cancel').hidden = true;
    byId('product-error').hidden = true;
  }

  function submitProductForm(event) {
    event.preventDefault();
    const payload = {
      name: byId('product-name').value,
      amount: byId('product-amount').value,
      unit: byId('product-unit').value
    };
    const errorBox = byId('product-error');
    const result = ui.editingProductId
      ? Store.updateProduct(ui.editingProductId, payload)
      : Store.addProduct(payload);

    if (!result.ok) {
      errorBox.hidden = false;
      errorBox.textContent = result.errors.join('\n');
      return;
    }

    errorBox.hidden = true;
    const edited = Boolean(ui.editingProductId);
    resetProductForm();
    toast(
      edited
        ? '«' + result.value.name + '» обновлено.'
        : '«' + result.value.name + '» — ' + formatAmount(result.value.amount) + ' ' + result.value.unit + ' в холодильнике.',
      'ok'
    );
    byId('product-name').focus();
  }

  function removeProductFlow(product) {
    confirmDialog({
      title: 'Удалить продукт?',
      text: '«' + product.name + '» пропадёт из холодильника. Блюда, где он нужен, станут недоступны.',
      confirmLabel: 'Удалить',
      danger: true
    }).then((confirmed) => {
      if (!confirmed) return;
      Store.removeProduct(product.id);
      toast('«' + product.name + '» удалён из холодильника.', 'info');
    });
  }

  /* ==================================================================== *
   * Импорт CSV
   * ==================================================================== */

  function renderCsvPreview() {
    const box = byId('csv-preview');
    const text = byId('csv-text').value;
    clear(box);

    if (!cleanText(text)) {
      ui.csvPreview = null;
      box.hidden = true;
      toast('Вставьте CSV-текст или выберите файл.', 'err');
      return;
    }

    const parsed = CSV.parseDishes(text);
    ui.csvPreview = parsed;

    box.hidden = false;
    box.appendChild(el('div', { class: 'preview__summary' }, [
      el('span', {
        class: 'badge ' + (parsed.dishes.length ? 'badge--ok' : 'badge--warn'),
        text: 'Готово к импорту: ' + dishWord(parsed.dishes.length)
      }),
      el('span', {
        class: 'badge ' + (parsed.errors.length ? 'badge--err' : 'badge--ok'),
        text: 'Ошибок: ' + parsed.errors.length
      }),
      el('span', { class: 'badge badge--warn', text: 'Строк данных: ' + parsed.rows })
    ]));

    if (parsed.errors.length) {
      box.appendChild(el('ul', { class: 'preview__errors' },
        parsed.errors.slice(0, 20).map((error) => el('li', {
          text: (error.row ? 'Строка ' + error.row + ': ' : '') + error.message
        })).concat(
          parsed.errors.length > 20
            ? [el('li', { text: '…и ещё ' + (parsed.errors.length - 20) + ' ' + plural(parsed.errors.length - 20, 'ошибка', 'ошибки', 'ошибок') + '.' })]
            : []
        )
      ));
    }

    if (parsed.dishes.length) {
      const head = el('tr', {}, [
        el('th', { text: 'Блюдо' }),
        el('th', { text: 'Раздел' }),
        el('th', { text: 'Ингредиенты' }),
        el('th', { text: 'Время' })
      ]);

      const rows = parsed.dishes.slice(0, 12).map((dish) => el('tr', {}, [
        el('td', { text: dish.title }),
        el('td', { text: sectionById(dish.section).title }),
        el('td', {
          text: dish.ingredients
            .map((item) => item.name + ' ' + formatAmount(item.amount) + ' ' + item.unit)
            .join(', ')
        }),
        el('td', { text: dish.time ? formatAmount(dish.time) + ' мин' : '—' })
      ]));

      if (parsed.dishes.length > 12) {
        rows.push(el('tr', {}, [
          el('td', { colspan: '4', text: '…и ещё ' + (parsed.dishes.length - 12) + '. Показаны первые 12.' })
        ]));
      }

      box.appendChild(el('div', { class: 'preview__scroll' }, [
        el('table', { class: 'preview__table' }, [el('thead', {}, head), el('tbody', {}, rows)])
      ]));
    }

    box.appendChild(el('div', { class: 'form-actions form-actions--start' }, [
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        text: 'Импортировать ' + dishWord(parsed.dishes.length),
        disabled: parsed.dishes.length === 0,
        onclick: () => runCsvImport()
      }),
      el('label', { class: 'checkbox' }, [
        el('input', { type: 'checkbox', id: 'csv-update-existing', checked: true }),
        'Обновлять блюда с таким же названием'
      ])
    ]));
  }

  function runCsvImport() {
    const parsed = ui.csvPreview;
    if (!parsed || !parsed.dishes.length) {
      toast('Нечего импортировать: нет ни одного корректного блюда.', 'err');
      return;
    }

    const checkbox = byId('csv-update-existing');
    const result = Store.importDishes(parsed.dishes, {
      updateExisting: checkbox ? checkbox.checked : true
    });

    const parts = [];
    if (result.added) parts.push('добавлено: ' + result.added);
    if (result.updated) parts.push('обновлено: ' + result.updated);
    if (parsed.errors.length) parts.push('пропущено строк: ' + parsed.errors.length);

    toast('Импорт завершён — ' + (parts.join(', ') || 'изменений нет') + '.', 'ok', 7000);

    byId('csv-text').value = '';
    byId('csv-file').value = '';
    ui.csvPreview = null;
    byId('csv-preview').hidden = true;
    clear(byId('csv-preview'));
    setTab('recipes');
  }

  /* ==================================================================== *
   * Импорт CSV: холодильник (name,amount,unit)
   * ==================================================================== */

  const FRIDGE_ACTIONS = {
    new: { text: '➕ появится', cls: 'badge--ok' },
    update: { text: '♻️ обновится', cls: 'badge--warn' },
    sum: { text: '➕ прибавится', cls: 'badge--warn' },
    skip: { text: '⚠️ пропущен', cls: 'badge--err' },
    invalid: { text: '⛔ ошибка', cls: 'badge--err' }
  };

  const FRIDGE_MODES = [
    {
      value: 'merge',
      label: 'Обновлять совпадающие названия',
      hint: 'Уже имеющиеся продукты получат количество из файла, новые добавятся.'
    },
    {
      value: 'sum',
      label: 'Прибавлять к текущему количеству',
      hint: 'Складывается только при полном совпадении единицы измерения.'
    },
    {
      value: 'replace',
      label: 'Заменить холодильник целиком',
      hint: 'Всё, чего нет в файле, будет удалено.'
    }
  ];

  function currentFridgeCsvMode() {
    const checked = doc.querySelector('input[name="fridge-csv-mode"]:checked');
    return checked ? checked.value : ui.fridgeCsvMode;
  }

  /**
   * Предпросмотр импорта холодильника.
   * @param {boolean} reparse true — перечитать текст из поля, false — перерисовать
   *                           уже разобранное (например, при смене режима).
   */
  function renderFridgeCsvPreview(reparse) {
    const box = byId('fridge-csv-preview');

    if (reparse) {
      const text = byId('fridge-csv-text').value;
      if (!cleanText(text)) {
        ui.fridgeCsvPreview = null;
        box.hidden = true;
        clear(box);
        toast('Вставьте CSV-текст или выберите файл.', 'err');
        return;
      }
      ui.fridgeCsvPreview = CSV.parseProducts(text);
    }

    const parsed = ui.fridgeCsvPreview;
    if (!parsed) return;

    const mode = currentFridgeCsvMode();
    ui.fridgeCsvMode = mode;
    const plan = Store.planProductImport(parsed.products, { mode });

    clear(box);
    box.hidden = false;

    box.appendChild(el('div', { class: 'preview__summary' }, [
      el('span', {
        class: 'badge ' + (parsed.products.length ? 'badge--ok' : 'badge--warn'),
        text: 'Готово к импорту: ' + productWord(parsed.products.length)
      }),
      el('span', {
        class: 'badge ' + (parsed.errors.length ? 'badge--err' : 'badge--ok'),
        text: 'Ошибок: ' + parsed.errors.length
      }),
      el('span', { class: 'badge badge--warn', text: 'Строк данных: ' + parsed.rows })
    ]));

    box.appendChild(el('div', { class: 'radio-group' },
      [el('span', { class: 'radio-group__legend', text: 'Что делать с текущим холодильником' })]
        .concat(FRIDGE_MODES.map((item) => el('label', { class: 'radio' }, [
          el('input', {
            type: 'radio',
            name: 'fridge-csv-mode',
            value: item.value,
            checked: item.value === mode,
            onchange: () => renderFridgeCsvPreview(false)
          }),
          el('span', { class: 'radio__body' }, [
            item.label,
            el('span', { class: 'radio__hint', text: item.hint })
          ])
        ])))
    ));

    if (parsed.errors.length) {
      box.appendChild(el('ul', { class: 'preview__errors' },
        parsed.errors.slice(0, 20).map((error) => el('li', {
          text: (error.row ? 'Строка ' + error.row + ': ' : '') + error.message
        })).concat(
          parsed.errors.length > 20
            ? [el('li', { text: '…и ещё ' + (parsed.errors.length - 20) + '.' })]
            : []
        )
      ));
    }

    if (plan.entries.length) {
      const head = el('tr', {}, [
        el('th', { text: 'Продукт' }),
        el('th', { text: 'Количество' }),
        el('th', { text: 'Ед.' }),
        el('th', { text: 'Что будет' })
      ]);

      const rows = plan.entries.slice(0, 15).map((entry) => {
        const action = FRIDGE_ACTIONS[entry.action] || FRIDGE_ACTIONS.invalid;
        let note = action.text;
        if (entry.action === 'sum') {
          note += ' → ' + formatAmount(entry.current) + ' ' + entry.unit;
        }
        if (entry.action === 'skip' || entry.action === 'invalid') {
          note += ' — ' + entry.note;
        }
        return el('tr', {}, [
          el('td', { text: entry.name || '—' }),
          el('td', { text: entry.amount === null ? '—' : formatAmount(entry.amount) }),
          el('td', { text: entry.unit || '—' }),
          el('td', {}, [el('span', { class: 'badge ' + action.cls, text: note })])
        ]);
      });

      if (plan.entries.length > 15) {
        rows.push(el('tr', {}, [
          el('td', { colspan: '4', text: '…и ещё ' + (plan.entries.length - 15) + '. Показаны первые 15.' })
        ]));
      }

      box.appendChild(el('div', { class: 'preview__scroll' }, [
        el('table', { class: 'preview__table' }, [el('thead', {}, head), el('tbody', {}, rows)])
      ]));
    }

    const counts = plan.counts;
    box.appendChild(el('div', { class: 'preview__summary' }, [
      counts.added ? el('span', { class: 'badge badge--ok', text: 'новых: ' + counts.added }) : null,
      counts.updated ? el('span', { class: 'badge badge--warn', text: 'обновится: ' + counts.updated }) : null,
      counts.summed ? el('span', { class: 'badge badge--warn', text: 'прибавится: ' + counts.summed }) : null,
      counts.skipped ? el('span', { class: 'badge badge--err', text: 'пропущено: ' + counts.skipped }) : null,
      el('span', { class: 'badge badge--ok', text: 'в холодильнике станет: ' + productWord(plan.next.length) })
    ]));

    box.appendChild(el('div', { class: 'form-actions form-actions--start' }, [
      el('button', {
        type: 'button',
        class: 'btn btn--primary',
        text: 'Импортировать ' + productWord(parsed.products.length),
        disabled: parsed.products.length === 0,
        onclick: () => runFridgeCsvImport()
      }),
      mode === 'replace'
        ? el('span', { class: 'badge badge--err', text: '⚠️ текущий холодильник будет заменён' })
        : null
    ]));
  }

  function runFridgeCsvImport() {
    const parsed = ui.fridgeCsvPreview;
    if (!parsed || !parsed.products.length) {
      toast('Нечего импортировать: нет ни одного корректного продукта.', 'err');
      return;
    }

    const mode = currentFridgeCsvMode();
    const result = Store.importProducts(parsed.products, { mode });
    const counts = result.counts;
    const parts = [];
    if (counts.added) parts.push('добавлено: ' + counts.added);
    if (counts.updated) parts.push('обновлено: ' + counts.updated);
    if (counts.summed) parts.push('прибавлено: ' + counts.summed);
    if (counts.skipped) parts.push('пропущено: ' + counts.skipped);

    toast(
      'Холодильник обновлён — ' + (parts.join(', ') || 'изменений нет') +
      '. Всего ' + productWord(result.total) + '.',
      'ok',
      8000
    );

    if (result.warnings.length) {
      toast('Замечания: ' + result.warnings.length + ' (подробности в консоли).', 'info', 7000);
      console.warn('Импорт холодильника, замечания:', result.warnings);
    }

    byId('fridge-csv-text').value = '';
    byId('fridge-csv-file').value = '';
    ui.fridgeCsvPreview = null;
    byId('fridge-csv-preview').hidden = true;
    clear(byId('fridge-csv-preview'));
    setTab('fridge');
  }

  /* ==================================================================== *
   * Импорт / экспорт JSON
   * ==================================================================== */

  function readFile(file) {
    return new Promise((resolve, reject) => {
      if (typeof file.text === 'function') {
        file.text().then(resolve, reject);
        return;
      }
      const reader = new global.FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file, 'utf-8');
    });
  }

  function importJsonFile(file) {
    readFile(file).then((text) => {
      let preview;
      try {
        preview = JSON.parse(text);
      } catch (err) {
        toast('Файл не является корректным JSON.', 'err');
        return;
      }

      const dishes = Array.isArray(preview.dishes) ? preview.dishes.length : 0;
      const fridge = Array.isArray(preview.fridge) ? preview.fridge.length : 0;
      const stats = Store.stats();

      confirmDialog({
        title: 'Заменить базу из файла?',
        text: 'В файле «' + file.name + '»: ' + dishWord(dishes) + ' и ' + productWord(fridge) + '.',
        details: 'Сейчас в книге: ' + dishWord(stats.dishes) + ' и ' + productWord(stats.fridge) +
          '. Текущие данные будут полностью заменены.',
        confirmLabel: 'Импортировать',
        danger: true
      }).then((confirmed) => {
        byId('json-file').value = '';
        if (!confirmed) return;

        const result = Store.importData(preview);
        if (!result.ok) {
          toast(result.errors[0] || 'Не удалось импортировать файл.', 'err');
          return;
        }

        toast(
          'База загружена: ' + dishWord(result.imported.dishes) + ' и ' + productWord(result.imported.fridge) + '.',
          'ok',
          7000
        );
        if (result.warnings.length) {
          toast('Пропущено записей: ' + result.warnings.length + '. Подробности в консоли.', 'info', 7000);
          console.warn('Импорт JSON, замечания:', result.warnings);
        }
        resetProductForm();
        resetDishForm();
        setTab('recipes');
      });
    }).catch(() => {
      toast('Не удалось прочитать файл.', 'err');
    });
  }

  function stamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  function download(filename, content, mime) {
    const blob = new global.Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = global.URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
    global.setTimeout(() => global.URL.revokeObjectURL(url), 2000);
  }

  function exportJson() {
    const data = Store.exportData();
    download('cookbook-backup-' + stamp() + '.json', JSON.stringify(data, null, 2), 'application/json');
    toast('Бэкап сохранён: ' + dishWord(data.dishes.length) + ', ' + productWord(data.fridge.length) + '.', 'ok');
  }

  function exportCsv() {
    const dishes = Store.getDishes();
    if (!dishes.length) {
      toast('В книге пока нет блюд для выгрузки.', 'err');
      return;
    }
    download('cookbook-recipes-' + stamp() + '.csv', CSV.toCSV(dishes), 'text/csv;charset=utf-8');
    toast('Выгружено ' + dishWord(dishes.length) + ' в CSV.', 'ok');
  }

  function exportFridgeCsv() {
    const products = Store.getFridge();
    if (!products.length) {
      toast('Холодильник пуст — выгружать нечего.', 'err');
      return;
    }
    download('cookbook-fridge-' + stamp() + '.csv', CSV.toProductsCSV(products), 'text/csv;charset=utf-8');
    toast('Выгружено ' + productWord(products.length) + ' в CSV.', 'ok');
  }

  /* ==================================================================== *
   * Настройки
   * ==================================================================== */

  function storageSize() {
    try {
      const raw = (global.localStorage.getItem(Store.KEYS.dishes) || '') +
        (global.localStorage.getItem(Store.KEYS.fridge) || '');
      return Math.max(1, Math.round(raw.length / 102.4) / 10);
    } catch (err) {
      return 0;
    }
  }

  function renderSettings() {
    const stats = Store.stats();
    const available = Matcher.availableDishes(Store.getDishes(), Store.getFridge()).length;

    const box = clear(byId('settings-stats'));
    const cards = [
      { value: stats.dishes, label: 'блюд в книге' },
      { value: stats.fridge, label: 'продуктов в холодильнике' },
      { value: available, label: 'можно приготовить сейчас' },
      { value: storageSize() + ' КБ', label: 'занимает база в браузере' }
    ];

    cards.forEach((card) => {
      box.appendChild(el('div', { class: 'stat' }, [
        el('div', { class: 'stat__value', text: String(card.value) }),
        el('div', { class: 'stat__label', text: card.label })
      ]));
    });
  }

  /* ==================================================================== *
   * Общая отрисовка
   * ==================================================================== */

  function renderTopbar() {
    const stats = Store.stats();
    const available = Matcher.availableDishes(Store.getDishes(), Store.getFridge()).length;

    byId('brand-summary').textContent = stats.dishes || stats.fridge
      ? dishWord(stats.dishes) + ' · ' + productWord(stats.fridge)
      : 'Пустая книга — начни с холодильника';

    const box = clear(byId('topbar-stats'));
    if (!stats.dishes && !stats.fridge) return;
    [
      { text: '📖 ' + stats.dishes, title: 'Блюд в книге' },
      { text: '🧊 ' + stats.fridge, title: 'Продуктов в холодильнике' },
      { text: '✅ ' + available, title: 'Можно приготовить сейчас' }
    ].forEach((chip) => {
      box.appendChild(el('span', { class: 'badge badge--warn', title: chip.title, text: chip.text }));
    });
  }

  function render() {
    renderTopbar();
    renderRecipes();
    renderFridge();
    renderSettings();
  }

  /* ==================================================================== *
   * События
   * ==================================================================== */

  function wireEvents() {
    /* Вкладки */
    Array.prototype.forEach.call(doc.querySelectorAll('.tab'), (button) => {
      button.addEventListener('click', () => setTab(button.dataset.tab));
    });

    global.addEventListener('hashchange', () => {
      const name = global.location.hash.slice(1);
      if (PANEL_IDS.indexOf(name) !== -1 && name !== ui.tab) {
        setTab(name, { updateHash: false });
      }
    });

    /* Поиск и фильтры рецептов */
    const search = byId('recipe-search');
    search.addEventListener('input', () => {
      ui.search = search.value;
      renderRecipes();
    });
    byId('recipe-search-clear').addEventListener('click', () => {
      ui.search = '';
      search.value = '';
      search.focus();
      renderRecipes();
    });

    byId('only-available').addEventListener('change', (event) => {
      ui.onlyAvailable = event.target.checked;
      Store.setUI({ onlyAvailable: ui.onlyAvailable });
      renderRecipes();
    });

    Array.prototype.forEach.call(doc.querySelectorAll('#section-filter .chip'), (chip) => {
      chip.addEventListener('click', () => {
        ui.section = chip.dataset.section;
        Array.prototype.forEach.call(doc.querySelectorAll('#section-filter .chip'), (other) => {
          const active = other === chip;
          other.classList.toggle('is-active', active);
          other.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        Store.setUI({ section: ui.section });
        renderRecipes();
      });
    });

    /* Холодильник */
    byId('product-form').addEventListener('submit', submitProductForm);
    byId('product-cancel').addEventListener('click', () => {
      resetProductForm();
      toast('Редактирование отменено.', 'info');
    });
    const fridgeSearch = byId('fridge-search');
    fridgeSearch.addEventListener('input', () => {
      ui.fridgeSearch = fridgeSearch.value;
      renderFridge();
    });
    byId('fridge-search-clear').addEventListener('click', () => {
      ui.fridgeSearch = '';
      fridgeSearch.value = '';
      fridgeSearch.focus();
      renderFridge();
    });

    /* Форма блюда */
    byId('dish-form').addEventListener('submit', submitDishForm);
    byId('add-ingredient').addEventListener('click', () => {
      byId('ingredient-rows').appendChild(ingredientRow(null));
    });
    byId('add-step').addEventListener('click', () => {
      const container = byId('step-rows');
      container.appendChild(stepRow('', container.children.length));
    });
    byId('dish-cancel').addEventListener('click', () => {
      resetDishForm();
      toast('Редактирование отменено.', 'info');
    });
    byId('dish-reset').addEventListener('click', () => {
      resetDishForm();
    });

    /* Импорт CSV */
    byId('csv-file').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      readFile(file).then((text) => {
        byId('csv-text').value = text;
        renderCsvPreview();
      }).catch(() => toast('Не удалось прочитать файл.', 'err'));
    });
    byId('csv-preview-btn').addEventListener('click', renderCsvPreview);
    byId('csv-clear').addEventListener('click', () => {
      byId('csv-text').value = '';
      byId('csv-file').value = '';
      ui.csvPreview = null;
      byId('csv-preview').hidden = true;
      clear(byId('csv-preview'));
    });
    byId('csv-template').addEventListener('click', () => {
      download('cookbook-template.csv', CSV.template(), 'text/csv;charset=utf-8');
      toast('Шаблон CSV сохранён — открой его в таблице или в блокноте.', 'ok');
    });

    /* Импорт CSV: холодильник */
    byId('fridge-csv-file').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      readFile(file).then((text) => {
        byId('fridge-csv-text').value = text;
        renderFridgeCsvPreview(true);
      }).catch(() => toast('Не удалось прочитать файл.', 'err'));
    });
    byId('fridge-csv-preview-btn').addEventListener('click', () => renderFridgeCsvPreview(true));
    byId('fridge-csv-clear').addEventListener('click', () => {
      byId('fridge-csv-text').value = '';
      byId('fridge-csv-file').value = '';
      ui.fridgeCsvPreview = null;
      byId('fridge-csv-preview').hidden = true;
      clear(byId('fridge-csv-preview'));
    });
    byId('fridge-csv-template').addEventListener('click', () => {
      download('cookbook-fridge-template.csv', CSV.productsTemplate(), 'text/csv;charset=utf-8');
      toast('Шаблон холодильника сохранён: name,amount,unit.', 'ok');
    });

    /* Импорт JSON */
    byId('json-file').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0];
      if (file) importJsonFile(file);
    });

    /* Настройки */
    byId('export-json').addEventListener('click', exportJson);
    byId('export-csv').addEventListener('click', exportCsv);
    byId('export-fridge-csv').addEventListener('click', exportFridgeCsv);
    byId('reset-data').addEventListener('click', () => {
      const stats = Store.stats();
      confirmDialog({
        title: 'Удалить все данные?',
        text: 'Будут удалены ' + dishWord(stats.dishes) + ' и ' + productWord(stats.fridge) + ' из этого браузера.',
        details: 'Восстановить данные можно только из заранее сохранённого JSON-бэкапа.',
        confirmLabel: 'Удалить всё',
        danger: true
      }).then((confirmed) => {
        if (!confirmed) return;
        Store.resetAll();
        resetProductForm();
        resetDishForm();
        toast('База очищена. Можно начинать заново.', 'ok');
        setTab('recipes');
      });
    });

    /* Клавиатура */
    doc.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modalStack.length) {
        event.preventDefault();
        closeTopModal();
      }
    });
  }

  /* ==================================================================== *
   * Запуск
   * ==================================================================== */

  function init() {
    Store.load();
    const saved = Store.getUI();

    if (saved.section) {
      ui.section = saved.section;
      Array.prototype.forEach.call(doc.querySelectorAll('#section-filter .chip'), (chip) => {
        const active = chip.dataset.section === ui.section;
        chip.classList.toggle('is-active', active);
        chip.setAttribute('aria-selected', active ? 'true' : 'false');
      });
    }

    if (typeof saved.onlyAvailable === 'boolean') {
      ui.onlyAvailable = saved.onlyAvailable;
      byId('only-available').checked = saved.onlyAvailable;
    }

    resetProductForm();
    resetDishForm();
    wireEvents();

    Store.subscribe(render);
    render();

    const fromHash = global.location.hash.slice(1);
    const initial = PANEL_IDS.indexOf(fromHash) !== -1
      ? fromHash
      : (PANEL_IDS.indexOf(saved.tab) !== -1 ? saved.tab : 'recipes');
    setTab(initial, { scroll: false });
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* Небольшой отладочный доступ из консоли браузера. */
  global.CookbookApp = { ui, render, setTab, toast, Store, Matcher, CSV };
})(typeof window !== 'undefined' ? window : globalThis);
