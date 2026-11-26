import { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, FileUp, Upload } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import FridgeCsvImport from '../components/FridgeCsvImport';
import Modal from '../components/Modal';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Textarea, cn } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { parseDishesCSV, dishesCsvTemplate, type CsvParseResult } from '../lib/csv';
import { dateStamp, downloadTextFile, readFileAsText } from '../lib/download';
import { dishWord, sectionEmoji } from '../lib/format';
import type { BackupFile } from '../lib/types';

/* ============================================================================
 * Import.tsx — импорт блюд из CSV и полный бэкап в JSON.
 * ========================================================================== */

function describeBackup(file: Partial<BackupFile>): string {
  const dishes = Array.isArray(file.dishes) ? file.dishes.length : 0;
  const fridge = Array.isArray(file.fridge_items) ? file.fridge_items.length : 0;
  return `${dishWord(dishes)} и ${fridge} ${fridge === 1 ? 'продукт' : 'продуктов'}`;
}

function backupValidationError(file: Partial<BackupFile>): string | null {
  if (file.app !== 'home-cookbook') return 'Файл создан другим приложением или повреждён.';
  if (file.version !== 2) return `Версия резервной копии ${String(file.version ?? 'не указана')} не поддерживается.`;
  if (!Array.isArray(file.fridge_items) || !Array.isArray(file.dishes) || !Array.isArray(file.dish_ingredients)) {
    return 'В резервной копии отсутствуют обязательные разделы данных.';
  }
  return null;
}

export default function Import() {
  const { sections, dishes, fridge, reload } = useCookbook();
  const toast = useToast();

  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);

  const [csvText, setCsvText] = useState('');
  const [parsed, setParsed] = useState<CsvParseResult | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingBackup, setPendingBackup] = useState<Partial<BackupFile> | null>(null);
  const [csvTab, setCsvTab] = useState<'fridge' | 'recipes'>('fridge');

  const sectionTitles = useMemo(() => {
    const map = new Map<string, string>();
    sections.forEach((section) => map.set(section.id, section.title));
    return map;
  }, [sections]);

  /* ----------------------------- CSV: блюда ----------------------------- */

  const handleCsvFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setCsvText(await readFileAsText(file));
      toast.show(`Файл «${file.name}» загружен. Нажмите «Проверить».`, 'info');
    } catch {
      toast.show('Не удалось прочитать файл.', 'error');
    }
  };

  const handleCheck = () => {
    if (!csvText.trim()) {
      toast.show('Вставьте CSV-текст или выберите файл.', 'error');
      return;
    }
    const result = parseDishesCSV(csvText);
    setParsed(result);
    setPreviewOpen(true);
  };

  const handleImportCsv = async () => {
    if (!parsed?.items.length) return;
    setBusy(true);
    try {
      const result = await api.importDishes(parsed.items.map((item) => item.dish));
      const parts = [`Добавлено ${dishWord(result.added)}`];
      const problemCount = result.errors.length + parsed.errors.length;
      parts.push(`ошибок ${problemCount}`);
      toast.show(`${parts.join(', ')}.`, problemCount ? 'info' : 'success');
      if (result.errors.length) {
        result.errors.slice(0, 3).forEach((message) => toast.show(message, 'error'));
      }
      setPreviewOpen(false);
      setParsed(null);
      setCsvText('');
      if (csvInputRef.current) csvInputRef.current.value = '';
      await reload();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось импортировать блюда', 'error');
    } finally {
      setBusy(false);
    }
  };

  /* ------------------------------ JSON: бэкап ---------------------------- */

  const handleExport = async () => {
    setBusy(true);
    try {
      const backup = await api.exportBackup();
      downloadTextFile(
        `cookbook-backup-${dateStamp()}.json`,
        JSON.stringify(backup, null, 2),
        'application/json'
      );
      toast.show(`Бэкап сохранён: ${describeBackup(backup)}.`, 'success');
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось выгрузить базу', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleJsonFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = await readFileAsText(file);
      const data = JSON.parse(raw) as Partial<BackupFile>;

      const validationError = !data || typeof data !== 'object' ? 'Файл не содержит объект резервной копии.' : backupValidationError(data);
      if (validationError) {
        toast.show(validationError, 'error');
        return;
      }

      setPendingBackup(data);
    } catch {
      toast.show('Не удалось прочитать JSON-файл.', 'error');
    } finally {
      if (jsonInputRef.current) jsonInputRef.current.value = '';
    }
  };

  const handleRestore = async () => {
    const backup = pendingBackup;
    if (!backup) return;
    setBusy(true);
    try {
      const result = await api.importBackup(
        backup,
        sections.map((section) => section.id)
      );
      toast.show(
        `Загружено: ${dishWord(result.dishes)} и ${result.fridge} продуктов` +
          (result.skipped ? `, пропущено ${result.skipped}` : '') +
          '.',
        'success'
      );
      await reload();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось загрузить базу', 'error');
    } finally {
      setBusy(false);
      setPendingBackup(null);
    }
  };

  /* -------------------------------- Разметка ----------------------------- */

  return (
    <div className="flex flex-col gap-4 animate-rise-in">
      <header>
        <h1 className="font-display text-3xl text-ink">Импорт CSV и резервные копии</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Сейчас в базе: {dishWord(dishes.length)} и {fridge.length} продуктов.
        </p>
      </header>

      <div className="flex gap-1 overflow-x-auto rounded-xl border border-cream-300 bg-white p-1" role="tablist" aria-label="Тип импорта CSV">
        <button role="tab" aria-selected={csvTab === 'fridge'} className={cn('min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-bold', csvTab === 'fridge' ? 'bg-terra-100 text-terra-700' : 'text-ink-soft')} onClick={() => setCsvTab('fridge')}>В холодильник</button>
        <button role="tab" aria-selected={csvTab === 'recipes'} className={cn('min-h-10 flex-1 whitespace-nowrap rounded-lg px-4 text-sm font-bold', csvTab === 'recipes' ? 'bg-terra-100 text-terra-700' : 'text-ink-soft')} onClick={() => setCsvTab('recipes')}>В рецепты</button>
      </div>

      {/* A. Продукты из CSV. Компонент не размонтируется, поэтому текст сохраняется между вкладками. */}
      <div className={csvTab === 'fridge' ? 'block' : 'hidden'}><FridgeCsvImport /></div>

      {/* B. Блюда из CSV */}
      <Card className={csvTab === 'recipes' ? 'flex flex-col gap-3' : 'hidden'}>
        <h2 className="flex items-center gap-2 font-display text-lg text-ink">
          <FileSpreadsheet className="size-5 text-terra-500" aria-hidden="true" />
          Рецепты из CSV
        </h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          Колонки: <code className="rounded bg-cream-100 px-1.5 py-0.5">title,section,ingredients,time,steps,notes</code>.
          <br />
          <code className="rounded bg-cream-100 px-1.5 py-0.5">section</code> — breakfast, lunch или dinner;
          <code className="ml-1 rounded bg-cream-100 px-1.5 py-0.5">ingredients</code> — через «;», каждый
          в формате <code className="rounded bg-cream-100 px-1.5 py-0.5">название|количество|единица</code>;
          <code className="ml-1 rounded bg-cream-100 px-1.5 py-0.5">steps</code> — через «;».
          Если количество с запятой, берите поле <code className="rounded bg-cream-100 px-1.5 py-0.5">ingredients</code> в
          кавычки или используйте «;» как разделитель колонок.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => csvInputRef.current?.click()}>
            <FileUp className="size-4" aria-hidden="true" />
            Вставить файл CSV
          </Button>
          <Button
            variant="ghost"
            onClick={() => downloadTextFile('cookbook-template.csv', dishesCsvTemplate(), 'text/csv')}
          >
            <Download className="size-4" aria-hidden="true" />
            Скачать пример CSV
          </Button>
          <input
            ref={csvInputRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(event) => void handleCsvFile(event.target.files?.[0])}
          />
        </div>

        <Field label="…или вставьте CSV прямо сюда" htmlFor="csv-text">
          <Textarea
            id="csv-text"
            value={csvText}
            rows={6}
            spellCheck={false}
            placeholder={'title,section,ingredients,time,steps,notes\nОмлет с сыром,breakfast,яйца|3|шт;сыр|50|г,15,"Взбить яйца;Обжарить",Солить в конце'}
            className="font-mono text-[13px]"
            onChange={(event) => setCsvText(event.target.value)}
          />
        </Field>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleCheck} disabled={busy}>
            Добавить
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setCsvText('');
              setParsed(null);
              if (csvInputRef.current) csvInputRef.current.value = '';
            }}
          >
            Очистить
          </Button>
        </div>
      </Card>

      {/* JSON — отдельная секция, не часть CSV-вкладок. */}
      <Card className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 font-display text-lg text-ink">
          <Upload className="size-5 text-terra-500" aria-hidden="true" />
          Резервные копии
        </h2>
        <p className="text-sm leading-relaxed text-ink-soft">
          Экспорт выгружает холодильник, блюда и ингредиенты одним файлом. Импорт полностью заменяет
          содержимое базы — подтверждение спросим отдельно.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleExport()} disabled={busy}>
            <Download className="size-4" aria-hidden="true" />
            Экспорт JSON
          </Button>
          <Button variant="ghost" onClick={() => jsonInputRef.current?.click()} disabled={busy}>
            <Upload className="size-4" aria-hidden="true" />
            Импорт JSON
          </Button>
          <input
            ref={jsonInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => void handleJsonFile(event.target.files?.[0])}
          />
        </div>
      </Card>

      {/* Предпросмотр CSV */}
      <Modal
        open={previewOpen}
        title="Что будет добавлено"
        size="lg"
        onClose={() => setPreviewOpen(false)}
        footer={
          <>
            <Button
              className="flex-1"
              disabled={busy || !parsed?.items.length}
              onClick={() => void handleImportCsv()}
            >
              {busy ? 'Импортируем…' : `Импортировать ${dishWord(parsed?.items.length ?? 0)}`}
            </Button>
            <Button variant="ghost" className="flex-1" disabled={busy} onClick={() => setPreviewOpen(false)}>
              Отмена
            </Button>
          </>
        }
      >
        {parsed ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-olive-200 bg-olive-50 px-2.5 py-1 font-semibold text-olive-700">
                Готово к импорту: {dishWord(parsed.items.length)}
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

            {parsed.items.length ? (
              <div className="overflow-x-auto rounded-2xl border border-cream-300 bg-white">
                <table className="w-full text-left text-sm">
                  <thead className="bg-cream-100 text-xs tracking-wide text-ink-muted uppercase">
                    <tr>
                      <th className="px-3 py-2">Блюдо</th>
                      <th className="px-3 py-2">Раздел</th>
                      <th className="px-3 py-2">Ингредиенты</th>
                      <th className="px-3 py-2">Время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.items.slice(0, 20).map((item) => (
                      <tr key={item.row} className="border-t border-cream-200 align-top">
                        <td className="px-3 py-2 font-semibold text-ink">{item.dish.title}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-soft">
                          {sectionEmoji(item.dish.sectionId)}{' '}
                          {sectionTitles.get(item.dish.sectionId) ?? item.dish.sectionId}
                        </td>
                        <td className="px-3 py-2 text-ink-soft">
                          {item.dish.ingredients
                            .map((ingredient) => `${ingredient.name} ${ingredient.amount} ${ingredient.unit}`)
                            .join(', ')}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink-soft">
                          {item.dish.timeMin ? `${item.dish.timeMin} мин` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.items.length > 20 ? (
                  <p className="border-t border-cream-200 px-3 py-2 text-xs text-ink-muted">
                    Показаны первые 20 из {parsed.items.length}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {/* Подтверждение восстановления базы */}
      <ConfirmDialog
        open={Boolean(pendingBackup)}
        title="Заменить базу из файла?"
        description={
          pendingBackup
            ? `Версия: ${pendingBackup.version}. Создан: ${pendingBackup.exportedAt ? new Date(pendingBackup.exportedAt).toLocaleString('ru-RU') : 'время не указано'}. В файле: ${describeBackup(pendingBackup)}. Текущие данные (${dishWord(dishes.length)} и ${fridge.length} продуктов) будут атомарно заменены серверной функцией.`
            : ''
        }
        busy={busy}
        actions={[
          { label: 'Импортировать', value: 'restore', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          if (value === 'restore') void handleRestore();
          else setPendingBackup(null);
        }}
      />
    </div>
  );
}
