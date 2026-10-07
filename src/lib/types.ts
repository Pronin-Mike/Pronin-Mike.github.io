/* ============================================================================
 * types.ts — типы предметной области и типы схемы Supabase.
 *
 * Схема БД уже создана в Supabase и здесь только описывается:
 *   sections, fridge_items, dishes, dish_ingredients, cook_log,
 *   view dishes_full, функция cook_dish(uuid).
 * ========================================================================== */

/* -------------------------------------------------------------------------- *
 * Единицы измерения (CHECK unit in ('г','мл','шт'))
 * -------------------------------------------------------------------------- */

export const UNITS = ['г', 'мл', 'шт'] as const;

export type Unit = (typeof UNITS)[number];

export function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && (UNITS as readonly string[]).includes(value);
}

/* -------------------------------------------------------------------------- *
 * Доменные типы (то, с чем работают компоненты)
 * -------------------------------------------------------------------------- */

export interface Section {
  id: string;
  title: string;
  sortOrder: number;
}

export interface DishIngredient {
  name: string;
  amount: number;
  unit: Unit;
  sortOrder: number;
}

export interface Dish {
  id: string;
  title: string;
  sectionId: string;
  timeMin: number | null;
  steps: string[];
  notes: string;
  ingredients: DishIngredient[];
}

export interface FridgeItem {
  id: string;
  name: string;
  amount: number;
  unit: Unit;
  updatedAt: string | null;
}

/** Данные формы блюда (создание и редактирование). */
export interface DishInput {
  title: string;
  sectionId: string;
  timeMin: number | null;
  steps: string[];
  notes: string;
  ingredients: DishIngredient[];
}

export interface FridgeInput {
  name: string;
  amount: number;
  unit: Unit;
}

/* -------------------------------------------------------------------------- *
 * Доступность блюда
 * -------------------------------------------------------------------------- */

export interface MissingIngredient {
  name: string;
  need: number;
  have: number;
  unit: Unit;
  /** 'absent' — продукта нет, 'unit' — другая единица, 'short' — мало. */
  reason: 'absent' | 'unit' | 'short';
  /** Единица, которая есть в холодильнике (для reason === 'unit'). */
  actualUnit?: Unit;
}

export interface Availability {
  available: boolean;
  missing: MissingIngredient[];
  missingText: string;
  ready: number;
  total: number;
}

/* -------------------------------------------------------------------------- *
 * Ответы RPC
 * -------------------------------------------------------------------------- */

export interface CookResult {
  success: boolean;
  missing: MissingIngredient[];
}

/* -------------------------------------------------------------------------- *
 * Строки таблиц (как они лежат в PostgreSQL)
 *
 * Важно: это `type`-алиасы, а не `interface`. Только объектные типы-алиасы
 * получают неявную индексную сигнатуру, без которой схема не проходит
 * проверку GenericSchema в @supabase/postgrest-js.
 * -------------------------------------------------------------------------- */

export type SectionRow = {
  id: string;
  title_ru: string;
  sort_order: number;
};

export type FridgeItemRow = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  updated_at: string | null;
};

export type DishRow = {
  id: string;
  title: string;
  section_id: string;
  time_min: number | null;
  steps: string[];
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type DishIngredientRow = {
  id: string;
  dish_id: string;
  name: string;
  amount: number;
  unit: string;
  sort_order: number;
};

export type CookLogRow = {
  id: string;
  dish_id: string | null;
  cooked_at: string | null;
};

/** Строка view dishes_full: ингредиенты приходят jsonb-агрегатом. */
export type DishFullRow = {
  id: string;
  title: string;
  section_id: string;
  time_min: number | null;
  steps: string[] | null;
  notes: string | null;
  ingredients: unknown;
};

/* -------------------------------------------------------------------------- *
 * Payload'ы вставки/обновления
 * -------------------------------------------------------------------------- */

export type FridgeItemInsert = {
  id?: string;
  name: string;
  amount: number;
  unit: string;
  updated_at?: string | null;
};

export type FridgeItemUpdate = {
  name?: string;
  amount?: number;
  unit?: string;
  updated_at?: string | null;
};

export type DishInsert = {
  id?: string;
  title: string;
  section_id: string;
  time_min?: number | null;
  steps?: string[];
  notes?: string | null;
};

export type DishUpdate = {
  title?: string;
  section_id?: string;
  time_min?: number | null;
  steps?: string[];
  notes?: string | null;
};

export type DishIngredientInsert = {
  id?: string;
  dish_id: string;
  name: string;
  amount: number;
  unit: string;
  sort_order?: number;
};

/* -------------------------------------------------------------------------- *
 * Файл бэкапа (экспорт/импорт JSON)
 * -------------------------------------------------------------------------- */

export type BackupFile = {
  app: 'home-cookbook';
  version: number;
  exportedAt: string;
  fridge_items: FridgeItemRow[];
  dishes: DishRow[];
  dish_ingredients: DishIngredientRow[];
};

/* -------------------------------------------------------------------------- *
 * Тип схемы для типизированного клиента Supabase
 * -------------------------------------------------------------------------- */

type TableDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type ViewDefinition<Row> = {
  Row: Row;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      sections: TableDefinition<SectionRow, SectionRow, Partial<SectionRow>>;
      fridge_items: TableDefinition<FridgeItemRow, FridgeItemInsert, FridgeItemUpdate>;
      dishes: TableDefinition<DishRow, DishInsert, DishUpdate>;
      dish_ingredients: TableDefinition<DishIngredientRow, DishIngredientInsert, Partial<DishIngredientInsert>>;
      cook_log: TableDefinition<
        CookLogRow,
        { id?: string; dish_id?: string | null; cooked_at?: string | null },
        { dish_id?: string | null; cooked_at?: string | null }
      >;
    };
    Views: {
      dishes_full: ViewDefinition<DishFullRow>;
    };
    Functions: {
      cook_dish: {
        Args: { p_dish_id: string };
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
