// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastProvider } from '../components/Toast';
import ReceiptScan from './ReceiptScan';
import * as api from '../lib/api';
import * as ocr from '../lib/receiptOcr';
import { PYATEROCHKA_COLUMN_OCR } from '../lib/receiptFixtures';

vi.mock('../lib/api', () => ({
  fetchFridge: vi.fn(),
  fetchProductAliases: vi.fn(),
  fetchReceipts: vi.fn(),
  fetchReceiptItems: vi.fn(),
  createReceiptDraft: vi.fn(),
  importReceipt: vi.fn(),
  deleteReceipt: vi.fn()
}));

vi.mock('../lib/receiptOcr', () => ({
  recognizeImage: vi.fn(),
  extractPdfText: vi.fn(),
  recognizePdfPages: vi.fn()
}));

const TEXT = 'ПЯТЁРОЧКА\nМОЛ ПРОСТОКВ 3.2 930МЛ 1 x 89,90 89,90\nИТОГО 89,90';

function renderPage() {
  return render(<ToastProvider><ReceiptScan /></ToastProvider>);
}

async function parseText() {
  fireEvent.change(screen.getByLabelText('…или вставьте текст электронного чека'), { target: { value: TEXT } });
  fireEvent.click(screen.getByRole('button', { name: 'Разобрать текст' }));
  await screen.findByDisplayValue('Молоко');
}

beforeEach(() => {
  vi.mocked(api.fetchFridge).mockResolvedValue([]);
  vi.mocked(api.fetchProductAliases).mockResolvedValue([]);
  vi.mocked(api.fetchReceipts).mockResolvedValue([]);
  vi.mocked(api.fetchReceiptItems).mockResolvedValue([]);
  vi.mocked(api.createReceiptDraft).mockResolvedValue({
    id: 'r1', store: 'Пятёрочка', source: 'text', purchasedAt: null, totalAmount: 89.9,
    fiscalFn: null, fiscalFd: null, fiscalFp: null, receiptKey: null, status: 'draft',
    importedAt: null, createdAt: '2026-10-19T00:00:00Z'
  });
  vi.mocked(api.importReceipt).mockResolvedValue();
  vi.mocked(api.deleteReceipt).mockResolvedValue();
  vi.mocked(ocr.recognizeImage).mockResolvedValue(TEXT);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('экран сканирования чека', () => {
  it('загружает изображение и показывает распознанный товар', async () => {
    const { container } = renderPage();
    const input = container.querySelector('input[type="file"][accept*="webp"]');
    if (!input) throw new Error('Не найден выбор файла');
    const file = new File(['image'], 'receipt.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(await screen.findByDisplayValue('Молоко')).toBeTruthy();
    expect(ocr.recognizeImage).toHaveBeenCalledWith(file, expect.any(Function));
  });

  it('позволяет отредактировать распознанный товар', async () => {
    renderPage();
    await parseText();
    const name = screen.getByLabelText('Продукт') as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Молоко пастеризованное' } });
    expect(name.value).toBe('Молоко пастеризованное');
  });

  it('показывает очищенное название и количество из колонок Пятёрочки', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('…или вставьте текст электронного чека'), {
      target: { value: PYATEROCHKA_COLUMN_OCR }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Разобрать текст' }));

    const names = await screen.findAllByLabelText('Продукт') as HTMLInputElement[];
    const amounts = screen.getAllByLabelText('Количество') as HTMLInputElement[];
    const units = screen.getAllByLabelText('Единица') as HTMLSelectElement[];
    expect(names[0].value).toBe('Конфеты');
    expect(amounts[0].value).toBe('190');
    expect(units[0].value).toBe('г');
    expect(names[1].value).toBe('Драже');
    expect(names[3].value).toBe('Филе куриное');
    expect(names[4].value).toBe('Филе куриное');
    expect(names[5].value).toBe('Помидоры');
    expect(amounts[3].value).toBe('722');
    expect(units[3].value).toBe('г');
  });

  it('исключает позицию и блокирует пустой импорт', async () => {
    renderPage();
    await parseText();
    fireEvent.click(screen.getByRole('checkbox'));
    expect((screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('подтверждает импорт только через RPC API', async () => {
    renderPage();
    await parseText();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }));
    await waitFor(() => expect(api.createReceiptDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.importReceipt).toHaveBeenCalledWith('r1', expect.any(Array), 'Пятёрочка', 'sum'));
    expect(await screen.findByText(/Чек импортирован/)).toBeTruthy();
  });

  it.each([
    ['Заменить', 'replace'],
    ['Оставить как есть', 'keep'],
    ['Сложить', 'sum']
  ] as const)('для совпадающего продукта позволяет выбрать «%s»', async (buttonName, conflictMode) => {
    vi.mocked(api.fetchFridge).mockResolvedValue([{
      id: 'f1',
      name: 'Молоко',
      amount: 500,
      unit: 'мл',
      updatedAt: null,
      expiresAt: null,
      lastPurchasePrice: null
    }]);
    renderPage();
    await parseText();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }));

    expect(await screen.findByRole('dialog', { name: 'Такие продукты уже есть' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    await waitFor(() => expect(api.importReceipt).toHaveBeenCalledWith(
      'r1', expect.any(Array), 'Пятёрочка', conflictMode
    ));
  });

  it('позволяет исправить цену позиции до сохранения', async () => {
    renderPage();
    await parseText();
    const price = screen.getByLabelText('Цена, ₽') as HTMLInputElement;
    expect(price.value).toBe('89.9');
    fireEvent.change(price, { target: { value: '87.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }));
    await waitFor(() => expect(api.createReceiptDraft).toHaveBeenCalledWith(
      expect.objectContaining({ items: [expect.objectContaining({ totalPrice: 87.5 })] })
    ));
  });

  it('удаляет импортированный чек из истории после подтверждения', async () => {
    vi.mocked(api.fetchReceipts).mockResolvedValue([{
      id: 'r2', store: 'Пятёрочка', source: 'camera', purchasedAt: null, totalAmount: 56.13,
      fiscalFn: null, fiscalFd: null, fiscalFp: null, receiptKey: null, status: 'imported',
      importedAt: '2026-10-19T00:00:00Z', createdAt: '2026-10-19T00:00:00Z', itemCount: 1
    }]);
    renderPage();
    const remove = await screen.findByRole('button', { name: 'Удалить чек Пятёрочка' });
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: 'Удалить чек' }));
    await waitFor(() => expect(api.deleteReceipt).toHaveBeenCalledWith('r2'));
    expect(screen.queryByText('Импортирован')).toBeNull();
  });

  it('считает импорт успешным, даже если последующее обновление списка не загрузилось', async () => {
    vi.mocked(api.fetchFridge)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Список временно недоступен'));
    renderPage();
    await parseText();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }));

    await waitFor(() => expect(api.importReceipt).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Чек импортирован/)).toBeTruthy();
    expect(await screen.findByText(/Продукты добавлены, но список не обновился/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить выбранное в холодильник' })).toBeNull();
  });

  it('показывает предупреждение о повторном чеке', async () => {
    vi.mocked(api.createReceiptDraft).mockRejectedValue(new Error('Этот чек уже сохранён. Откройте его в истории чеков.'));
    renderPage();
    await parseText();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Этот чек уже сохранён');
    expect(api.importReceipt).not.toHaveBeenCalled();
  });

  it('сохраняет черновик в интерфейсе при ошибке атомарного импорта', async () => {
    vi.mocked(api.importReceipt).mockRejectedValue(new Error('Не удалось импортировать чек'));
    vi.mocked(api.fetchReceipts).mockResolvedValueOnce([]).mockResolvedValueOnce([{
      id: 'r1', store: 'Пятёрочка', source: 'text', purchasedAt: null, totalAmount: 89.9,
      fiscalFn: null, fiscalFd: null, fiscalFp: null, receiptKey: null, status: 'draft',
      importedAt: null, createdAt: '2026-10-19T00:00:00Z', itemCount: 1
    }]);
    renderPage();
    await parseText();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Не удалось импортировать чек');
    expect(await screen.findByText('Черновик')).toBeTruthy();
  });

  it('понятно сообщает об отсутствии авторизации', async () => {
    vi.mocked(api.createReceiptDraft).mockRejectedValue(new Error('Для сохранения чека нужно войти в приложение'));
    renderPage();
    await parseText();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить выбранное в холодильник' }));
    expect((await screen.findByRole('alert')).textContent).toContain('нужно войти');
  });
});
