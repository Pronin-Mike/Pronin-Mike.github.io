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
  exportBackup: vi.fn(),
  importBackup: vi.fn(),
  importDishes: vi.fn()
}));

import App from './App';
import * as api from './lib/api';
import { supabase } from './lib/supabase';
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

beforeEach(() => {
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
      missing: [
        { name: 'сыр', need: 50, have: 0, unit: 'г', reason: 'absent' }
      ]
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

    const fridgeLink = screen.getAllByRole('link', { name: /Холодильник/ })[0];
    fireEvent.click(fridgeLink);

    expect(await screen.findByText('сыр')).toBeTruthy();
    expect(screen.getByText('яйца')).toBeTruthy();
    expect(screen.getByText('300 г')).toBeTruthy();
  });
});
