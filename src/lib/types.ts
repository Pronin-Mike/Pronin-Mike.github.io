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
  /** Дата «годен до» в формате YYYY-MM-DD; null — срок не отслеживается. */
  expiresAt: string | null;
  /** Общая цена позиции в последнем импортированном чеке. */
  lastPurchasePrice?: number | null;
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
  /** Если не задано — api подставит срок по названию (см. lib/shelfLife.ts). */
  expiresAt?: string | null;
  /** Для ручного ввода необязательно; при импорте чека заполняется автоматически. */
  lastPurchasePrice?: number | null;
}

/* -------------------------------------------------------------------------- *
 * Кассовые чеки
 * -------------------------------------------------------------------------- */

export type ReceiptSource = 'camera' | 'upload' | 'pdf' | 'text';
export type ReceiptStatus = 'draft' | 'imported';
export type ReceiptMatchStatus = 'alias' | 'fridge' | 'normalized' | 'manual' | 'unmatched';

export interface Receipt {
  id: string;
  store: string | null;
  source: ReceiptSource;
  purchasedAt: string | null;
  totalAmount: number | null;
  fiscalFn: string | null;
  fiscalFd: string | null;
  fiscalFp: string | null;
  receiptKey: string | null;
  status: ReceiptStatus;
  importedAt: string | null;
  createdAt: string;
  itemCount?: number;
}

export interface ReceiptItem {
  id?: string;
  lineNumber: number;
  rawName: string;
  normalizedName: string;
  receiptQuantity: number | null;
  receiptUnit: string | null;
  fridgeAmount: number | null;
  fridgeUnit: Unit | null;
  unitPrice: number | null;
  totalPrice: number | null;
  includeInFridge: boolean;
  matchStatus: ReceiptMatchStatus;
  needsReview: boolean;
}

export interface ProductAlias {
  id: string;
  store: string | null;
  rawNameKey: string;
  productName: string;
  packageAmount: number | null;
  packageUnit: Unit | null;
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
  /** Названия просроченных ингредиентов, которые всё же были списаны. */
  expiredWarning?: string[];
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
  expires_at: string | null;
  last_purchase_price: number | null;
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

export type ReceiptRow = {
  id: string;
  user_id: string;
  store: string | null;
  source: string;
  purchased_at: string | null;
  total_amount: number | null;
  fiscal_fn: string | null;
  fiscal_fd: string | null;
  fiscal_fp: string | null;
  receipt_key: string | null;
  status: string;
  imported_at: string | null;
  created_at: string;
};

export type ReceiptItemRow = {
  id: string;
  receipt_id: string;
  line_number: number;
  raw_name: string;
  normalized_name: string;
  receipt_quantity: number | null;
  receipt_unit: string | null;
  fridge_amount: number | null;
  fridge_unit: string | null;
  unit_price: number | null;
  total_price: number | null;
  include_in_fridge: boolean;
  match_status: string;
  created_at: string;
};

export type ProductAliasRow = {
  id: string;
  user_id: string;
  store: string | null;
  raw_name_key: string;
  product_name: string;
  package_amount: number | null;
  package_unit: string | null;
  created_at: string;
  updated_at: string;
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
  expires_at?: string | null;
  last_purchase_price?: number | null;
};

export type FridgeItemUpdate = {
  name?: string;
  amount?: number;
  unit?: string;
  updated_at?: string | null;
  expires_at?: string | null;
  last_purchase_price?: number | null;
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
      receipts: TableDefinition<ReceiptRow, Partial<ReceiptRow> & Pick<ReceiptRow, 'user_id' | 'source' | 'status'>, Partial<ReceiptRow>>;
      receipt_items: TableDefinition<ReceiptItemRow, Omit<ReceiptItemRow, 'id' | 'created_at'>, Partial<ReceiptItemRow>>;
      product_aliases: TableDefinition<ProductAliasRow, Omit<ProductAliasRow, 'id' | 'created_at' | 'updated_at'>, Partial<ProductAliasRow>>;
    };
    Views: {
      dishes_full: ViewDefinition<DishFullRow>;
    };
    Functions: {
      cook_dish: {
        Args: { p_dish_id: string };
        Returns: unknown;
      };
      import_receipt: {
        Args: { p_receipt_id: string; p_items: unknown; p_aliases: unknown };
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
