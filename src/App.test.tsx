// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/* ============================================================================
 * Интеграционная проверка интерфейса: настоящий DOM (jsdom),
 * Supabase и api.ts заменены моками.
 * ========================================================================== */

vi.mock('./lib/supabase', () => ({
  isSupabaseConfigured: true,
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
  deleteFridgeItem: vi.fn(),
  clearFridge: vi.fn(),
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
  fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: name } });
  fireEvent.change(screen.getByLabelText(/^Количество/), { target: { value: amount } });
  if (expiresAt !== undefined) {
    fireEvent.change(screen.getByLabelText(/^Срок годности/), { target: { value: expiresAt } });
  }
  return screen.getByRole('button', { name: 'Добавить' }) as HTMLButtonElement;
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
  fireEvent.click(screen.getAllByRole('link', { name: /Холодильник/ })[0]);
  await screen.findByRole('heading', { name: 'Холодильник' });
}

beforeEach(() => {
  // HashRouter читает window.location, а он живёт между тестами одного файла
  window.history.replaceState(null, '', '#/');

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
    return {
      id,
      name: patch.name ?? existing?.name ?? '',
      amount: patch.amount ?? existing?.amount ?? 0,
      unit: patch.unit ?? existing?.unit ?? 'г',
      updatedAt: null,
      expiresAt: patch.expiresAt ?? existing?.expiresAt ?? null
    };
  });
  vi.mocked(api.deleteFridgeItem).mockImplementation(async (id) => {
    // Меняем массив на месте: мок fetchFridge замыкается на эту же переменную.
    const rest = fridge.filter((item) => item.id !== id);
    fridge.length = 0;
    fridge.push(...rest);
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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

    fireEvent.click(screen.getAllByRole('link', { name: /Холодильник/ })[0]);

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

describe('Сроки годности', () => {
  it('подставляет типовой срок при вводе названия и показывает бейдж', async () => {
    await openFridgePage();

    fillFridgeForm('творог', '500');

    // Срок подставился сам: творог хранится 7 дней.
    expect(expiryField().value).toBe(datePlusDays(7));

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

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

    fillFridgeForm('кефир', '500', datePlusDays(-2));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));

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

    await waitFor(() => expect(api.deleteFridgeItem).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(screen.queryByText('кефир', { selector: 'span' })).toBeNull());

    // В холодильнике продукт тоже исчез.
    fireEvent.click(screen.getAllByRole('link', { name: /Холодильник/ })[0]);
    await screen.findByRole('heading', { name: 'Холодильник' });
    expect(fridgeRow('кефир')).toBeNull();
    expect(screen.getByText('яйца')).toBeTruthy();
  });
});
