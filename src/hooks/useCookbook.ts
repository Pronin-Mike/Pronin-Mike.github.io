import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../lib/api';
import { indexFridge } from '../lib/availability';
import { getExpiryStatus } from '../lib/shelfLife';
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
  /** Продукты со статусом 'soon' или 'today', сначала самые срочные. */
  expiring: FridgeItem[];
  /** Просроченные продукты, сначала самые старые. */
  expired: FridgeItem[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  reloadFridge: () => Promise<void>;
  /** Вызывает RPC cook_dish и обновляет холодильник; ошибки бросает наружу. */
  cook: (dishId: string, operationId: string) => Promise<CookResult>;
}

function toMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Сортировка по сроку: без даты — в конец, внутри — по дате, потом по названию. */
function byExpiry(a: FridgeItem, b: FridgeItem): number {
  if (a.expiresAt === b.expiresAt) return a.name.localeCompare(b.name, 'ru');
  if (!a.expiresAt) return 1;
  if (!b.expiresAt) return -1;
  return a.expiresAt.localeCompare(b.expiresAt);
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

  const fridgeIndexed = useMemo(() => indexFridge(fridge), [fridge]);

  const cook = useCallback(
    async (dishId: string, operationId: string) => {
      const result = await api.cookDish(dishId, operationId);
      if (result.success) await reloadFridge();
      return result;
    },
    [reloadFridge]
  );

  const expiring = useMemo(
    () =>
      fridge
        .filter((item) => {
          const status = getExpiryStatus(item.expiresAt);
          return status === 'soon' || status === 'today';
        })
        .sort(byExpiry),
    [fridge]
  );

  const expired = useMemo(
    () => fridge.filter((item) => getExpiryStatus(item.expiresAt) === 'expired').sort(byExpiry),
    [fridge]
  );

  return {
    sections,
    dishes,
    fridge,
    fridgeIndex: fridgeIndexed,
    expiring,
    expired,
    loading,
    error,
    reload,
    reloadFridge,
    cook
  };
}
