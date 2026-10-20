// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/* ============================================================================
 * Интеграционная проверка интерфейса: настоящий DOM (jsdom),
 * Supabase и api.ts заменены моками.
 * ========================================================================== */

vi.mock('./lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabaseProjectRef: 'test-project',
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithPassword: vi.fn(),
      signOut: vi.fn()
    }
  }
}));

vi.mock('./lib/api', () => ({
  fetchSections: vi.fn(),
  fetchDishes: vi.fn(),
  fetchFridge: vi.fn(),
  cookDish: vi.fn(),
  createDish: vi.fn(),
  updateDish: vi.fn(),
  deleteDish: vi.fn(),
  addFridgeItem: vi.fn(),
  updateFridgeItem: vi.fn(),
  applyFridgePurchase: vi.fn(),
  deleteFridgeItem: vi.fn(),
  clearFridge: vi.fn(),
  consumeProduct: vi.fn(),
  wasteProduct: vi.fn(),
  wasteExpiredProducts: vi.fn(),
  normalizeFridgeNames: vi.fn(),
  applyFridgeImport: vi.fn(),
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
  importDishes: vi.fn()
}));

import App from './App';
import * as api from './lib/api';
import { supabase } from './lib/supabase';
import type { FridgeImportPlan } from './lib/fridgeImport';
import type { Dish, FridgeItem, Section } from './lib/types';

const SECTIONS: Section[] = [
  { id: 'breakfast', title: 'Завтрак', sortOrder: 1 },
  { id: 'lunch', title: 'Обед', sortOrder: 2 },
  { id: 'dinner', title: 'Ужин', sortOrder: 3 }
];

const OMELETTE: Dish = {
  id: 'd-omlet',
  title: 'Омлет с сыром',
  sectionId: 'breakfast',
  timeMin: 15,
  steps: ['Взбить яйца', 'Обжарить'],
  notes: '',
  ingredients: [
    { name: 'яйца', amount: 3, unit: 'шт', sortOrder: 0 },
    { name: 'сыр', amount: 50, unit: 'г', sortOrder: 1 }
  ]
};

const BORSCH: Dish = {
  id: 'd-borsch',
  title: 'Борщ',
  sectionId: 'lunch',
  timeMin: 90,
  steps: [],
  notes: '',
  ingredients: [{ name: 'свёкла', amount: 300, unit: 'г', sortOrder: 0 }]
};

let fridge: FridgeItem[];

function setSession(session: unknown) {
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session },
    error: null
  } as Awaited<ReturnType<typeof supabase.auth.getSession>>);
}

function cardByTitle(title: string): HTMLElement {
  const card = screen.getByText(title).closest('article');
  if (!card) throw new Error(`Не найдена карточка «${title}»`);
  return card;
}

/** План последнего вызова api.applyFridgeImport. */
function planFromLastCall(): FridgeImportPlan {
  const calls = vi.mocked(api.applyFridgeImport).mock.calls;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('api.applyFridgeImport не вызывался');
  return last[0];
}

/** Дата «сегодня + N дней» в формате YYYY-MM-DD (как считает shelfLife). */
function datePlusDays(days: number): string {
  const today = new Date();
  const stamp = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return new Date(stamp + days * 86_400_000).toISOString().slice(0, 10);
}

/** Заполняет форму добавления продукта в холодильнике. */
function fillFridgeForm(name: string, amount: string, expiresAt?: string): HTMLButtonElement {
  if (!screen.queryByRole('dialog', { name: 'Добавить продукт' })) {
    fireEvent.click(screen.getByRole('button', { name: 'Добавить продукт' }));
  }
  const dialog = screen.getByRole('dialog', { name: 'Добавить продукт' });
  fireEvent.change(within(dialog).getByLabelText(/^Название/), { target: { value: name } });
  fireEvent.change(within(dialog).getByLabelText(/^Количество/), { target: { value: amount } });
  if (expiresAt !== undefined) {
    fireEvent.change(within(dialog).getByLabelText(/^Срок годности/), { target: { value: expiresAt } });
  }
  return within(dialog).getByRole('button', { name: 'Добавить продукт' }) as HTMLButtonElement;
}

/** Поле срока годности в форме. */
function expiryField(): HTMLInputElement {
  return screen.getByLabelText(/^Срок годности/) as HTMLInputElement;
}

/** Строка продукта в списке холодильника. */
function fridgeRow(name: string): HTMLElement | null {
  const nameNode = screen.queryByText(name);
  return nameNode ? nameNode.closest('li') : null;
}

/** Переход на страницу холодильника. */
async function openFridgePage(): Promise<void> {
  render(<App />);
  await screen.findByText('Омлет с сыром');
  fireEvent.click(screen.getAllByRole('link', { name: /Продукты/ })[0]);
  await screen.findByRole('heading', { name: 'Мои продукты' });
}

beforeEach(() => {
  // HashRouter читает window.location, а он живёт между тестами одного файла
  window.history.replaceState(null, '', '#/recipes');

  fridge = [
    { id: 'p1', name: 'яйца', amount: 10, unit: 'шт', updatedAt: null, expiresAt: null },
    { id: 'p2', name: 'сыр', amount: 300, unit: 'г', updatedAt: null, expiresAt: null },
    { id: 'p3', name: 'хлеб', amount: 500, unit: 'г', updatedAt: null, expiresAt: null },
    { id: 'p4', name: 'молоко', amount: 1000, unit: 'мл', updatedAt: null, expiresAt: null },
    { id: 'p5', name: 'огурцы', amount: 300, unit: 'г', updatedAt: null, expiresAt: null },
    { id: 'p6', name: 'орехи', amount: 100, unit: 'г', updatedAt: null, expiresAt: null }
  ];

  setSession({ user: { email: 'cook@example.com' } });
  vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } }
  } as unknown as ReturnType<typeof supabase.auth.onAuthStateChange>);

  vi.mocked(api.fetchSections).mockImplementation(async () => SECTIONS);
  vi.mocked(api.fetchDishes).mockImplementation(async () => [OMELETTE, BORSCH]);
  // Копия массива: тот же ссылочный объект React счёл бы «тем же состоянием».
  vi.mocked(api.fetchFridge).mockImplementation(async () => [...fridge]);
  vi.mocked(api.cookDish).mockResolvedValue({ success: true, missing: [] });
  vi.mocked(api.applyFridgeImport).mockImplementation(async (plan) => plan.counts);
  vi.mocked(api.normalizeFridgeNames).mockImplementation(async (groups) => {
    let normalized = 0;
    for (const group of groups) {
      const matched = fridge.filter((item) => group.ids.includes(item.id) && item.unit === group.unit);
      if (!matched.length) continue;
      const target = matched[0];
      const ids = new Set(matched.map((item) => item.id));
      target.name = group.name;
      target.amount = matched.reduce((sum, item) => sum + item.amount, 0);
      fridge = fridge.filter((item) => item.id === target.id || !ids.has(item.id));
      normalized += matched.length;
    }
    return normalized;
  });
  vi.mocked(api.addFridgeItem).mockImplementation(async (input) => {
    const created: FridgeItem = {
      id: `p${fridge.length + 1}`,
      name: input.name.trim(),
      amount: input.amount,
      unit: input.unit,
      updatedAt: null,
      expiresAt: input.expiresAt ?? null
    };
    fridge.push(created);
    return created;
  });
  vi.mocked(api.updateFridgeItem).mockImplementation(async (id, patch) => {
    const existing = fridge.find((item) => item.id === id);
    const updated: FridgeItem = {
      ...existing,
      id,
      name: patch.name ?? existing?.name ?? '',
      amount: patch.amount ?? existing?.amount ?? 0,
      unit: patch.unit ?? existing?.unit ?? 'г',
      updatedAt: null,
      expiresAt: patch.expiresAt ?? existing?.expiresAt ?? null
    };
    if (existing) Object.assign(existing, updated);
    return updated;
  });
  vi.mocked(api.deleteFridgeItem).mockImplementation(async (id) => {
    // Меняем массив на месте: мок fetchFridge замыкается на эту же переменную.
    const rest = fridge.filter((item) => item.id !== id);
    fridge.length = 0;
    fridge.push(...rest);
  });
  vi.mocked(api.wasteProduct).mockImplementation(async (id, amount) => {
    const existing = fridge.find((item) => item.id === id);
    if (existing && amount >= existing.amount) fridge = fridge.filter((item) => item.id !== id);
    else if (existing) existing.amount -= amount;
    return { cost: 0, costComplete: false };
  });
  vi.mocked(api.consumeProduct).mockImplementation(async (id, amount, operationId) => {
    const existing = fridge.find((item) => item.id === id);
    const before = existing?.amount ?? 0;
    const cost = before > 0 ? (existing?.totalCost ?? 0) * amount / before : 0;
    if (existing && amount >= existing.amount) fridge = fridge.filter((item) => item.id !== id);
    else if (existing) existing.amount -= amount;
    return {
      operationId,
      amount,
      remainingAmount: Math.max(0, before - amount),
      cost,
      costComplete: Boolean(existing && (existing.pricedAmount ?? 0) >= before)
    };
  });
  vi.mocked(api.wasteExpiredProducts).mockResolvedValue({ count: 0, cost: 0 });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('Recipes', () => {
  it('показывает доступные и недоступные блюда, блокируя кнопку', async () => {
    render(<App />);

    expect(await screen.findByText('Омлет с сыром')).toBeTruthy();
    expect(screen.getByText('Борщ')).toBeTruthy();

    const omeletteButton = within(cardByTitle('Омлет с сыром')).getByRole('button', {
      name: 'Приготовить'
    });
    expect((omeletteButton as HTMLButtonElement).disabled).toBe(false);

    const borschCard = cardByTitle('Борщ');
    const borschButton = within(borschCard).getByRole('button', { name: 'Приготовить' });
    expect((borschButton as HTMLButtonElement).disabled).toBe(true);
    expect(within(borschCard).getByText('Не хватает: свёкла 300 г')).toBeTruthy();
  });

  it('фильтр «Что приготовить» оставляет только доступные блюда', async () => {
    render(<App />);
    await screen.findByText('Омлет с сыром');

    fireEvent.click(screen.getByRole('checkbox', { name: /Что приготовить/ }));

    await waitFor(() => {
      expect(screen.queryByText('Борщ')).toBeNull();
    });
    expect(screen.getByText('Омлет с сыром')).toBeTruthy();
  });

  it('поиск ищет по названию блюда и по ингредиентам', async () => {
    render(<App />);
    await screen.findByText('Омлет с сыром');

    const search = screen.getByLabelText('Поиск по блюду или ингредиенту');

    fireEvent.change(search, { target: { value: 'свёкла' } });
    await waitFor(() => expect(screen.queryByText('Омлет с сыром')).toBeNull());
    expect(screen.getByText('Борщ')).toBeTruthy();

    fireEvent.change(search, { target: { value: 'сыр' } });
    await waitFor(() => expect(screen.queryByText('Борщ')).toBeNull());
    expect(screen.getByText('Омлет с сыром')).toBeTruthy();
  });

  it('приготовление вызывает cook_dish и обновляет карточки', async () => {
    render(<App />);
    await screen.findByText('Омлет с сыром');

    // после готовки яйца закончились
    vi.mocked(api.cookDish).mockImplementation(async () => {
      fridge = [{ id: 'p2', name: 'сыр', amount: 250, unit: 'г', updatedAt: null, expiresAt: null }];
      return { success: true, missing: [] };
    });

    fireEvent.click(within(cardByTitle('Омлет с сыром')).getByRole('button', { name: 'Приготовить' }));

    await waitFor(() => {
      const card = cardByTitle('Омлет с сыром');
      const button = within(card).getByRole('button', { name: 'Приготовить' });
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(within(card).getByText(/Не хватает:/)).toBeTruthy();
    });

    expect(api.cookDish).toHaveBeenCalledWith('d-omlet');
  });

  it('сообщает о нехватке продуктов, если cook_dish вернул success:false', async () => {
    render(<App />);
    await screen.findByText('Омлет с сыром');

    vi.mocked(api.cookDish).mockResolvedValue({
      success: false,
      missing: [{ name: 'сыр', need: 50, have: 0, unit: 'г', reason: 'absent' }]
    });

    fireEvent.click(within(cardByTitle('Омлет с сыром')).getByRole('button', { name: 'Приготовить' }));

    expect(await screen.findByText('Не хватает: сыр 50 г')).toBeTruthy();
  });
});

describe('Главная', () => {
  it('показывает реальные показатели и только доступные рецепты', async () => {
    window.history.replaceState(null, '', '#/');
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Мой холодильник', level: 1 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Продукты 6' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Сроки 0' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Рецепты 1' })).toBeTruthy();
    expect(screen.getByText('Омлет с сыром')).toBeTruthy();
    expect(screen.queryByText('Борщ')).toBeNull();
  });

  it('показывает блок внимания только для проблемных сроков', async () => {
    fridge[0].expiresAt = datePlusDays(-1);
    fridge[1].expiresAt = datePlusDays(2);
    window.history.replaceState(null, '', '#/');
    render(<App />);

    expect(await screen.findByText('Требуют внимания')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Сроки 2' })).toBeTruthy();
  });
});

describe('Навигация и защита маршрутов', () => {
  it('без сессии показывает страницу входа', async () => {
    setSession(null);
    render(<App />);

    expect(await screen.findByRole('button', { name: 'Войти' })).toBeTruthy();
    expect(screen.queryByText('Омлет с сыром')).toBeNull();
  });

  it('переход на «Холодильник» показывает список продуктов', async () => {
    render(<App />);
    await screen.findByText('Омлет с сыром');

    fireEvent.click(screen.getAllByRole('link', { name: /Продукты/ })[0]);

    expect(await screen.findByText('сыр')).toBeTruthy();
    expect(screen.getByText('яйца')).toBeTruthy();
    expect(screen.getByText('1000 мл')).toBeTruthy();
  });
});

describe('Подсказки ингредиентов из холодильника', () => {
  async function openDishForm(): Promise<void> {
    render(<App />);
    await screen.findByText('Омлет с сыром');

    fireEvent.click(screen.getAllByRole('link', { name: 'Добавить' })[0]);
    await screen.findByLabelText('Название ингредиента №1');
  }

  function nameInput(): HTMLInputElement {
    return screen.getByLabelText('Название ингредиента №1') as HTMLInputElement;
  }

  function unitSelect(): HTMLSelectElement {
    return screen.getByLabelText('Единица измерения ингредиента №1') as HTMLSelectElement;
  }

  function optionNames(): string[] {
    const listbox = screen.getByRole('listbox');
    return within(listbox)
      .getAllByRole('option')
      .map((option) => option.querySelector('span')?.textContent?.trim() ?? '');
  }

  it('«о» показывает огурцы и орехи, но не молоко', async () => {
    await openDishForm();

    fireEvent.change(nameInput(), { target: { value: 'о' } });

    expect(optionNames()).toEqual(['огурцы', 'орехи']);
  });

  it('«ог» оставляет только огурцы', async () => {
    await openDishForm();

    fireEvent.change(nameInput(), { target: { value: 'о' } });
    expect(optionNames()).toHaveLength(2);

    fireEvent.change(nameInput(), { target: { value: 'ог' } });
    expect(optionNames()).toEqual(['огурцы']);
  });

  it('выбор подсказки подставляет название и единицу измерения', async () => {
    await openDishForm();

    fireEvent.change(nameInput(), { target: { value: 'мол' } });
    expect(optionNames()).toEqual(['молоко']);

    fireEvent.click(screen.getByRole('option', { name: /молоко/ }));

    expect(nameInput().value).toBe('молоко');
    expect(unitSelect().value).toBe('мл');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('незнакомый продукт закрывает список, но вводится руками', async () => {
    await openDishForm();

    fireEvent.change(nameInput(), { target: { value: 'бекон' } });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(nameInput().value).toBe('бекон');
  });

  it('стрелки и Enter выбирают подсказку с клавиатуры', async () => {
    await openDishForm();

    const input = nameInput();
    fireEvent.change(input, { target: { value: 'о' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(nameInput().value).toBe('орехи');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Escape закрывает список, введённый текст остаётся', async () => {
    await openDishForm();

    const input = nameInput();
    fireEvent.change(input, { target: { value: 'ог' } });
    expect(screen.queryByRole('listbox')).not.toBeNull();

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.value).toBe('ог');
  });
});

describe('Нормализация холодильника', () => {
  it('по подтверждению объединяет старые магазинные названия', async () => {
    fridge = [
      { id: 'old-1', name: 'ТЕНД.Филе кур.0охл.ПОдл.', amount: 285, unit: 'г', updatedAt: null, expiresAt: null },
      { id: 'old-2', name: 'ТЕНД.Филе кур.охХп.moап.', amount: 722, unit: 'г', updatedAt: null, expiresAt: null }
    ];
    await openFridgePage();

    fireEvent.click(screen.getByRole('button', { name: 'Действия со списком' }));
    fireEvent.click(screen.getByRole('button', { name: 'Объединить названия (1)' }));
    const dialog = await screen.findByRole('dialog', { name: 'Объединить магазинные названия?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Объединить' }));

    await waitFor(() => expect(api.normalizeFridgeNames).toHaveBeenCalledWith([{
      name: 'Филе куриное', unit: 'г', ids: ['old-1', 'old-2']
    }]));
    expect(await screen.findByText('Филе куриное')).toBeTruthy();
    expect(screen.getByText('1007 г')).toBeTruthy();
    expect(screen.queryByText('ТЕНД.Филе кур.0охл.ПОдл.')).toBeNull();
  });
});

describe('Импорт холодильника из CSV', () => {
  async function openImportPage(): Promise<HTMLElement> {
    render(<App />);
    await screen.findByText('Омлет с сыром');

    fireEvent.click(screen.getAllByRole('link', { name: 'Импорт' })[0]);
    const heading = await screen.findByRole('heading', { name: /Холодильник из CSV/ });
    const card = heading.closest('section');
    if (!card) throw new Error('Не найдена карточка импорта холодильника');
    return card;
  }

  function fridgeTextarea(): HTMLElement {
    return screen.getByLabelText('…или вставьте CSV прямо сюда', { selector: '#fridge-csv-text' });
  }

  it('разбирает CSV, показывает предпросмотр и пишет в базу', async () => {
    const card = await openImportPage();

    fireEvent.change(fridgeTextarea(), {
      target: { value: 'name,amount,unit\nмука,2000,г\nяйца,12,шт' }
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Проверить' }));

    expect(await screen.findByText('Готово к импорту: 2 продукта')).toBeTruthy();
    expect(screen.getByText('Строк данных: 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Импортировать 2 продукта/ }));

    await waitFor(() => expect(api.applyFridgeImport).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Холодильник обновлён/)).toBeTruthy();

    const plan = planFromLastCall();
    expect(plan.mode).toBe('merge');
    expect(plan.inserts).toEqual([
      { name: 'мука', amount: 2000, unit: 'г', expiresAt: null }
    ]);
    expect(plan.updates).toEqual([
      { id: 'p1', patch: { name: 'яйца', amount: 12, unit: 'шт', expiresAt: datePlusDays(30) } }
    ]);
  });

  it('в режиме «прибавлять» складывает количество', async () => {
    const card = await openImportPage();

    fireEvent.change(fridgeTextarea(), {
      target: { value: 'name,amount,unit\nмука,2000,г\nяйца,12,шт' }
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Проверить' }));
    expect(await screen.findByText('Готово к импорту: 2 продукта')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Прибавлять к текущему количеству/ }));
    fireEvent.click(screen.getByRole('button', { name: /Импортировать 2 продукта/ }));

    await waitFor(() => expect(api.applyFridgeImport).toHaveBeenCalledTimes(1));

    const plan = planFromLastCall();
    expect(plan.mode).toBe('sum');
    expect(plan.counts).toEqual({ added: 1, updated: 0, summed: 1, skipped: 0 });
    expect(plan.updates).toEqual([
      { id: 'p1', patch: { name: 'яйца', amount: 22, unit: 'шт', expiresAt: datePlusDays(30) } }
    ]);
  });

  it('показывает ошибки строк и импортирует корректные', async () => {
    const card = await openImportPage();

    fireEvent.change(fridgeTextarea(), {
      target: { value: 'name,amount,unit\nмука,1000,кг\nтворог,400,г' }
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Проверить' }));

    expect(await screen.findByText('Ошибок: 1')).toBeTruthy();
    expect(screen.getByText('Готово к импорту: 1 продукт')).toBeTruthy();
    expect(screen.getByText(/Строка 2: Единица измерения/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Импортировать 1 продукт/ }));
    await waitFor(() => expect(api.applyFridgeImport).toHaveBeenCalledTimes(1));

    const plan = planFromLastCall();
    expect(plan.inserts).toEqual([
      { name: 'творог', amount: 400, unit: 'г', expiresAt: datePlusDays(7) }
    ]);
    expect(plan.counts).toEqual({ added: 1, updated: 0, summed: 0, skipped: 0 });
  });
});

describe('Продукты v2.1', () => {
  it('показывает компактные строки и выбирает действие по актуальному сроку', async () => {
    fridge = [
      { id: 'fresh', name: 'яблоки', amount: 4, unit: 'шт', updatedAt: null, expiresAt: datePlusDays(5) },
      { id: 'expired', name: 'кефир', amount: 500, unit: 'мл', updatedAt: null, expiresAt: datePlusDays(-1) }
    ];
    await openFridgePage();

    expect(within(fridgeRow('яблоки')!).getByRole('button', { name: 'Использовать' })).toBeTruthy();
    expect(within(fridgeRow('кефир')!).getByRole('button', { name: 'Выбросить' })).toBeTruthy();
    expect(within(fridgeRow('кефир')!).getByText(/просрочено/)).toBeTruthy();
  });

  it('ищет, фильтрует и сортирует продукты, сохраняя состояние в адресе', async () => {
    fridge = [
      { id: 'z', name: 'Яблоки', amount: 4, unit: 'шт', updatedAt: null, expiresAt: datePlusDays(8) },
      { id: 'a', name: 'кефир', amount: 500, unit: 'мл', updatedAt: null, expiresAt: datePlusDays(-1) },
      { id: 'm', name: 'молоко', amount: 1, unit: 'шт', updatedAt: null, expiresAt: null }
    ];
    await openFridgePage();

    fireEvent.change(screen.getByLabelText('Найти продукт'), { target: { value: 'мол' } });
    expect(fridgeRow('молоко')).toBeTruthy();
    expect(fridgeRow('кефир')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Очистить поиск' }));

    fireEvent.click(screen.getByRole('tab', { name: 'Требуют внимания' }));
    expect(fridgeRow('кефир')).toBeTruthy();
    expect(fridgeRow('Яблоки')).toBeNull();
    expect(window.location.hash).toContain('expiring=1');
    expect(window.location.hash).toContain('sort=expiry');

    fireEvent.click(screen.getByRole('tab', { name: 'Все' }));
    fireEvent.change(screen.getByLabelText('Сортировка продуктов'), { target: { value: 'expiry' } });
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByRole('button', { name: 'кефир' })).toBeTruthy();
  });

  it('открывает подробности по названию и возвращается назад из редактирования без сохранения', async () => {
    await openFridgePage();
    fireEvent.click(screen.getByRole('button', { name: 'яйца' }));
    const details = await screen.findByRole('dialog', { name: 'яйца' });
    expect(within(details).getByText('10 шт')).toBeTruthy();

    fireEvent.click(within(details).getByRole('button', { name: 'Редактировать' }));
    const edit = await screen.findByRole('dialog', { name: 'Редактировать продукт' });
    fireEvent.change(within(edit).getByLabelText(/^Название/), { target: { value: 'перепелиные яйца' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Назад' }));

    expect(await screen.findByRole('dialog', { name: 'яйца' })).toBeTruthy();
    expect(api.updateFridgeItem).not.toHaveBeenCalled();
  });

  it('редактирует продукт, сохраняя неизвестную стоимость неизвестной', async () => {
    fridge = [{ id: 'p1', name: 'яйца', amount: 10, unit: 'шт', updatedAt: null, expiresAt: null }];
    await openFridgePage();
    fireEvent.click(screen.getByRole('button', { name: 'яйца' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'яйца' })).getByRole('button', { name: 'Редактировать' }));
    const edit = await screen.findByRole('dialog', { name: 'Редактировать продукт' });
    fireEvent.change(within(edit).getByLabelText(/^Количество/), { target: { value: '8' } });
    fireEvent.click(within(edit).getByRole('button', { name: 'Сохранить изменения' }));

    await waitFor(() => expect(api.updateFridgeItem).toHaveBeenCalledWith('p1', expect.objectContaining({
      amount: 8,
      purchaseCost: null
    })));
    expect(await screen.findByRole('dialog', { name: 'яйца' })).toBeTruthy();
  });

  it('использует часть продукта через RPC и показывает рассчитанный остаток', async () => {
    fridge = [{ id: 'p1', name: 'бананы', amount: 1000, unit: 'г', updatedAt: null, expiresAt: null, totalCost: 200, pricedAmount: 1000 }];
    await openFridgePage();
    fireEvent.click(within(fridgeRow('бананы')!).getByRole('button', { name: 'Использовать' }));
    const useDialog = await screen.findByRole('dialog', { name: 'Использовать продукт' });
    fireEvent.change(within(useDialog).getByLabelText('Количество, г'), { target: { value: '0' } });
    expect((within(useDialog).getByRole('button', { name: 'Подтвердить использование' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(useDialog).getByLabelText('Количество, г'), { target: { value: '300' } });

    expect(within(useDialog).getByText('700 г')).toBeTruthy();
    const confirm = within(useDialog).getByRole('button', { name: 'Подтвердить использование' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.consumeProduct).toHaveBeenCalledWith('p1', 300, expect.any(String)));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Использовать продукт' })).toBeNull());
    expect(fridgeRow('бананы')).toBeTruthy();
    expect(within(fridgeRow('бананы')!).getByText('700 г')).toBeTruthy();
  });

  it('при сетевом повторе использует тот же operation_id и не закрывает окно после ошибки', async () => {
    fridge = [{ id: 'p1', name: 'бананы', amount: 1000, unit: 'г', updatedAt: null, expiresAt: null }];
    vi.mocked(api.consumeProduct)
      .mockRejectedValueOnce(new Error('Сеть недоступна'))
      .mockImplementationOnce(async (_id, amount, operationId) => ({
        operationId,
        amount,
        remainingAmount: 700,
        cost: 0,
        costComplete: false
      }));
    await openFridgePage();
    fireEvent.click(within(fridgeRow('бананы')!).getByRole('button', { name: 'Использовать' }));
    const useDialog = await screen.findByRole('dialog', { name: 'Использовать продукт' });
    fireEvent.change(within(useDialog).getByLabelText('Количество, г'), { target: { value: '300' } });
    fireEvent.click(within(useDialog).getByRole('button', { name: 'Подтвердить использование' }));

    expect(await screen.findByText('Сеть недоступна')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Использовать продукт' })).toBeTruthy();
    const firstOperationId = vi.mocked(api.consumeProduct).mock.calls[0][2];
    fireEvent.click(within(useDialog).getByRole('button', { name: 'Подтвердить использование' }));
    await waitFor(() => expect(api.consumeProduct).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.consumeProduct).mock.calls[1][2]).toBe(firstOperationId);
  });

  it('после полного использования убирает продукт из активных запасов', async () => {
    fridge = [{ id: 'p1', name: 'яйца', amount: 10, unit: 'шт', updatedAt: null, expiresAt: null }];
    await openFridgePage();
    fireEvent.click(within(fridgeRow('яйца')!).getByRole('button', { name: 'Использовать' }));
    const useDialog = await screen.findByRole('dialog', { name: 'Использовать продукт' });
    fireEvent.change(within(useDialog).getByLabelText('Количество, шт'), { target: { value: '10' } });
    fireEvent.click(within(useDialog).getByRole('button', { name: 'Подтвердить использование' }));

    await waitFor(() => expect(api.consumeProduct).toHaveBeenCalledWith('p1', 10, expect.any(String)));
    await waitFor(() => expect(fridgeRow('яйца')).toBeNull());
  });

  it('подтверждает административное удаление отдельно и только явно', async () => {
    fridge = [{ id: 'p1', name: 'бананы', amount: 1000, unit: 'г', updatedAt: null, expiresAt: null }];
    await openFridgePage();
    fireEvent.click(screen.getByRole('button', { name: 'бананы' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'бананы' })).getByRole('button', { name: 'Удалить запись' }));
    const confirmation = await screen.findByRole('dialog', { name: 'Удалить продукт?' });

    expect(api.deleteFridgeItem).not.toHaveBeenCalled();
    expect(within(confirmation).getByText(/Запись «бананы» будет удалена/)).toBeTruthy();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Удалить запись' }));
    await waitFor(() => expect(api.deleteFridgeItem).toHaveBeenCalledWith('p1'));
  });

  it('сохраняет окно операции при ошибке Supabase и показывает сообщение', async () => {
    fridge = [{ id: 'p1', name: 'бананы', amount: 1000, unit: 'г', updatedAt: null, expiresAt: null }];
    vi.mocked(api.wasteProduct).mockRejectedValueOnce(new Error('Supabase недоступен'));
    await openFridgePage();
    fireEvent.click(screen.getByRole('button', { name: 'бананы' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'бананы' })).getByRole('button', { name: 'Выбросить' }));
    const wasteDialog = await screen.findByRole('dialog', { name: 'Выбросить продукт' });
    expect((within(wasteDialog).getByLabelText('Количество, г') as HTMLInputElement).value).toBe('1000');
    fireEvent.click(within(wasteDialog).getByRole('button', { name: 'Выбросить' }));

    expect(await screen.findByText('Supabase недоступен')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Выбросить продукт' })).toBeTruthy();
  });

  it('блокирует фон модального окна и восстанавливает фокус после закрытия', async () => {
    await openFridgePage();
    const trigger = screen.getByRole('button', { name: 'яйца' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'яйца' });

    expect(document.body.style.position).toBe('fixed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'яйца' })).toBeNull());
    expect(document.body.style.position).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('на ПК открывает добавление только в Modal и закрывает без сохранения', async () => {
    await openFridgePage();
    expect(screen.queryByRole('heading', { name: 'Быстрое добавление' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'Добавить продукт' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Добавить продукт' });
    fireEvent.change(within(dialog).getByLabelText('Название продукта'), { target: { value: 'авокадо' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }));

    expect(api.addFridgeItem).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Добавить продукт' })).toBeNull();
  });

  it('переход с главной по add=1 автоматически открывает добавление', async () => {
    window.history.replaceState(null, '', '#/fridge?add=1');
    render(<App />);

    expect(await screen.findByRole('dialog', { name: 'Добавить продукт' })).toBeTruthy();
    expect(window.location.hash).not.toContain('add=1');
  });

  it('при ошибке добавления сохраняет поля и оставляет Modal открытым', async () => {
    vi.mocked(api.addFridgeItem).mockRejectedValueOnce(new Error('Ошибка добавления'));
    await openFridgePage();
    const submit = fillFridgeForm('авокадо', '2');
    fireEvent.click(submit);

    expect(await screen.findByText('Ошибка добавления')).toBeTruthy();
    const dialog = screen.getByRole('dialog', { name: 'Добавить продукт' });
    expect((within(dialog).getByLabelText('Название продукта') as HTMLInputElement).value).toBe('авокадо');
    expect((within(dialog).getByLabelText('Количество') as HTMLInputElement).value).toBe('2');
  });

  it('на телефоне открывает добавление в общем Modal', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '(min-width: 768px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })));
    await openFridgePage();
    expect(screen.queryByRole('heading', { name: 'Быстрое добавление' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить продукт' }));
    expect(await screen.findByRole('dialog', { name: 'Добавить продукт' })).toBeTruthy();
    expect(document.body.style.overflow).toBe('hidden');
  });
});

describe('Сроки годности', () => {
  it('передаёт общую стоимость ручной покупки', async () => {
    await openFridgePage();
    const submit = fillFridgeForm('бананы', '500');
    fireEvent.change(screen.getByLabelText(/Общая стоимость покупки, ₽/), { target: { value: '150,50' } });
    fireEvent.click(submit);
    await waitFor(() => expect(api.addFridgeItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.addFridgeItem).mock.calls[0][0].purchaseCost).toBe(150.5);
  });

  it('подставляет типовой срок при вводе названия и показывает бейдж', async () => {
    await openFridgePage();

    const submit = fillFridgeForm('творог', '500');

    // Срок подставился сам: творог хранится 7 дней.
    expect(expiryField().value).toBe(datePlusDays(7));

    fireEvent.click(submit);

    await waitFor(() => expect(api.addFridgeItem).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.addFridgeItem).mock.calls[0][0].expiresAt).toBe(datePlusDays(7));

    const nameNode = await screen.findByText('творог');
    const row = nameNode.closest('li');
    if (!row) throw new Error('Не найдена строка «творог»');
    expect(within(row).getByText(/через 7 дней/)).toBeTruthy();
  });

  it('подставляет срок «вечным» продуктам только вручную', async () => {
    await openFridgePage();

    fillFridgeForm('соль', '300');
    expect(expiryField().value).toBe('');
  });

  it('продукт с прошедшей датой показывает блок «Просрочено»', async () => {
    await openFridgePage();

    const submit = fillFridgeForm('кефир', '500', datePlusDays(-2));
    fireEvent.click(submit);

    // Дата в прошлом — переспрашиваем и сохраняем по подтверждению.
    const dialog = await screen.findByRole('dialog', { name: 'Дата уже прошла' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Да, сохранить' }));

    await waitFor(() => expect(api.addFridgeItem).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getAllByRole('link', { name: /Рецепты/ })[0]);

    expect(await screen.findByText('Просрочено')).toBeTruthy();
    expect(screen.getAllByText(/просрочено на 2 дн\./).length).toBeGreaterThan(0);
  });

  it('кнопка «Выбросить» убирает продукт из холодильника', async () => {
    fridge = [
      { id: 'p1', name: 'кефир', amount: 500, unit: 'мл', updatedAt: null, expiresAt: datePlusDays(-2) },
      { id: 'p2', name: 'яйца', amount: 10, unit: 'шт', updatedAt: null, expiresAt: null }
    ];

    render(<App />);
    await screen.findByText('Омлет с сыром');

    fireEvent.click(await screen.findByRole('button', { name: 'Выбросить «кефир»' }));

    await waitFor(() => expect(api.wasteProduct).toHaveBeenCalledWith('p1', 500));
    await waitFor(() => expect(screen.queryByText('кефир', { selector: 'span' })).toBeNull());

    // В холодильнике продукт тоже исчез.
    fireEvent.click(screen.getAllByRole('link', { name: /Продукты/ })[0]);
    await screen.findByRole('heading', { name: 'Мои продукты' });
    expect(fridgeRow('кефир')).toBeNull();
    expect(screen.getByText('яйца')).toBeTruthy();
  });

  it('позволяет выбросить только часть остатка', async () => {
    fridge = [
      { id: 'p1', name: 'бананы', amount: 1000, unit: 'г', updatedAt: null, expiresAt: null, totalCost: 200, pricedAmount: 1000 }
    ];
    await openFridgePage();
    fireEvent.click(screen.getByRole('button', { name: 'бананы' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'бананы' })).getByRole('button', { name: 'Выбросить' }));
    const dialog = await screen.findByRole('dialog', { name: 'Выбросить продукт' });
    fireEvent.change(within(dialog).getByLabelText(/Количество, г/), { target: { value: '300' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Выбросить' }));
    await waitFor(() => expect(api.wasteProduct).toHaveBeenCalledWith('p1', 300));
  });
});
