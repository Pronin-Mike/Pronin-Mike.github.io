import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { indexFridge } from '../lib/availability';
import type { CookResult, Dish, FridgeItem, Section } from '../lib/types';

/* ============================================================================
 * useCookbook.ts — загрузка данных страницы: разделы, блюда, холодильник.
 * После готовки холодильник перечитывается, чтобы карточки стали серыми.
 * ========================================================================== */

export interface CookbookData {
  sections: Section[];
  dishes: Dish[];
  fridge: FridgeItem[];
  fridgeIndex: Map<string, FridgeItem>;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  reloadFridge: () => Promise<void>;
  /** Вызывает RPC cook_dish и обновляет холодильник; ошибки бросает наружу. */
  cook: (dishId: string) => Promise<CookResult>;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function useCookbook(): CookbookData {
  const [sections, setSections] = useState<Section[]>([]);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [fridge, setFridge] = useState<FridgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSections, nextDishes, nextFridge] = await Promise.all([
        api.fetchSections(),
        api.fetchDishes(),
        api.fetchFridge()
      ]);
      setSections(nextSections);
      setDishes(nextDishes);
      setFridge(nextFridge);
    } catch (caught) {
      setError(toMessage(caught, 'Не удалось загрузить данные'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const reloadFridge = useCallback(async () => {
    try {
      setFridge(await api.fetchFridge());
    } catch (caught) {
      setError(toMessage(caught, 'Не удалось обновить холодильник'));
    }
  }, []);

  const cook = useCallback(
    async (dishId: string) => {
      const result = await api.cookDish(dishId);
      if (result.success) await reloadFridge();
      return result;
    },
    [reloadFridge]
  );

  const fridgeIndex = useMemo(() => indexFridge(fridge), [fridge]);

  return {
    sections,
    dishes,
    fridge,
    fridgeIndex,
    loading,
    error,
    reload,
    reloadFridge,
    cook
  };
}
