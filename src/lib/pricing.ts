import { fridgeKey } from './availability';
import type { Dish, DishIngredient, FridgeItem } from './types';

const EPS = 1e-9;

export interface CostedStock {
  amount: number;
  totalCost: number;
  pricedAmount: number;
}

export type CostStatus = 'exact' | 'partial' | 'unknown' | 'unavailable';

export interface CostEstimate {
  knownCost: number;
  status: CostStatus;
}

export interface ConsumptionResult {
  remaining: CostedStock;
  consumedCost: number;
  consumedPricedAmount: number;
  costComplete: boolean;
}

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function validStock(stock: CostedStock): boolean {
  return Number.isFinite(stock.amount)
    && Number.isFinite(stock.totalCost)
    && Number.isFinite(stock.pricedAmount)
    && stock.amount >= 0
    && stock.totalCost >= 0
    && stock.pricedAmount >= 0
    && stock.pricedAmount <= stock.amount + EPS
    && (stock.pricedAmount > EPS || stock.totalCost <= EPS);
}

export function addPurchase(stock: CostedStock, amount: number, cost: number | null): CostedStock {
  if (!validStock(stock) || !Number.isFinite(amount) || amount <= 0 || (cost !== null && (!Number.isFinite(cost) || cost < 0))) {
    throw new Error('Некорректные данные стоимости продукта');
  }
  return {
    amount: stock.amount + amount,
    totalCost: roundMoney(stock.totalCost + (cost ?? 0)),
    pricedAmount: stock.pricedAmount + (cost === null ? 0 : amount)
  };
}

export function consumeStock(stock: CostedStock, amount: number): ConsumptionResult {
  if (!validStock(stock) || !Number.isFinite(amount) || amount <= 0 || amount > stock.amount + EPS) {
    throw new Error('Некорректное количество для списания');
  }
  const full = Math.abs(amount - stock.amount) <= EPS;
  const share = full ? 1 : amount / stock.amount;
  const consumedCost = full ? stock.totalCost : roundMoney(stock.totalCost * share);
  const consumedPricedAmount = full ? stock.pricedAmount : stock.pricedAmount * share;
  return {
    consumedCost,
    consumedPricedAmount,
    costComplete: stock.pricedAmount + EPS >= stock.amount,
    remaining: {
      amount: full ? 0 : stock.amount - amount,
      totalCost: full ? 0 : roundMoney(Math.max(0, stock.totalCost - consumedCost)),
      pricedAmount: full ? 0 : Math.max(0, stock.pricedAmount - consumedPricedAmount)
    }
  };
}

/** Ручная корректировка без цены: уменьшение пропорционально, увеличение неизвестно. */
export function adjustStock(stock: CostedStock, amount: number, totalCost: number | null = null): CostedStock {
  if (!validStock(stock) || !Number.isFinite(amount) || amount <= 0 || (totalCost !== null && (!Number.isFinite(totalCost) || totalCost < 0))) {
    throw new Error('Некорректная корректировка продукта');
  }
  if (totalCost !== null) return { amount, totalCost: roundMoney(totalCost), pricedAmount: amount };
  if (amount < stock.amount) return consumeStock(stock, stock.amount - amount).remaining;
  return { amount, totalCost: stock.totalCost, pricedAmount: Math.min(stock.pricedAmount, amount) };
}

export function ingredientCost(
  ingredient: DishIngredient,
  fridge: Map<string, FridgeItem>
): CostEstimate {
  const product = fridge.get(fridgeKey(ingredient.name, ingredient.unit));
  if (!product || product.amount + EPS < ingredient.amount || product.amount <= 0) {
    return { knownCost: 0, status: 'unavailable' };
  }
  const pricedAmount = product.pricedAmount ?? 0;
  const totalCost = product.totalCost ?? 0;
  if (pricedAmount <= EPS) return { knownCost: 0, status: 'unknown' };
  return {
    knownCost: roundMoney(totalCost * ingredient.amount / product.amount),
    status: pricedAmount + EPS >= product.amount ? 'exact' : 'partial'
  };
}

export function dishCost(dish: Dish, fridge: Map<string, FridgeItem>): CostEstimate {
  if (!dish.ingredients.length) return { knownCost: 0, status: 'unavailable' };
  const parts = dish.ingredients.map((ingredient) => ingredientCost(ingredient, fridge));
  const knownCost = roundMoney(parts.reduce((sum, part) => sum + part.knownCost, 0));
  if (parts.every((part) => part.status === 'exact')) return { knownCost, status: 'exact' };
  if (parts.some((part) => part.status === 'unavailable')) return { knownCost, status: 'unavailable' };
  if (parts.some((part) => part.status === 'partial') || knownCost > 0) return { knownCost, status: 'partial' };
  return { knownCost: 0, status: 'unknown' };
}

export function formatMoney(value: number): string {
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;
}

export function formatCost(estimate: CostEstimate): string {
  if (estimate.status === 'exact') return formatMoney(estimate.knownCost);
  if (estimate.knownCost > 0) return `~${formatMoney(estimate.knownCost)}`;
  return 'Н/Д';
}

export function formatStockUnitCost(item: FridgeItem): string {
  const pricedAmount = item.pricedAmount ?? 0;
  const totalCost = item.totalCost ?? 0;
  if (pricedAmount <= EPS) return 'Н/Д';
  const multiplier = item.unit === 'шт' ? 1 : 1000;
  const suffix = item.unit === 'г' ? 'кг' : item.unit === 'мл' ? 'л' : 'шт';
  const prefix = pricedAmount + EPS >= item.amount ? '' : '~';
  return `${prefix}${formatMoney(totalCost / pricedAmount * multiplier)}/${suffix}`;
}
