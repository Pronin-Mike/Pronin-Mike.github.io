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

beforeEach(() => {
  // HashRouter читает window.location, а он живёт между тестами одного файла
  window.history.replaceState(null, '', '#/');

  fridge = [
    { id: 'p1', name: 'яйца', amount: 10, unit: 'шт', updatedAt: null },
    { id: 'p2', name: 'сыр', amount: 300, unit: 'г', updatedAt: null }
  ];

  setSession({ user: { email: 'cook@example.com' } });
  vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } }
  } as unknown as ReturnType<typeof supabase.auth.onAuthStateChange>);

  vi.mocked(api.fetchSections).mockImplementation(async () => SECTIONS);
  vi.mocked(api.fetchDishes).mockImplementation(async () => [OMELETTE, BORSCH]);
  vi.mocked(api.fetchFridge).mockImplementation(async () => fridge);
  vi.mocked(api.cookDish).mockResolvedValue({ success: true, missing: [] });
  vi.mocked(api.applyFridgeImport).mockImplementation(async (plan) => plan.counts);
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
      fridge = [{ id: 'p2', name: 'сыр', amount: 250, unit: 'г', updatedAt: null }];
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
    expect(screen.getByText('300 г')).toBeTruthy();
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
    expect(plan.inserts).toEqual([{ name: 'мука', amount: 2000, unit: 'г' }]);
    expect(plan.updates).toEqual([{ id: 'p1', patch: { name: 'яйца', amount: 12, unit: 'шт' } }]);
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
    expect(plan.updates).toEqual([{ id: 'p1', patch: { name: 'яйца', amount: 22, unit: 'шт' } }]);
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
    expect(plan.inserts).toEqual([{ name: 'творог', amount: 400, unit: 'г' }]);
    expect(plan.counts).toEqual({ added: 1, updated: 0, summed: 0, skipped: 0 });
  });
});
