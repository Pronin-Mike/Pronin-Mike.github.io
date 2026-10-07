import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Save, Trash2 } from 'lucide-react';
import { IngredientEditorRow } from '../components/IngredientRow';
import { FullScreenSpinner, SkeletonRows } from '../components/Loading';
import { useToast } from '../components/Toast';
import { Button, Card, Field, Input, SectionTitle, Select, Textarea } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { buildIngredientSuggestions, type IngredientSuggestion } from '../lib/suggestions';
import { validateDishInput } from '../lib/validation';
import type { DishIngredient, DishInput, Unit } from '../lib/types';

/* ============================================================================
 * DishEdit.tsx — добавление и редактирование блюда
 * (/dish/new и /dish/:dishId/edit).
 * ========================================================================== */

function emptyIngredient(sortOrder = 0): DishIngredient {
  return { name: '', amount: Number.NaN, unit: 'г' as Unit, sortOrder };
}

function emptyForm(sectionId: string): DishInput {
  return {
    title: '',
    sectionId,
    timeMin: null,
    steps: [''],
    notes: '',
    ingredients: [emptyIngredient()]
  };
}

export default function DishEdit() {
  const { dishId } = useParams<{ dishId: string }>();
  const isEdit = Boolean(dishId);
  const { sections, dishes, fridge, loading, error, reload } = useCookbook();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState<DishInput>(emptyForm(''));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  /** Подсказки для поля названия ингредиента — из текущего холодильника. */
  const suggestions = useMemo(() => buildIngredientSuggestions(fridge), [fridge]);

  const existing = useMemo(
    () => (dishId ? (dishes.find((item) => item.id === dishId) ?? null) : null),
    [dishes, dishId]
  );

  useEffect(() => {
    if (loading || ready || !sections.length) return;

    if (isEdit) {
      if (!existing) return;
      setForm({
        title: existing.title,
        sectionId: existing.sectionId,
        timeMin: existing.timeMin,
        steps: existing.steps.length ? existing.steps : [''],
        notes: existing.notes,
        ingredients: existing.ingredients.length ? existing.ingredients : [emptyIngredient()]
      });
    } else {
      setForm(emptyForm(sections[0].id));
    }

    setReady(true);
  }, [loading, ready, sections, isEdit, existing]);

  const updateIngredient = (index: number, patch: Partial<DishIngredient>) => {
    setForm((prev) => ({
      ...prev,
      ingredients: prev.ingredients.map((item, position) =>
        position === index ? { ...item, ...patch } : item
      )
    }));
  };

  const addIngredient = () => {
    setForm((prev) => ({
      ...prev,
      ingredients: [...prev.ingredients, emptyIngredient(prev.ingredients.length)]
    }));
  };

  const removeIngredient = (index: number) => {
    setForm((prev) => {
      const next = prev.ingredients.filter((_, position) => position !== index);
      return { ...prev, ingredients: next.length ? next : [emptyIngredient()] };
    });
  };

  /** Выбор подсказки: подставляем и название, и единицу из холодильника. */
  const pickIngredient = (index: number, suggestion: IngredientSuggestion) => {
    updateIngredient(index, { name: suggestion.name, unit: suggestion.unit });
  };

  const updateStep = (index: number, value: string) => {
    setForm((prev) => ({
      ...prev,
      steps: prev.steps.map((step, position) => (position === index ? value : step))
    }));
  };

  const addStep = () => setForm((prev) => ({ ...prev, steps: [...prev.steps, ''] }));

  const removeStep = (index: number) => {
    setForm((prev) => {
      const next = prev.steps.filter((_, position) => position !== index);
      return { ...prev, steps: next.length ? next : [''] };
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const cleaned: DishInput = {
      ...form,
      title: form.title.trim(),
      steps: form.steps.map((step) => step.trim()).filter(Boolean),
      ingredients: form.ingredients
        .filter((item) => item.name.trim().length > 0)
        .map((item, index) => ({ ...item, name: item.name.trim(), sortOrder: index }))
    };

    const validation = validateDishInput(cleaned);
    if (!validation.ok) {
      setErrors(validation.errors);
      toast.show(validation.errors[0], 'error');
      return;
    }

    setErrors([]);
    setBusy(true);
    try {
      const saved = isEdit && dishId ? await api.updateDish(dishId, cleaned) : await api.createDish(cleaned);
      toast.show(isEdit ? 'Изменения сохранены.' : `«${saved.title}» добавлено в книгу.`, 'success');
      navigate(`/${saved.sectionId}/${saved.id}`, { replace: !isEdit });
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось сохранить блюдо', 'error');
    } finally {
      setBusy(false);
    }
  };

  const backTo = isEdit && existing ? `/${existing.sectionId}/${existing.id}` : '/';

  if (loading || !ready) {
    return (
      <div className="flex flex-col gap-4">
        <Link to={backTo} className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-ink-soft">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Назад
        </Link>
        {loading ? <SkeletonRows count={4} /> : <FullScreenSpinner label="Готовим форму…" />}
      </div>
    );
  }

  if (isEdit && !existing) {
    return (
      <Card className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="text-4xl" aria-hidden="true">
          🤷
        </span>
        <SectionTitle>Блюдо не найдено</SectionTitle>
        <p className="text-sm text-ink-soft">{error ?? 'Возможно, оно было удалено.'}</p>
        <div className="flex gap-2">
          <Button onClick={() => void reload()}>Обновить</Button>
          <Link
            to="/"
            className="inline-flex min-h-11 items-center rounded-full border border-cream-300 bg-white px-4 font-semibold text-ink-soft"
          >
            К рецептам
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <form className="flex flex-col gap-4 animate-rise-in" onSubmit={(event) => void handleSubmit(event)}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl text-ink">{isEdit ? 'Редактировать блюдо' : 'Новое блюдо'}</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Единицы измерения — только г, мл или шт. Сравнение с холодильником строгое.
          </p>
        </div>
        <Link to={backTo} className="hidden min-h-9 items-center gap-1.5 text-sm font-semibold text-ink-soft sm:inline-flex">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Назад
        </Link>
      </div>

      <Card className="flex flex-col gap-4">
        <Field label="Название блюда" htmlFor="dish-title">
          <Input
            id="dish-title"
            value={form.title}
            placeholder="Омлет с сыром"
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Раздел" htmlFor="dish-section">
            <Select
              id="dish-section"
              value={form.sectionId}
              onChange={(event) => setForm((prev) => ({ ...prev, sectionId: event.target.value }))}
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.title}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Время, минут" hint="Можно оставить пустым" htmlFor="dish-time">
            <Input
              id="dish-time"
              inputMode="numeric"
              value={form.timeMin === null ? '' : String(form.timeMin)}
              placeholder="15"
              onChange={(event) => {
                const raw = event.target.value.trim();
                if (!raw) {
                  setForm((prev) => ({ ...prev, timeMin: null }));
                  return;
                }
                const parsed = Number(raw.replace(',', '.'));
                setForm((prev) => ({ ...prev, timeMin: Number.isFinite(parsed) ? parsed : Number.NaN }));
              }}
            />
          </Field>
        </div>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionTitle count={form.ingredients.length}>Ингредиенты</SectionTitle>
        <p className="text-xs text-ink-muted">
          Начните вводить название — подскажем продукты из холодильника вместе с их единицей
          измерения. Если продукта в холодильнике нет, просто впишите его руками.
        </p>
        <div className="flex flex-col gap-2">
          {form.ingredients.map((ingredient, index) => (
            <IngredientEditorRow
              key={index}
              ingredient={ingredient}
              index={index}
              disabled={busy}
              suggestions={suggestions}
              onChange={updateIngredient}
              onRemove={removeIngredient}
              onPick={pickIngredient}
            />
          ))}
        </div>
        <Button variant="ghost" onClick={addIngredient} disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          Ингредиент
        </Button>
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionTitle count={form.steps.length}>Шаги приготовления</SectionTitle>
        <div className="flex flex-col gap-2">
          {form.steps.map((step, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-3 grid size-6 shrink-0 place-items-center rounded-full bg-terra-50 text-xs font-bold text-terra-700">
                {index + 1}
              </span>
              <Textarea
                value={step}
                rows={2}
                disabled={busy}
                placeholder={index === 0 ? 'Взбить яйца' : 'Следующий шаг'}
                aria-label={`Шаг ${index + 1}`}
                onChange={(event) => updateStep(index, event.target.value)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 size-9 !min-h-9 !px-0 text-berry-500"
                disabled={busy}
                aria-label={`Удалить шаг ${index + 1}`}
                onClick={() => removeStep(index)}
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="ghost" onClick={addStep} disabled={busy}>
          <Plus className="size-4" aria-hidden="true" />
          Шаг
        </Button>
      </Card>

      <Card>
        <Field label="Заметки" htmlFor="dish-notes">
          <Textarea
            id="dish-notes"
            value={form.notes}
            rows={3}
            placeholder="Солить в самом конце, подавать горячим…"
            onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
          />
        </Field>
      </Card>

      {errors.length ? (
        <ul className="list-inside list-disc rounded-2xl border border-berry-50 bg-berry-50 px-4 py-3 text-sm text-berry-700">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <div className="sticky bottom-20 z-10 flex flex-wrap gap-2 rounded-2xl border border-cream-300 bg-white/95 p-3 shadow-lift backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <Button type="submit" size="lg" disabled={busy} className="flex-1 md:flex-none">
          <Save className="size-4" aria-hidden="true" />
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <Link
          to={backTo}
          className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-cream-300 bg-white px-4 font-semibold text-ink-soft transition hover:bg-cream-100 md:flex-none"
        >
          Отмена
        </Link>
      </div>
    </form>
  );
}
