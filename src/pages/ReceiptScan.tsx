import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, FileText, History, ScanLine, Trash2, Upload } from 'lucide-react';
import * as api from '../lib/api';
import { planFridgeImport } from '../lib/fridgeImport';
import { matchReceiptItem, normalizeReceiptProduct } from '../lib/receiptMatcher';
import { parseReceipt, receiptKey, type ParsedReceipt, type ReceiptStore } from '../lib/receiptParser';
import { extractPdfText, recognizeImage, recognizePdfPages, type RecognitionProgress } from '../lib/receiptOcr';
import { supabaseProjectRef } from '../lib/supabase';
import type { FridgeItem, ProductAlias, Receipt, ReceiptConflictMode, ReceiptItem, ReceiptSource, Unit } from '../lib/types';
import { useToast } from '../components/Toast';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { Badge, Button, Card, Field, Input, Select, Textarea } from '../components/ui';

const STORES: ReceiptStore[] = ['Пятёрочка', 'В1', 'Перекрёсток', 'ДА!', 'Другой магазин'];

function money(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} ₽`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось обработать чек';
}

export default function ReceiptScan() {
  const toast = useToast();
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [rawText, setRawText] = useState('');
  const [parsed, setParsed] = useState<ParsedReceipt | null>(null);
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [store, setStore] = useState<ReceiptStore>('Другой магазин');
  const [fridge, setFridge] = useState<FridgeItem[]>([]);
  const [aliases, setAliases] = useState<ProductAlias[]>([]);
  const [history, setHistory] = useState<Receipt[]>([]);
  const [historyItems, setHistoryItems] = useState<ReceiptItem[]>([]);
  const [historyReceipt, setHistoryReceipt] = useState<Receipt | null>(null);
  const [progress, setProgress] = useState<RecognitionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [source, setSource] = useState<ReceiptSource>('text');
  const [pdfWithoutText, setPdfWithoutText] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Receipt | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);

  const reloadHistory = async () => setHistory(await api.fetchReceipts());

  useEffect(() => {
    void api.fetchFridge()
      .then(setFridge)
      .catch((caught) => setError(errorMessage(caught)));
    void Promise.all([api.fetchProductAliases(), api.fetchReceipts()])
      .then(([nextAliases, nextHistory]) => {
        setAliases(nextAliases);
        setHistory(nextHistory);
        setStorageError(null);
      })
      .catch((caught) => setStorageError(errorMessage(caught)));
  }, []);

  const importPlan = useMemo(() => {
    const rows = items
      .filter((item) => item.includeInFridge && item.fridgeAmount && item.fridgeUnit && item.normalizedName.trim())
      .map((item) => ({
        name: item.normalizedName.trim(),
        amount: item.fridgeAmount as number,
        unit: item.fridgeUnit as Unit
      }));
    const canonicalFridge = fridge.map((item) => ({
      ...item,
      name: normalizeReceiptProduct(item.name) ?? item.name
    }));
    return planFridgeImport(rows, canonicalFridge, 'sum');
  }, [fridge, items]);

  const applyParsed = (text: string, nextSource: ReceiptSource) => {
    const result = parseReceipt(text);
    setRawText(text);
    setParsed(result);
    setStore(result.store);
    setItems(result.items.map((item) => matchReceiptItem(item, aliases, fridge, result.store)));
    setSource(nextSource);
    setDraftId(null);
    setError(null);
    setImportError(null);
  };

  const handleFile = async (file: File, nextSource: ReceiptSource) => {
    const isPdf = file.type === 'application/pdf' || file.name.toLocaleLowerCase().endsWith('.pdf');
    const isImage = /^image\/(jpeg|png|webp)$/.test(file.type);
    if (!isPdf && !isImage) {
      setError('Поддерживаются JPEG, PNG, WebP и PDF.');
      return;
    }
    setBusy(true);
    setError(null);
    setProgress({ stage: 'Подготовка', progress: 0 });
    setPdfWithoutText(null);
    try {
      if (isPdf) {
        const result = await extractPdfText(file, setProgress);
        if (!result.hasTextLayer) {
          setPdfWithoutText(file);
          setError(`В PDF (${result.pages} стр.) нет текстового слоя. Запустите OCR страниц.`);
          return;
        }
        applyParsed(result.text, 'pdf');
      } else {
        const text = await recognizeImage(file, setProgress);
        if (!text) throw new Error('Распознавание не нашло текст. Попробуйте более чёткое фото.');
        applyParsed(text, nextSource);
      }
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handlePdfOcr = async () => {
    if (!pdfWithoutText) return;
    setBusy(true);
    setError(null);
    setProgress({ stage: 'Загружаем OCR', progress: 0 });
    try {
      const text = await recognizePdfPages(pdfWithoutText, setProgress);
      if (!text) throw new Error('На страницах PDF не удалось распознать текст.');
      applyParsed(text, 'pdf');
      setPdfWithoutText(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const updateItem = (index: number, patch: Partial<ReceiptItem>) => {
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, ...patch };
      if (patch.normalizedName !== undefined || patch.fridgeAmount !== undefined || patch.fridgeUnit !== undefined) {
        next.matchStatus = 'manual';
        next.needsReview = !next.normalizedName.trim() || !next.fridgeAmount || !next.fridgeUnit;
      }
      if (patch.normalizedName !== undefined || patch.fridgeUnit !== undefined) {
        next.matchedFridgeIds = [];
      }
      return next;
    }));
  };

  const canImport = items.some((item) => item.includeInFridge)
    && items.filter((item) => item.includeInFridge).every((item) =>
      item.normalizedName.trim() && item.fridgeAmount !== null && item.fridgeAmount > 0 && item.fridgeUnit !== null
    );
  const invalidSelectedCount = items.filter((item) =>
    item.includeInFridge
    && (!item.normalizedName.trim() || item.fridgeAmount === null || item.fridgeAmount <= 0 || item.fridgeUnit === null)
  ).length;

  const possibleDuplicate = useMemo(() => {
    if (!parsed || receiptKey(parsed) || parsed.totalAmount === null || !parsed.purchasedAt) return null;
    const date = parsed.purchasedAt.slice(0, 10);
    return history.find((receipt) =>
      receipt.store === store
      && receipt.totalAmount === parsed.totalAmount
      && (receipt.purchasedAt ?? receipt.createdAt).slice(0, 10) === date
    ) ?? null;
  }, [history, parsed, store]);

  const handleImport = async (conflictMode: ReceiptConflictMode = 'sum') => {
    if (!parsed || !canImport) return;
    setBusy(true);
    setImportError(null);
    try {
      let receiptId = draftId;
      if (!receiptId) {
        const draft = await api.createReceiptDraft({
          store,
          source,
          purchasedAt: parsed.purchasedAt,
          totalAmount: parsed.totalAmount,
          fiscalFn: parsed.fiscalFn,
          fiscalFd: parsed.fiscalFd,
          fiscalFp: parsed.fiscalFp,
          receiptKey: receiptKey(parsed),
          items
        });
        receiptId = draft.id;
        setDraftId(draft.id);
      }
      await api.importReceipt(receiptId, items, store, conflictMode);
      toast.show(`Чек импортирован: ${items.filter((item) => item.includeInFridge).length} позиций.`, 'success');
      setParsed(null);
      setItems([]);
      setRawText('');
      setDraftId(null);

      const [fridgeResult, historyResult] = await Promise.allSettled([api.fetchFridge(), api.fetchReceipts()]);
      if (fridgeResult.status === 'fulfilled') setFridge(fridgeResult.value);
      if (historyResult.status === 'fulfilled') setHistory(historyResult.value);
      if (fridgeResult.status === 'rejected' || historyResult.status === 'rejected') {
        toast.show('Продукты добавлены, но список не обновился. Перезагрузите страницу.', 'info');
      }
    } catch (caught) {
      const message = errorMessage(caught);
      setImportError(message);
      toast.show(message, 'error');
      await reloadHistory().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async (receipt: Receipt) => {
    setHistoryReceipt(receipt);
    setHistoryItems([]);
    try {
      setHistoryItems(await api.fetchReceiptItems(receipt.id));
    } catch (caught) {
      toast.show(errorMessage(caught), 'error');
    }
  };

  const deleteHistoryReceipt = async (receipt: Receipt) => {
    setBusy(true);
    try {
      await api.deleteReceipt(receipt.id);
      setHistory((current) => current.filter((item) => item.id !== receipt.id));
      if (historyReceipt?.id === receipt.id) setHistoryReceipt(null);
      toast.show('Чек удалён из истории. Продукты остались в холодильнике.', 'info');
    } catch (caught) {
      toast.show(errorMessage(caught), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-3xl text-ink">Сканировать чек</h1>
        <p className="mt-1 text-sm text-ink-soft">Фото остаётся на устройстве; в базу сохраняются только распознанные данные.</p>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Button disabled={busy} onClick={() => cameraRef.current?.click()}>
            <Camera className="size-4" aria-hidden="true" /> Сфотографировать чек
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => uploadRef.current?.click()}>
            <Upload className="size-4" aria-hidden="true" /> Загрузить файл
          </Button>
          <input ref={cameraRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"
            onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0], 'camera')} />
          <input ref={uploadRef} className="hidden" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
            onChange={(event) => event.target.files?.[0] && void handleFile(event.target.files[0], 'upload')} />
        </div>

        {progress && (
          <div role="status" className="space-y-1">
            <div className="flex justify-between text-xs text-ink-soft"><span>{progress.stage}</span><span>{Math.round(progress.progress * 100)}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-cream-300"><div className="h-full bg-terra-500 transition-all" style={{ width: `${Math.round(progress.progress * 100)}%` }} /></div>
          </div>
        )}
        {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
        {pdfWithoutText && <Button disabled={busy} onClick={() => void handlePdfOcr()}><ScanLine className="size-4" /> Распознать страницы PDF</Button>}

        <Field label="…или вставьте текст электронного чека" htmlFor="receipt-text">
          <Textarea id="receipt-text" rows={7} value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder="Вставьте строки чека сюда" />
        </Field>
        <Button variant="ghost" disabled={busy || !rawText.trim()} onClick={() => applyParsed(rawText, 'text')}>
          <FileText className="size-4" /> Разобрать текст
        </Button>
      </Card>

      {parsed && (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="font-display text-xl">Проверьте позиции</h2><p className="text-sm text-ink-soft">Ничего не добавится без подтверждения.</p></div>
            <Badge tone={items.some((item) => item.needsReview) ? 'warn' : 'ok'}>{items.filter((item) => item.needsReview).length} требуют проверки</Badge>
          </div>
          <Field label="Магазин" htmlFor="receipt-store"><Select id="receipt-store" value={store} onChange={(event) => setStore(event.target.value as ReceiptStore)}>{STORES.map((name) => <option key={name}>{name}</option>)}</Select></Field>
          {parsed.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>)}
          {possibleDuplicate && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">В истории есть чек этого магазина с той же датой и суммой. Это только предупреждение — импорт не заблокирован.</p>}

          <div className="space-y-3">
            {items.map((item, index) => (
              <article key={`${item.lineNumber}-${index}`} className="rounded-2xl border border-cream-300 bg-white p-3">
                <label className="flex items-start gap-3">
                  <input className="mt-1 size-5 accent-terra-500" type="checkbox" checked={item.includeInFridge} onChange={(event) => updateItem(index, { includeInFridge: event.target.checked })} />
                  <span className="min-w-0 flex-1"><span className="block break-words text-xs text-ink-muted">{item.rawName}</span><span className="mt-1 block text-xs text-ink-soft">Цена: {money(item.totalPrice)}</span></span>
                </label>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_8rem_6rem_8rem]">
                  <Field label="Продукт" htmlFor={`item-name-${index}`}><Input id={`item-name-${index}`} value={item.normalizedName} disabled={!item.includeInFridge} onChange={(event) => updateItem(index, { normalizedName: event.target.value })} /></Field>
                  <Field label="Количество" htmlFor={`item-amount-${index}`}><Input id={`item-amount-${index}`} type="number" min="0.001" step="any" value={item.fridgeAmount ?? ''} disabled={!item.includeInFridge} onChange={(event) => updateItem(index, { fridgeAmount: event.target.value ? Number(event.target.value) : null })} /></Field>
                  <Field label="Единица" htmlFor={`item-unit-${index}`}><Select id={`item-unit-${index}`} value={item.fridgeUnit ?? ''} disabled={!item.includeInFridge} onChange={(event) => updateItem(index, { fridgeUnit: event.target.value as Unit })}><option value="" disabled>—</option><option>г</option><option>мл</option><option>шт</option></Select></Field>
                  <Field label="Цена, ₽" htmlFor={`item-price-${index}`}><Input id={`item-price-${index}`} type="number" min="0" step="0.01" value={item.totalPrice ?? ''} disabled={!item.includeInFridge} onChange={(event) => updateItem(index, { totalPrice: event.target.value ? Number(event.target.value) : null })} /></Field>
                </div>
                {item.needsReview && item.includeInFridge && <p className="mt-2 text-xs font-semibold text-amber-800">Проверьте название, количество и единицу.</p>}
              </article>
            ))}
          </div>

          <div className="rounded-2xl bg-cream-100 p-4 text-sm">
            <p className="font-semibold text-ink">Будет обработано: {items.filter((item) => item.includeInFridge).length}</p>
            <p className="mt-1 text-ink-soft">Новых: {importPlan.counts.added}; совпадений: {importPlan.counts.summed}; пропущено: {importPlan.counts.skipped}. Для совпадений можно заменить, оставить текущее количество или сложить.</p>
          </div>
          {storageError && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>{storageError}</p>
              <p className="mt-2">
                Выполните <code>sql/receipt-scanner.sql</code> именно в проекте Supabase
                {supabaseProjectRef ? <> <strong>{supabaseProjectRef}</strong></> : null}, дождитесь строки <strong>ready</strong> и обновите страницу без кеша.
              </p>
            </div>
          )}
          {!storageError && invalidSelectedCount > 0 && (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Нельзя добавить: у {invalidSelectedCount} выбранных позиций не заполнены название, количество или единица. Заполните поля либо снимите флажок у этих позиций.
            </p>
          )}
          {importError && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{importError}</div>}
          <Button className="w-full" disabled={busy || !canImport || storageError !== null} onClick={() => importPlan.counts.summed > 0 ? setConflictOpen(true) : void handleImport('sum')}>{busy ? 'Сохраняем…' : 'Добавить выбранное в холодильник'}</Button>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex items-center gap-2"><History className="size-5 text-terra-500" /><h2 className="font-display text-xl">История чеков</h2></div>
        {!history.length && <p className="text-sm text-ink-soft">Сохранённых чеков пока нет.</p>}
        <ul className="divide-y divide-cream-300">
          {history.map((receipt) => (
            <li key={receipt.id} className="flex items-center gap-3 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => void openHistory(receipt)}>
                <span className="block font-semibold text-ink">{receipt.store ?? 'Магазин не указан'}</span>
                <span className="block text-xs text-ink-soft">{new Date(receipt.purchasedAt ?? receipt.createdAt).toLocaleDateString('ru-RU')} · {money(receipt.totalAmount)} · {receipt.itemCount ?? 0} поз.</span>
              </button>
              <Badge tone={receipt.status === 'imported' ? 'ok' : 'warn'}>{receipt.status === 'imported' ? 'Импортирован' : 'Черновик'}</Badge>
              <button disabled={busy} aria-label={`Удалить чек ${receipt.store ?? ''}`} className="rounded-full p-2 text-red-700 hover:bg-red-50 disabled:opacity-45" onClick={() => setDeleteTarget(receipt)}><Trash2 className="size-4" /></button>
            </li>
          ))}
        </ul>
      </Card>

      <Modal open={historyReceipt !== null} title={historyReceipt?.store ?? 'Чек'} onClose={() => setHistoryReceipt(null)}>
        <div className="space-y-3">
          {historyItems.map((item) => <div key={item.id ?? item.lineNumber} className="rounded-xl border border-cream-300 p-3"><p className="text-xs text-ink-muted">{item.rawName}</p><p className="font-semibold">{item.normalizedName}</p><p className="text-sm text-ink-soft">{item.fridgeAmount ?? '—'} {item.fridgeUnit ?? ''} · {money(item.totalPrice)}</p></div>)}
          {!historyItems.length && <p className="text-sm text-ink-soft">Позиции не найдены.</p>}
        </div>
      </Modal>

      <ConfirmDialog
        open={conflictOpen}
        title="Такие продукты уже есть"
        description={`Совпадений: ${importPlan.counts.summed}. Как обработать существующие позиции? Выбранное действие применится ко всем совпадениям.`}
        busy={busy}
        actions={[
          { label: 'Заменить', value: 'replace', variant: 'primary' },
          { label: 'Оставить как есть', value: 'keep', variant: 'ghost' },
          { label: 'Сложить', value: 'sum', variant: 'olive' }
        ]}
        onResolve={(value) => {
          setConflictOpen(false);
          if (value === 'replace' || value === 'keep' || value === 'sum') void handleImport(value);
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить чек из истории?"
        description="Чек и его позиции будут удалены без возможности восстановления. Уже добавленные продукты останутся в холодильнике."
        busy={busy}
        actions={[
          { label: 'Удалить чек', value: 'delete', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (value === 'delete' && target) void deleteHistoryReceipt(target);
        }}
      />
    </div>
  );
}
