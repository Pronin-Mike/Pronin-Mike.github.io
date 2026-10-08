import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Pencil, Trash2 } from 'lucide-react';
import ConfirmDialog from '../components/ConfirmDialog';
import { IngredientViewRow } from '../components/IngredientRow';
import { SkeletonRows, Spinner } from '../components/Loading';
import { useToast } from '../components/Toast';
import { Badge, Button, Card, SectionTitle } from '../components/ui';
import { useCookbook } from '../hooks/useCookbook';
import * as api from '../lib/api';
import { checkDish, fridgeKey, missingText, normalizeName } from '../lib/availability';
import { formatTime, sectionEmoji } from '../lib/format';
import { getExpiryStatus } from '../lib/shelfLife';

/* ============================================================================
 * DishDetail.tsx — просмотр рецепта и кнопка «Приготовить»
 * (вызывает RPC cook_dish, см. api.ts).
 * ========================================================================== */

export default function DishDetail() {
  const { sectionId = '', dishId = '' } = useParams<{ sectionId: string; dishId: string }>();
  const { sections, dishes, fridgeIndex, loading, error, reload, cook } = useCookbook();
  const toast = useToast();
  const navigate = useNavigate();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const dish = useMemo(() => dishes.find((item) => item.id === dishId) ?? null, [dishes, dishId]);
  const availability = useMemo(
    () => (dish ? checkDish(dish, fridgeIndex) : null),
    [dish, fridgeIndex]
  );
  const section = sections.find((item) => item.id === (dish?.sectionId ?? sectionId));

  const handleCook = async () => {
    if (!dish) return;
    setBusy(true);
    try {
      const result = await cook(dish.id);
      if (!result.success) {
        toast.show(`Не хватает: ${missingText(result.missing)}`, 'error');
      } else if (result.expiredWarning?.length) {
        toast.show(
          `Приготовлено. Использованы просроченные продукты: ${result.expiredWarning.join(', ')}`,
          'warning'
        );
      } else {
        toast.show(`«${dish.title}» приготовлено — продукты списаны.`, 'success');
      }
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось приготовить блюдо', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!dish) return;
    setConfirmOpen(false);
    setBusy(true);
    try {
      await api.deleteDish(dish.id);
      toast.show(`«${dish.title}» удалено.`, 'info');
      navigate(`/?section=${dish.sectionId}`, { replace: true });
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Не удалось удалить блюдо', 'error');
    } finally {
      setBusy(false);
    }
  };

  const backLink = (
    <Link
      to={`/?section=${dish?.sectionId ?? sectionId}`}
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
            to="/"
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
        <div className="flex items-start gap-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-terra-50 text-3xl" aria-hidden="true">
            {sectionEmoji(dish.sectionId)}
          </span>
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

      <div className="sticky bottom-20 z-10 flex flex-wrap gap-2 rounded-2xl border border-cream-300 bg-white/95 p-3 shadow-lift backdrop-blur md:static md:p-0 md:shadow-none md:border-0 md:bg-transparent">
        <Button
          variant={availability.available ? 'olive' : 'ghost'}
          size="lg"
          className="flex-1 md:flex-none"
          disabled={!availability.available || busy}
          title={availability.available ? 'Списать продукты из холодильника' : `Не хватает: ${availability.missingText}`}
          onClick={() => void handleCook()}
        >
          {busy ? <Spinner className="text-white" /> : null}
          {availability.available ? 'Приготовить' : 'Не хватает продуктов'}
        </Button>

        <Link
          to={`/dish/${dish.id}/edit`}
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full border border-cream-300 bg-white px-4 font-semibold text-ink-soft transition hover:bg-cream-100 md:flex-none"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Редактировать
        </Link>

        <Button variant="ghost" size="lg" className="flex-1 text-berry-500 md:flex-none" onClick={() => setConfirmOpen(true)}>
          <Trash2 className="size-4" aria-hidden="true" />
          Удалить
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Удалить блюдо?"
        description={`«${dish.title}» будет удалено вместе с ингредиентами. Это действие нельзя отменить.`}
        busy={busy}
        actions={[
          { label: 'Удалить', value: 'delete', variant: 'danger' },
          { label: 'Отмена', value: 'cancel', variant: 'ghost' }
        ]}
        onResolve={(value) => {
          if (value === 'delete') void handleDelete();
          else setConfirmOpen(false);
        }}
      />
    </div>
  );
}
