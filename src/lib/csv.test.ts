import { describe, expect, it } from 'vitest';
import {
  detectDelimiter,
  dishesCsvTemplate,
  fridgeCsvTemplate,
  parseAmount,
  parseDishesCSV,
  parseFridgeCSV,
  parseIngredients,
  parseUnit,
  toFridgeCSV
} from './csv';

/* ============================================================================
 * Проверки CSV-импорта блюд.
 * ========================================================================== */

describe('parseAmount / parseUnit', () => {
  it('понимает точку и запятую', () => {
    expect(parseAmount('1,5')).toBe(1.5);
    expect(parseAmount('1.5')).toBe(1.5);
    expect(parseAmount(' 200 ')).toBe(200);
    expect(Number.isNaN(parseAmount('три'))).toBe(true);
  });

  it('приводит латиницу к г/мл/шт, мусор отклоняет', () => {
    expect(parseUnit('g')).toBe('г');
    expect(parseUnit('мл.')).toBe('мл');
    expect(parseUnit('pcs')).toBe('шт');
    expect(parseUnit('kg')).toBe('');
    expect(parseUnit('ст.л.')).toBe('');
  });
});

describe('detectDelimiter', () => {
  it('определяет запятую, точку с запятой и табуляцию', () => {
    expect(detectDelimiter('title,section')).toBe(',');
    expect(detectDelimiter('title;section')).toBe(';');
    expect(detectDelimiter('title\tsection')).toBe('\t');
  });
});

describe('parseIngredients', () => {
  it('разбирает список через «;»', () => {
    const result = parseIngredients('яйца|3|шт;сыр|50|г');
    expect(result.errors).toHaveLength(0);
    expect(result.ingredients).toEqual([
      { name: 'яйца', amount: 3, unit: 'шт', sortOrder: 0 },
      { name: 'сыр', amount: 50, unit: 'г', sortOrder: 1 }
    ]);
  });

  it('сообщает о неверном формате, количестве и единице', () => {
    expect(parseIngredients('яйца|3').errors[0]).toMatch(/формат/);
    expect(parseIngredients('яйца|три|шт').errors[0]).toMatch(/количество/);
    expect(parseIngredients('масло|1|ст.л.').errors[0]).toMatch(/единица/);
    expect(parseIngredients('').errors[0]).toMatch(/ingredients/);
  });
});

describe('parseDishesCSV', () => {
  const csv = [
    'title,section,ingredients,time,steps,notes',
    'Омлет с сыром,breakfast,яйца|3|шт;сыр|50|г,15,"Взбить яйца;Обжарить под крышкой",Солить в конце',
    'Борщ,lunch,свёкла|300|г;мясо|500|г,90,"Варить бульон;Добавить свёклу",'
  ].join('\n');

  it('разбирает блюда без ошибок', () => {
    const result = parseDishesCSV(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.dataRows).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].dish.title).toBe('Омлет с сыром');
    expect(result.items[0].dish.sectionId).toBe('breakfast');
    expect(result.items[0].dish.timeMin).toBe(15);
    expect(result.items[0].dish.steps).toEqual(['Взбить яйца', 'Обжарить под крышкой']);
    expect(result.items[1].dish.notes).toBe('');
  });

  it('отклоняет раздел, которого нет в базе', () => {
    const result = parseDishesCSV('title,section,ingredients,time,steps,notes\nПолдник,snack,яблоко|1|шт,5,,');
    expect(result.items).toHaveLength(0);
    expect(result.errors[0].row).toBe(2);
    expect(result.errors[0].message).toMatch(/раздел «snack» неизвестен/);
  });

  it('принимает русские заголовки и «;» как разделитель', () => {
    const result = parseDishesCSV('название;раздел;ингредиенты;время;шаги\nСырники;завтрак;творог|400|г;25;Смешать и обжарить');
    expect(result.delimiter).toBe(';');
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].dish.sectionId).toBe('breakfast');
    expect(result.items[0].dish.steps).toEqual(['Смешать и обжарить']);
  });

  it('сообщает номер строки для каждой проблемы', () => {
    const broken = [
      'title,section,ingredients,time,steps,notes',
      ',breakfast,яйца|3|шт,10,,',
      'Тест,ночь,яйца|3|шт,10,,',
      'Тест2,lunch,яйца|три|шт,10,,',
      'Хорошее блюдо,dinner,яйца|3|шт,5,Пожарить,'
    ].join('\n');
    const result = parseDishesCSV(broken);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].dish.title).toBe('Хорошее блюдо');
    expect(result.errors.map((error) => error.row)).toEqual([2, 3, 4]);
  });

  it('понимает кавычки, запятые и точки с запятой внутри полей', () => {
    const result = parseDishesCSV(
      'title,section,ingredients,time,steps,notes\n"Омлет, с сыром",breakfast,яйца|3|шт,15,"Взбить;Обжарить","Соль, перец"'
    );
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].dish.title).toBe('Омлет, с сыром');
    expect(result.items[0].dish.notes).toBe('Соль, перец');
  });

  it('дробное количество с запятой в ингредиенте (поле в кавычках)', () => {
    const result = parseDishesCSV('title,section,ingredients,time,steps,notes\nКрем,dinner,"молоко|1,5|мл",5,,');
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].dish.ingredients[0].amount).toBe(1.5);
  });

  it('с разделителем «;» дробная запятая работает и без кавычек', () => {
    const result = parseDishesCSV('title;section;ingredients;time;steps;notes\nКрем;dinner;молоко|1,5|мл;5;;');
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].dish.ingredients[0].amount).toBe(1.5);
  });

  it('без колонки title сообщает об ошибке заголовков', () => {
    const result = parseDishesCSV('имя,раздел\nОмлет,breakfast');
    expect(result.items).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Не найдена колонка «title»/);
  });

  it('шаблон CSV читается этим же парсером', () => {
    const result = parseDishesCSV(dishesCsvTemplate());
    expect(result.errors).toHaveLength(0);
    expect(result.items).toHaveLength(2);
  });

  it('подсказывает, если в блок блюд вставили CSV холодильника', () => {
    const result = parseDishesCSV('name,amount,unit\nмука,1000,г');
    expect(result.items).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/CSV холодильника/);
  });
});

describe('parseFridgeCSV', () => {
  it('разбирает файл с заголовками', () => {
    const result = parseFridgeCSV('name,amount,unit\nмука,1000,г\nяйца,10,шт');
    expect(result.errors).toHaveLength(0);
    expect(result.hasHeader).toBe(true);
    expect(result.items.map((row) => row.item)).toEqual([
      { name: 'мука', amount: 1000, unit: 'г', expiresAt: null },
      { name: 'яйца', amount: 10, unit: 'шт', expiresAt: null }
    ]);
  });

  it('читает файл без строки заголовков', () => {
    const result = parseFridgeCSV('мука,1000,г\nмолоко,1.5,мл');
    expect(result.hasHeader).toBe(false);
    expect(result.errors).toHaveLength(0);
    expect(result.items).toHaveLength(2);
    expect(result.items[1].item.amount).toBe(1.5);
  });

  it('понимает русские заголовки, «;» и латиницу в единицах', () => {
    const result = parseFridgeCSV('название;количество;единица\nсыр;300;g\nсок;1;л');
    expect(result.delimiter).toBe(';');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item).toEqual({ name: 'сыр', amount: 300, unit: 'г', expiresAt: null });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(3);
    expect(result.errors[0].message).toMatch(/Единица измерения/);
  });

  it('сообщает номера строк для пустого количества, названия и нуля', () => {
    const result = parseFridgeCSV(['name,amount,unit', 'мука,,г', ',500,г', 'сахар,0,г', 'соль,200,г'].join('\n'));
    expect(result.items).toHaveLength(1);
    expect(result.items[0].item.name).toBe('соль');
    expect(result.errors.map((error) => error.row)).toEqual([2, 3, 4]);
  });

  it('требует все три колонки, если есть заголовки', () => {
    const result = parseFridgeCSV('name,amount\nмука,1000');
    expect(result.items).toHaveLength(0);
    expect(result.errors[0].message).toMatch(/Не найдены колонки: unit/);
  });

  it('пример файла холодильника разбирается без ошибок', () => {
    const result = parseFridgeCSV(fridgeCsvTemplate());
    expect(result.errors).toHaveLength(0);
    expect(result.items).toHaveLength(4);
  });

  it('экспорт и повторный разбор не теряют данные', () => {
    const csv = toFridgeCSV([
      { name: 'мука, пшеничная', amount: 1000, unit: 'г' },
      { name: 'яйца', amount: 10, unit: 'шт' }
    ]);
    const result = parseFridgeCSV(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.items[0].item.name).toBe('мука, пшеничная');
    expect(result.items[1].item.amount).toBe(10);
  });
});
