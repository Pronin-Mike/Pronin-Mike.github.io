import { describe, expect, it } from 'vitest';
import { PYATEROCHKA_COLUMN_OCR, SYNTHETIC_RECEIPTS } from './receiptFixtures';
import { calculateFridgeAmount, matchReceiptItem, normalizeReceiptProduct } from './receiptMatcher';
import { cleanReceiptProductName, detectReceiptStore, extractPackage, parseReceipt, receiptKey, receiptNameKey } from './receiptParser';

describe('парсер синтетических чеков', () => {
  it('определяет магазины расширяемыми правилами', () => {
    expect(detectReceiptStore(SYNTHETIC_RECEIPTS.pyaterochka)).toBe('Пятёрочка');
    expect(detectReceiptStore(SYNTHETIC_RECEIPTS.perekrestok)).toBe('Перекрёсток');
    expect(detectReceiptStore(SYNTHETIC_RECEIPTS.v1)).toBe('В1');
    expect(detectReceiptStore(SYNTHETIC_RECEIPTS.da)).toBe('ДА!');
  });

  it('извлекает позиции, цены и фискальный ключ, исключая служебные строки', () => {
    const parsed = parseReceipt(SYNTHETIC_RECEIPTS.pyaterochka);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.map((item) => item.rawName)).toEqual([
      'МОЛ ПРОСТОКВ 3.2 930МЛ',
      'ЯЙЦО КУР С1 10ШТ'
    ]);
    expect(parsed.items[0].quantity).toBe(1);
    expect(parsed.items[0].totalPrice).toBe(89.9);
    expect(parsed.totalAmount).toBe(219.8);
    expect(receiptKey(parsed)).toBe('9280440300123456:4455:778899');
  });

  it('склеивает многострочное название с расчётной строкой', () => {
    const parsed = parseReceipt(SYNTHETIC_RECEIPTS.perekrestok);
    expect(parsed.items[0].rawName).toBe('КАРТОФЕЛЬ ВЕС');
    expect(parsed.items[0].quantity).toBe(1.24);
    expect(calculateFridgeAmount(parsed.items[0])).toEqual({ amount: 1240, unit: 'г' });
  });

  it('распознаёт упаковки и переводит кг/л в базовые единицы', () => {
    expect(extractPackage('СЫР РОССИЙСКИЙ 200Г')).toEqual({ amount: 200, unit: 'г' });
    expect(extractPackage('МОЛОКО 0,93 Л')).toEqual({ amount: 930, unit: 'мл' });
    expect(extractPackage('ЯЙЦО 10ШТ')).toEqual({ amount: 10, unit: 'шт' });
  });

  it('рассчитывает несколько упаковок', () => {
    expect(calculateFridgeAmount({
      lineNumber: 1,
      rawName: 'СЫР 200Г',
      rawText: 'СЫР 200Г 2 x 100,00 200,00',
      quantity: 2,
      receiptUnit: 'шт',
      packageAmount: 200,
      packageUnit: 'г',
      unitPrice: 100,
      totalPrice: 200,
      confidence: 'high'
    })).toEqual({ amount: 400, unit: 'г' });
  });

  it('не превращает произвольную строку с числом в товар', () => {
    const parsed = parseReceipt('КАССА 12\nИНН 1234567890\nИТОГО 500,00');
    expect(parsed.items).toEqual([]);
    expect(parsed.warnings.length).toBeGreaterThan(0);
  });

  it('не выдумывает количество при повреждённом OCR', () => {
    const parsed = parseReceipt('НЕИЗВЕСТНЫЙ ПРОДУКТ 12O,ОО');
    expect(parsed.items).toEqual([]);
  });

  it('разбирает колоночный чек Пятёрочки и OCR-варианты единиц', () => {
    const parsed = parseReceipt(PYATEROCHKA_COLUMN_OCR);
    expect(parsed.items).toHaveLength(6);

    const matched = parsed.items.map((item) => matchReceiptItem(item, [], []));
    expect(matched[0]).toMatchObject({
      normalizedName: 'KOP.KoH.AC.M/T шок.др. л/ор.',
      fridgeAmount: 190,
      fridgeUnit: 'г',
      needsReview: true
    });
    expect(matched[1]).toMatchObject({
      normalizedName: 'M&Ms Драже с арахисом',
      fridgeAmount: 130,
      fridgeUnit: 'г'
    });
    expect(matched[3]).toMatchObject({ fridgeAmount: 722, fridgeUnit: 'г' });
    expect(matched[4]).toMatchObject({ fridgeAmount: 285, fridgeUnit: 'г' });
    expect(matched[5]).toMatchObject({ normalizedName: 'Томаты сливовидные красные', fridgeAmount: null, fridgeUnit: null });
  });

  it('оставляет в названии только продукт, без артикула, фасовки и цен', () => {
    expect(cleanReceiptProductName('3350632 KOP.KoH.AC.M/T шок.др. л/ор. 190г ,299.00 14.95'))
      .toBe('KOP.KoH.AC.M/T шок.др. л/ор.');
    expect(cleanReceiptProductName('3386336 M8Ms Драже с арахисом 130r 00 4.95'))
      .toBe('M&Ms Драже с арахисом');
    expect(cleanReceiptProductName('3191300 ТЕНД.Филе кур.охл.подл. кг'))
      .toBe('ТЕНД.Филе кур.охл.подл.');
  });
});

describe('нормализация и сопоставление', () => {
  it('осторожно нормализует известные категории', () => {
    expect(normalizeReceiptProduct('МОЛ ПРОСТОКВ 3.2 930МЛ')).toBe('Молоко');
    expect(normalizeReceiptProduct('ЯЙЦО КУР С1 10ШТ')).toBe('Яйца');
    expect(normalizeReceiptProduct('СЫР РОССИЙСКИЙ 200Г')).toBe('Сыр');
    expect(normalizeReceiptProduct('НАПИТОК ОВСЯНЫЙ')).toBeNull();
  });

  it('сначала применяет точный пользовательский алиас', () => {
    const parsed = parseReceipt('БРЕНДОВЫЙ ПРОДУКТ 2 x 50,00 100,00').items[0];
    const matched = matchReceiptItem(parsed, [{
      id: 'a1', store: null, rawNameKey: receiptNameKey(parsed.rawName),
      productName: 'Творог', packageAmount: 180, packageUnit: 'г'
    }], []);
    expect(matched.matchStatus).toBe('alias');
    expect(matched.normalizedName).toBe('Творог');
    expect(matched.fridgeAmount).toBe(360);
  });

  it('предлагает очевидный непродовольственный товар исключённым', () => {
    const parsed = parseReceipt('ПАКЕТ МАЙКА 1 x 9,99 9,99').items[0];
    expect(matchReceiptItem(parsed, [], []).includeInFridge).toBe(false);
  });
});
