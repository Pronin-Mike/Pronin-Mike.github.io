import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Pencil, Play, Trash2, Utensils } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import CookingMode from '../components/CookingMode';
import { IngredientViewRow } from '../components/IngredientRow';
import { SkeletonRows } from '../components/Loading';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, SectionTitle } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { checkDish, fridgeKey, missingText, normalizeName } from '../lib/availability';
import { formatTime, sectionEmoji } from '../lib/format';
import { getExpiryStatus } from '../lib/shelfLife';
import { dishCost, formatCost, ingredientCost } from '../lib/pricing';
import { clearCookingSession, createCookingSession, loadCookingSession, reconcileCookingSession, saveCookingSession, type CookingSession } from '../lib/cookingSession';

/* ============================================================================
 * DishDetail.tsx — просмотр рецепта и кнопка «Приготовить»
 * (вызывает RPC cook_dish, см. api.ts).
 * ========================================================================== */

export default function DishDetail() {
  const { sectionId = '', dishId = '' } = useParams<{ sectionId: string; dishId: string }>();
  const { sections, dishes, fridgeIndex, loading, error, reload, cook } = useCookbook();
  const toast = useToast();
  const navigate = useNavigate();

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [sessionConflictOpen, setSessionConflictOpen] = useState(false);
  const [quickConfirmOpen, setQuickConfirmOpen] = useState(false);
  const [quickOperationId, setQuickOperationId] = useState<string | null>(null);
  const [cookingSession, setCookingSession] = useState<CookingSession | null>(null);
  const [busy, setBusy] = useState(false);

  const dish = useMemo(() => dishes.find((item) => item.id === dishId) ?? null, [dishes, dishId]);
  const availability = useMemo(
    () => (dish ? checkDish(dish, fridgeIndex) : null),
    [dish, fridgeIndex]
  );
  const section = sections.find((item) => item.id === (dish?.sectionId ?? sectionId));
  const cost = useMemo(() => dish ? dishCost(dish, fridgeIndex) : null, [dish, fridgeIndex]);

  const startCooking = () => {
    if (!dish) return;
    const existing = loadCookingSession();
    if (!existing) {
      const created = saveCookingSession(createCookingSession(dish));
      setCookingSession(created);
      return;
    }
    if (existing.dishId === dish.id) {
      const restored = saveCookingSession(reconcileCookingSession(existing, dish));
      setCookingSession(restored);
      return;
    }
    setSessionConflictOpen(true);
  };

  const handleQuickCook = async () => {
    if (!dish) return;
    const operationId = quickOperationId ?? crypto.randomUUID();
    setQuickOperationId(operationId);
    setBusy(true);
    try {
      const result = await cook(dish.id, operationId);
      if (!result.success) {
        setQuickOperationId(null);
        toast.show(`Не удалось списать: ${missingText(result.missing)}`, 'error');
        return;
      }
      setQuickOperationId(null);
      toast.show(`«${dish.title}» приготовлено. Списано на ${result.costComplete ? '' : '≈ '}${(result.cost ?? 0).toFixed(2)} ₽.`, 'success');
    } catch (caught) {
      toast.show(caught instanceof Error ? `${caught.message}. Повтор использует тот же идентификатор операции.` : 'Не удалось подтвердить списание', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!dish) return;
    setDeleteConfirmOpen(false);
    setBusy(true);
    try {
      await api.deleteDish(dish.id);
      toast.show(`«${dish.title}» удалено.`, 'info');
      navigate(`/recipes?section=${dish.sectionId}`, { replace: true });
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось удалить блюдо', 'error');
    } finally {
      setBusy(false);
    }
  };

  const backLink = (
    <Link
      to={`/recipes?section=${dish?.sectionId ?? sectionId}`}
      className="inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-ink-soft transition hover:text-terra-600"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      К рецептам
    </Link>
  );

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <SkeletonRows count={4} />
      </div>
    );
  }

  if (error && !dish) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Card className="flex flex-col items-start gap-3">
          <h1 className="font-display text-xl text-ink">Не удалось загрузить рецепт</h1>
          <p className="text-sm text-ink-soft">{error}</p>
          <Button onClick={() => void reload()}>Повторить</Button>
        </Card>
      </div>
    );
  }

  if (!dish || !availability) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <Card className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="text-4xl" aria-hidden="true">
            🤷
          </span>
          <SectionTitle>Блюдо не найдено</SectionTitle>
          <p className="text-sm text-ink-soft">Возможно, оно было удалено.</p>
          <Link
            to="/recipes"
            className="inline-flex min-h-11 items-center rounded-full bg-terra-500 px-4 font-semibold text-white"
          >
            К списку рецептов
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-rise-in">
      {backLink}

      <Card className="p-5">
        <div className="grid gap-5 md:grid-cols-[minmax(220px,360px)_1fr]">
          <div className="grid aspect-[4/3] place-items-center rounded-2xl bg-gradient-to-br from-terra-50 to-cream-200 text-terra-500"><Utensils className="size-12" aria-hidden="true" /></div>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl leading-tight text-ink">{dish.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone="neutral">{section ? `${sectionEmoji(section.id)} ${section.title}` : dish.sectionId}</Badge>
              {dish.timeMin ? (
                <Badge tone="neutral">
                  <Clock className="size-3.5" aria-hidden="true" />
                  {formatTime(dish.timeMin)}
                </Badge>
              ) : null}
              <Badge tone={availability.available ? 'ok' : 'error'}>
                {availability.available
                  ? '✅ Всё есть'
                  : `🛒 Не хватает: ${availability.missingText}`}
              </Badge>
              {cost ? <Badge tone="neutral">Стоимость: {formatCost(cost)}</Badge> : null}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <SectionTitle count={availability.total}>
          Ингредиенты · {availability.ready} из {availability.total} есть
        </SectionTitle>
        <ul className="mt-3 flex flex-col gap-2">
          {dish.ingredients.map((ingredient) => {
            const missing = availability.missing.find(
              (item) =>
                normalizeName(item.name) === normalizeName(ingredient.name) &&
                item.unit === ingredient.unit
            );
            const product = fridgeIndex.get(fridgeKey(ingredient.name, ingredient.unit));
            const expiresAt =
              product && getExpiryStatus(product.expiresAt) === 'expired' ? product.expiresAt : null;
            return (
              <IngredientViewRow
                key={`${ingredient.name}-${ingredient.unit}-${ingredient.sortOrder}`}
                ingredient={ingredient}
                missing={missing}
                expiresAt={expiresAt}
                cost={ingredientCost(ingredient, fridgeIndex)}
              />
            );
          })}
        </ul>
      </Card>

      {dish.steps.length > 0 ? (
        <Card>
          <SectionTitle>Как готовить</SectionTitle>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-[15px] leading-relaxed text-ink">
            {dish.steps.map((step, index) => (
              <li key={index} className="marker:font-bold marker:text-terra-500">
                {step}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      {dish.notes ? (
        <Card className="bg-cream-50">
          <SectionTitle>Заметки</SectionTitle>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-ink-soft">{dish.notes}</p>
        </Card>
      ) : null}

      <div className="sticky bottom-20 z-10 flex flex-wrap gap-2 rounded-2xl border border-cream-300 bg-white/95 p-3 shadow-lift backdrop-blur md:static md:border-0 md:bg-transparent md:p-0 md:shadow-none">
        <Button
          variant="olive"
          size="lg"
          className="flex-1 md:flex-none"
          onClick={startCooking}
        >
          <Play className="size-4" />Начать готовить
        </Button>

        <Button variant={availability.available ? 'olive' : 'ghost'} size="lg" className="flex-1 md:flex-none" disabled={!availability.available || busy} title={availability.available ? 'Потребуется подтверждение списания' : `Не хватает: ${availability.missingText}`} onClick={() => setQuickConfirmOpen(true)}>
          Приготовить сразу
        </Button>

        <Link
          to={`/dish/${dish.id}/edit`}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-cream-300 bg-white px-4 font-semibold text-ink-soft transition hover:bg-cream-100 md:flex-none"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Редактировать
        </Link>

        <Button variant="ghost" size="lg" className="flex-1 text-berry-500 md:flex-none" onClick={() => setDeleteConfirmOpen(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          Удалить
        </Button>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Удалить блюдо?"
        description={`«${dish.title}» будет удалено вместе с ингредиентами. Это действие нельзя отменить.`}
        busy={busy}
        actions={[
          { label: 'Удалить', value: 'delete', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          if (value === 'delete') void handleDelete();
          else setDeleteConfirmOpen(false);
        }}
      />

      <ConfirmDialog
        open={quickConfirmOpen}
        title="Приготовить сразу?"
        description={`Все ингредиенты для «${dish.title}» будут атомарно списаны из холодильника. Повторный сетевой запрос защищён идентификатором операции.`}
        busy={busy}
        actions={[{ label: 'Подтвердить списание', value: 'cook', variant: 'primary' }, { label: 'Отмена', value: 'cancel', variant: 'ghost' }]}
        onResolve={(value) => {
          setQuickConfirmOpen(false);
          if (value === 'cook') void handleQuickCook();
        }}
      />

      <ConfirmDialog
        open={sessionConflictOpen}
        title="Уже идёт другая готовка"
        description={`Сохранена незавершённая готовка «${loadCookingSession()?.dishTitle ?? 'другого рецепта'}».`}
        actions={[{ label: 'Продолжить предыдущую', value: 'continue', variant: 'primary' }, { label: 'Отменить её и начать новую', value: 'replace', variant: 'danger' }, { label: 'Вернуться', value: 'back', variant: 'ghost' }]}
        onResolve={(value) => {
          setSessionConflictOpen(false);
          if (value === 'continue') {
            const previous = loadCookingSession();
            const previousDish = dishes.find((item) => item.id === previous?.dishId);
            if (previousDish) navigate(`/${previousDish.sectionId}/${previousDish.id}`);
            else toast.show('Сохранённый рецепт больше не существует. Отмените старую сессию, чтобы начать новую.', 'warning');
          }
          if (value === 'replace') {
            clearCookingSession();
            const created = saveCookingSession(createCookingSession(dish));
            setCookingSession(created);
          }
        }}
      />

      {cookingSession ? <CookingMode dish={dish} fridgeIndex={fridgeIndex} initialSession={cookingSession} onCook={cook} onClose={() => setCookingSession(null)} onCompleted={() => { setCookingSession(null); toast.show('Готовка завершена, продукты списаны.', 'success'); }} onCancelled={() => { setCookingSession(null); toast.show('Готовка отменена. Запасы не изменены.', 'info'); }} /> : null}
    </div>
  );
}
