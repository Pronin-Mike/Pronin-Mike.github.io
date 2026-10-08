import { useMemo, useRef, useState } from 'react';
import { Download, FileUp, Refrigerator, Upload } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import Modal from './Modal';
import { useToast } from './Toast';
import { Button, Card, Field, Textarea, cn } from './ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { fridgeCsvTemplate, parseFridgeCSV, toFridgeCSV, type FridgeCsvParseResult } from '../lib/csv';
import { downloadTextFile, readFileAsText } from '../lib/download';
import { formatAmount, productWord } from '../lib/format';
import { planFridgeImport, type FridgeImportAction, type FridgeImportMode } from '../lib/fridgeImport';

/* ============================================================================
 * FridgeCsvImport.tsx — заполнение холодильника из CSV (name,amount,unit).
 *
 * Файл разбирается на клиенте, план импорта считается чистой функцией
 * planFridgeImport: он же рисует предпросмотр и он же уходит в Supabase.
 * ========================================================================== */

const MODES: Array<{ value: FridgeImportMode; label: string; hint: string }> = [
  {
    value: 'merge',
    label: 'Обновлять совпадающие названия',
    hint: 'Уже имеющиеся продукты получат количество из файла, новые добавятся. Дата из файла перекрывает текущую; пусто — остаётся прежняя.'
  },
  {
    value: 'sum',
    label: 'Прибавлять к текущему количеству',
    hint: 'Складывается только при полном совпадении единицы измерения. Срок годности берётся самый ранний из двух.'
  },
  {
    value: 'replace',
    label: 'Заменить холодильник целиком',
    hint: 'Всё, чего нет в файле, будет удалено. Сроки годности — только из файла.'
  }
];

const ACTION_STYLE: Record<FridgeImportAction, { label: string; className: string }> = {
  new: { label: '➕ появится', className: 'bg-olive-50 text-olive-700 border-olive-200' },
  update: { label: '♻️ обновится', className: 'bg-honey-50 text-honey-700 border-honey-100' },
  sum: { label: '➕ прибавится', className: 'bg-honey-50 text-honey-700 border-honey-100' },
  skip: { label: '⚠️ пропущен', className: 'bg-berry-50 text-berry-700 border-berry-50' },
  invalid: { label: '⛔ ошибка', className: 'bg-berry-50 text-berry-700 border-berry-50' }
};

export default function FridgeCsvImport() {
  const { fridge, reloadFridge } = useCookbook();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<FridgeCsvParseResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mode, setMode] = useState<FridgeImportMode>('merge');
  const [busy, setBusy] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);

  const plan = useMemo(
    () => (parsed ? planFridgeImport(parsed.items.map((row) => row.item), fridge, mode, new Date()) : null),
    [parsed, fridge, mode]
  );

  const baseUrl = import.meta.env.BASE_URL;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setText(await readFileAsText(file));
      toast.show(`Файл «${file.name}» загружен. Нажмите «Проверить».`, 'info');
    } catch {
      toast.show('Не удалось прочитать файл.', 'error');
    }
  };

  const handleCheck = () => {
    if (!text.trim()) {
      toast.show('Вставьте CSV-текст или выберите файл.', 'error');
      return;
    }
    setParsed(parseFridgeCSV(text));
    setPreviewOpen(true);
  };

  const handleImport = async () => {
    if (!plan || !plan.entries.length) return;
    setBusy(true);
    try {
      await api.applyFridgeImport(plan);
      const parts: string[] = [];
      if (plan.counts.added) parts.push(`добавлено: ${plan.counts.added}`);
      if (plan.counts.updated) parts.push(`обновлено: ${plan.counts.updated}`);
      if (plan.counts.summed) parts.push(`прибавлено: ${plan.counts.summed}`);
      if (plan.counts.skipped) parts.push(`пропущено: ${plan.counts.skipped}`);

      toast.show(`Холодильник обновлён — ${parts.join(', ') || 'изменений нет'}.`, 'success');
      plan.warnings.slice(0, 3).forEach((warning) => toast.show(warning, 'info'));

      setPreviewOpen(false);
      setParsed(null);
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      await reloadFridge();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось обновить холодильник', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleExport = () => {
    if (!fridge.length) {
      toast.show('Холодильник пуст — выгружать нечего.', 'error');
      return;
    }
    downloadTextFile(
      'cookbook-fridge.csv',
      toFridgeCSV(
        fridge.map((item) => ({
          name: item.name,
          amount: item.amount,
          unit: item.unit,
          expiresAt: item.expiresAt
        }))
      ),
      'text/csv'
    );
    toast.show(`Выгружено ${productWord(fridge.length)} в CSV.`, 'success');
  };

  return (
    <Card className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 font-display text-lg text-ink">
        <Refrigerator className="size-5 text-terra-500" aria-hidden="true" />
        Холодильник из CSV
      </h2>
      <p className="text-sm leading-relaxed text-ink-soft">
        Колонки: <code className="rounded bg-cream-100 px-1.5 py-0.5">name,amount,unit</code> и
        необязательная <code className="rounded bg-cream-100 px-1.5 py-0.5">expires_at</code> (срок
        годности, <code className="rounded bg-cream-100 px-1.5 py-0.5">ГГГГ-ММ-ДД</code>) — по одной
        строке на продукт, например{' '}
        <code className="rounded bg-cream-100 px-1.5 py-0.5">творог,500,г,2026-10-15</code>.
        Единица измерения — только <code className="rounded bg-cream-100 px-1.5 py-0.5">г</code>,{' '}
        <code className="rounded bg-cream-100 px-1.5 py-0.5">мл</code> или{' '}
        <code className="rounded bg-cream-100 px-1.5 py-0.5">шт</code> (латиница g/ml/pcs тоже понимается).
        Строку заголовков можно не указывать, разделитель — «,», «;» или табуляция. Если дата не
        указана, подставляется типовой срок хранения продукта.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" onClick={() => fileRef.current?.click()}>
          <FileUp className="size-4" aria-hidden="true" />
          Выбрать CSV-файл
        </Button>
        <Button
          variant="ghost"
          onClick={() => downloadTextFile('cookbook-fridge-template.csv', fridgeCsvTemplate(), 'text/csv')}
        >
          <Download className="size-4" aria-hidden="true" />
          Скачать шаблон
        </Button>
        <a
          href={`${baseUrl}examples/sample-fridge.csv`}
          download
          className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cream-300 bg-white px-4 text-[15px] font-semibold text-ink-soft transition hover:bg-cream-100"
        >
          <Download className="size-4" aria-hidden="true" />
          Пример
        </a>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
      </div>

      <Field label="…или вставьте CSV прямо сюда" htmlFor="fridge-csv-text">
        <Textarea
          id="fridge-csv-text"
          value={text}
          rows={6}
          spellCheck={false}
          className="font-mono text-[13px]"
          placeholder={'творог,500,г,2026-10-15\nмолоко,1000,мл,2026-10-14\nсоль,300,г,\nяйца,10,шт,2026-11-07'}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handleCheck} disabled={busy}>
          Проверить
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setText('');
            setParsed(null);
            if (fileRef.current) fileRef.current.value = '';
          }}
        >
          Очистить
        </Button>
        <Button variant="ghost" onClick={handleExport} disabled={busy}>
          <Upload className="size-4" aria-hidden="true" />
          Экспорт холодильника
        </Button>
        <Button
          variant="ghost"
          className="text-berry-500"
          disabled={busy || !fridge.length}
          onClick={() => setClearOpen(true)}
        >
          Очистить холодильник
        </Button>
      </div>

      {/* Предпросмотр импорта */}
      <Modal
        open={previewOpen}
        title="Что будет в холодильнике"
        size="lg"
        onClose={() => setPreviewOpen(false)}
        footer={
          <>
            <Button
              className="flex-1"
              disabled={busy || !plan?.entries.length}
              onClick={() => void handleImport()}
            >
              {busy ? 'Импортируем…' : `Импортировать ${productWord(plan?.entries.length ?? 0)}`}
            </Button>
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setPreviewOpen(false)}>
              Отмена
            </Button>
          </>
        }
      >
        {parsed && plan ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-olive-200 bg-olive-50 px-2.5 py-1 font-semibold text-olive-700">
                Готово к импорту: {productWord(parsed.items.length)}
              </span>
              <span
                className={cn(
                  'rounded-full border px-2.5 py-1 font-semibold',
                  parsed.errors.length
                    ? 'border-berry-50 bg-berry-50 text-berry-700'
                    : 'border-olive-200 bg-olive-50 text-olive-700'
                )}
              >
                Ошибок: {parsed.errors.length}
              </span>
              <span className="rounded-full border border-cream-300 bg-cream-100 px-2.5 py-1 font-semibold text-ink-soft">
                Строк данных: {parsed.dataRows}
              </span>
            </div>

            <div className="flex flex-col gap-2.5 rounded-2xl border border-cream-300 bg-cream-50 p-3.5">
              <span className="text-[13px] font-bold text-ink-soft">Что делать с текущим холодильником</span>
              {MODES.map((item) => (
                <label key={item.value} className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
                  <input
                    type="radio"
                    name="fridge-csv-mode"
                    value={item.value}
                    className="mt-0.5 size-4 shrink-0 accent-terra-500"
                    checked={mode === item.value}
                    onChange={() => setMode(item.value)}
                  />
                  <span className="min-w-0">
                    {item.label}
                    <span className="block text-xs leading-snug text-ink-muted">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            {parsed.errors.length ? (
              <ul className="list-inside list-disc rounded-2xl border border-berry-50 bg-berry-50 px-4 py-3 text-sm text-berry-700">
                {parsed.errors.slice(0, 15).map((error) => (
                  <li key={`${error.row}-${error.message}`}>
                    {error.row ? `Строка ${error.row}: ` : ''}
                    {error.message}
                  </li>
                ))}
                {parsed.errors.length > 15 ? <li>…и ещё {parsed.errors.length - 15}</li> : null}
              </ul>
            ) : null}

            {plan.entries.length ? (
              <div className="overflow-x-auto rounded-2xl border border-cream-300 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-cream-100 text-xs tracking-wide text-ink-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Продукт</th>
                      <th className="px-3 py-2">Количество</th>
                      <th className="px-3 py-2">Ед.</th>
                      <th className="px-3 py-2">Срок годности</th>
                      <th className="px-3 py-2">Что будет</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.entries.slice(0, 25).map((entry) => {
                      const style = ACTION_STYLE[entry.action];
                      let note = style.label;
                      if (entry.action === 'sum') note += ` → ${formatAmount(entry.resulting)} ${entry.unit}`;
                      if (entry.note) note += ` — ${entry.note}`;
                      return (
                        <tr key={`${entry.row}-${entry.name}`} className="border-t border-cream-200 align-top">
                          <td className="px-3 py-2 font-semibold text-ink">{entry.name || '—'}</td>
                          <td className="px-3 py-2 tabular-nums text-ink-soft">{formatAmount(entry.amount)}</td>
                          <td className="px-3 py-2 text-ink-soft">{entry.unit}</td>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap text-ink-soft">
                            {entry.expiresAt ?? '—'}
                          </td>
                          <td className="px-3 py-2">
                            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold', style.className)}>
                              {note}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {plan.entries.length > 25 ? (
                  <p className="border-t border-cream-200 px-3 py-2 text-xs text-ink-muted">
                    Показаны первые 25 из {plan.entries.length}.
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-olive-200 bg-olive-50 px-2.5 py-1 font-semibold text-olive-700">
                в холодильнике станет: {productWord(plan.totalAfter)}
              </span>
              {plan.counts.added ? (
                <span className="rounded-full border border-olive-200 bg-olive-50 px-2.5 py-1 font-semibold text-olive-700">
                  новых: {plan.counts.added}
                </span>
              ) : null}
              {plan.counts.updated ? (
                <span className="rounded-full border border-honey-100 bg-honey-50 px-2.5 py-1 font-semibold text-honey-700">
                  обновится: {plan.counts.updated}
                </span>
              ) : null}
              {plan.counts.summed ? (
                <span className="rounded-full border border-honey-100 bg-honey-50 px-2.5 py-1 font-semibold text-honey-700">
                  прибавится: {plan.counts.summed}
                </span>
              ) : null}
              {plan.counts.skipped ? (
                <span className="rounded-full border border-berry-50 bg-berry-50 px-2.5 py-1 font-semibold text-berry-700">
                  пропущено: {plan.counts.skipped}
                </span>
              ) : null}
              {mode === 'replace' ? (
                <span className="rounded-full border border-berry-50 bg-berry-50 px-2.5 py-1 font-semibold text-berry-700">
                  ⚠️ текущий холодильник будет заменён
                </span>
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={clearOpen}
        title="Очистить холодильник?"
        description={`Будут удалены все продукты (${productWord(fridge.length)}). Блюда останутся, но станут недоступными.`}
        busy={busy}
        actions={[
          { label: 'Очистить', value: 'clear', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          setClearOpen(false);
          if (value !== 'clear') return;
          setBusy(true);
          void api
            .clearFridge()
            .then(() => reloadFridge())
            .then(() => toast.show('Холодильник очищен.', 'success'))
            .catch((caught: unknown) =>
              toast.show(caught instanceof Error ? caught.message : 'Не удалось очистить', 'error')
            )
            .finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}
