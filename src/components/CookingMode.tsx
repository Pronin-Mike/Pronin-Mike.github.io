import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, MoreHorizontal, X } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import { Button, Card, IconButton, cn } from './ui';
import { fridgeKey, normalizeName } from '../lib/availability';
import { ingredientCost, dishCost, formatCost } from '../lib/pricing';
import { getExpiryStatus } from '../lib/shelfLife';
import type { CookingSession } from '../lib/cookingSession';
import { clearCookingSession, saveCookingSession } from '../lib/cookingSession';
import type { CookResult, Dish, FridgeItem } from '../lib/types';

interface CookingModeProps {
  dish: Dish;
  fridgeIndex: Map<string, FridgeItem>;
  initialSession: CookingSession;
  onClose: () => void;
  onCancelled: () => void;
  onCook: (dishId: string, operationId: string) => Promise<CookResult>;
  onCompleted: () => void;
}

export default function CookingMode({ dish, fridgeIndex, initialSession, onClose, onCancelled, onCook, onCompleted }: CookingModeProps) {
  const [session, setSession] = useState(initialSession);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cookError, setCookError] = useState<string | null>(null);
  const [result, setResult] = useState<CookResult | null>(null);
  const cost = useMemo(() => dishCost(dish, fridgeIndex), [dish, fridgeIndex]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  useEffect(() => {
    setSession((current) => saveCookingSession(current));
  }, [session.phase, session.currentStep, session.preparedIngredients]);

  const update = (next: Partial<CookingSession>) => setSession((current) => ({ ...current, ...next }));
  const close = () => { saveCookingSession(session); onClose(); };
  const cancel = () => { clearCookingSession(); setCancelOpen(false); onCancelled(); };
  const phaseIndex = session.phase === 'prep' ? 0 : session.phase === 'steps' ? 1 : 2;

  const ingredientRows = dish.ingredients.map((ingredient, index) => {
    const product = fridgeIndex.get(fridgeKey(ingredient.name, ingredient.unit));
    const expired = product ? getExpiryStatus(product.expiresAt) === 'expired' : false;
    const enough = Boolean(product && product.amount >= ingredient.amount && !expired);
    return { ingredient, index, product, expired, enough, cost: ingredientCost(ingredient, fridgeIndex) };
  });
  const canWriteOff = ingredientRows.every((row) => row.enough);

  const finish = async () => {
    if (!canWriteOff || busy) return;
    const operationId = session.operationId ?? crypto.randomUUID();
    const withOperation = saveCookingSession({ ...session, operationId });
    setSession(withOperation);
    setBusy(true);
    setCookError(null);
    try {
      const nextResult = await onCook(dish.id, operationId);
      if (!nextResult.success) {
        setCookError(nextResult.missing.length ? `Не хватает: ${nextResult.missing.map((item) => item.name).join(', ')}` : 'Сервер отклонил списание.');
        return;
      }
      clearCookingSession();
      setResult(nextResult);
    } catch (caught) {
      setCookError(caught instanceof Error ? caught.message : 'Не удалось подтвердить списание. Повтор использует тот же идентификатор операции.');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[200] min-h-[100dvh] overflow-y-auto overscroll-contain bg-cream-100 text-ink" role="dialog" aria-modal="true" aria-label={`Готовим: ${dish.title}`}>
      <div className="mx-auto flex min-h-[100dvh] max-w-[1100px] flex-col px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] pt-[max(1rem,env(safe-area-inset-top,0px))] sm:px-6 sm:pt-6">
        <header className="relative flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-display text-xl font-extrabold sm:text-2xl">{dish.title}</h1>
            <p className="mt-1 text-sm text-ink-muted">Режим готовки{dish.timeMin ? ` · ${dish.timeMin} минут` : ''}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <IconButton label="Дополнительные действия" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal className="size-5" /></IconButton>
            <IconButton label="Закрыть и сохранить" onClick={close}><X className="size-5" /></IconButton>
          </div>
          {menuOpen ? <div className="absolute right-12 top-12 z-10 rounded-xl border border-cream-300 bg-white p-2 shadow-lift"><Button variant="danger" size="sm" onClick={() => { setMenuOpen(false); setCancelOpen(true); }}>Отменить готовку</Button></div> : null}
        </header>

        <div className="my-4 flex gap-1.5" aria-label={`Этап ${phaseIndex + 1} из 3`}>
          {[0, 1, 2].map((index) => <span key={index} className={cn('h-2 flex-1 rounded-full', index <= phaseIndex ? 'bg-terra-500' : 'bg-cream-300')} />)}
        </div>

        {result?.success ? (
          <main className="mx-auto grid w-full max-w-[660px] flex-1 place-items-center text-center">
            <Card className="w-full p-8"><span className="mx-auto grid size-14 place-items-center rounded-full bg-green-50 text-green-700"><Check className="size-7" /></span><h2 className="mt-4 font-display text-3xl font-extrabold">Готовка завершена</h2><p className="mt-2 text-ink-soft">Ингредиенты списаны одной серверной операцией.</p><p className="mt-3 font-bold">Стоимость: {result.costComplete ? `${(result.cost ?? 0).toFixed(2)} ₽` : `≈ ${(result.cost ?? 0).toFixed(2)} ₽, данные неполные`}</p><Button className="mt-6" size="lg" onClick={onCompleted}>Вернуться к рецепту</Button></Card>
          </main>
        ) : session.phase === 'prep' ? (
          <main className="mx-auto w-full max-w-[660px]">
            <h2 className="font-display text-2xl font-extrabold sm:text-3xl">Подготовка ингредиентов</h2>
            <p className="mt-2 text-sm text-ink-soft">Отметьте подготовленные продукты. Галочки не изменяют запасы.</p>
            <Card className="mt-5 divide-y divide-cream-300 p-0">
              {ingredientRows.map(({ ingredient, index, expired, enough, product }) => (
                <label key={`${normalizeName(ingredient.name)}-${ingredient.unit}-${index}`} className="flex cursor-pointer items-center gap-3 px-4 py-3">
                  <input type="checkbox" className="size-5 accent-terra-500" checked={session.preparedIngredients.includes(index)} onChange={() => update({ preparedIngredients: session.preparedIngredients.includes(index) ? session.preparedIngredients.filter((item) => item !== index) : [...session.preparedIngredients, index] })} />
                  <span className="min-w-0 flex-1"><strong className="block truncate">{ingredient.name}</strong><small className={expired ? 'text-berry-700' : enough ? 'text-green-700' : 'text-honey-700'}>{expired ? 'Просрочен — нельзя списать' : enough ? 'Есть в холодильнике' : `Не хватает: есть ${product?.amount ?? 0} ${ingredient.unit}`}</small></span>
                  <strong className="shrink-0 text-sm">{ingredient.amount} {ingredient.unit}</strong>
                </label>
              ))}
            </Card>
            <div className="mt-5 flex justify-end"><Button size="lg" onClick={() => update({ phase: dish.steps.length ? 'steps' : 'confirm', currentStep: 0 })}>Начать готовить</Button></div>
          </main>
        ) : null}

        {session.phase === 'steps' ? (
          <main className="grid flex-1 gap-5 md:grid-cols-[minmax(0,1.7fr)_minmax(235px,.8fr)]">
            <section className="min-w-0">
              <div className="flex items-center justify-between gap-3"><h2 className="font-display text-xl font-extrabold">Шаг {session.currentStep + 1} из {dish.steps.length}</h2><span className="rounded-full bg-terra-50 px-3 py-1 text-xs font-bold text-terra-700">{Math.round(((session.currentStep + 1) / dish.steps.length) * 100)}%</span></div>
              <div className="my-4 flex gap-1" aria-label="Прогресс шагов">{dish.steps.map((_, index) => <button key={index} aria-label={`Перейти к шагу ${index + 1}`} onClick={() => update({ currentStep: index })} className={cn('h-2 flex-1 rounded-full', index <= session.currentStep ? 'bg-terra-500' : 'bg-cream-300')} />)}</div>
              <Card className="flex min-h-[240px] items-center p-6 sm:min-h-[280px] sm:p-8"><p className="font-display text-[clamp(1.4rem,4vw,2.25rem)] font-extrabold leading-snug">{dish.steps[session.currentStep]}</p></Card>
              <details className="mt-4 rounded-2xl border border-cream-300 bg-white p-4 md:hidden"><summary className="cursor-pointer font-bold">Посмотреть ингредиенты</summary><IngredientList rows={ingredientRows} /></details>
              <div className="sticky bottom-0 mt-5 flex gap-2 bg-cream-100 py-3 pb-[max(.75rem,env(safe-area-inset-bottom,0px))]">
                <Button variant="ghost" size="lg" className="flex-1" onClick={() => session.currentStep === 0 ? update({ phase: 'prep' }) : update({ currentStep: session.currentStep - 1 })}><ChevronLeft className="size-5" />Назад</Button>
                <Button size="lg" className="flex-1" onClick={() => session.currentStep === dish.steps.length - 1 ? update({ phase: 'confirm' }) : update({ currentStep: session.currentStep + 1 })}>{session.currentStep === dish.steps.length - 1 ? 'К завершению' : 'Далее'}<ChevronRight className="size-5" /></Button>
              </div>
            </section>
            <aside className="hidden md:block"><Card className="sticky top-6"><h3 className="font-display text-lg font-extrabold">Ингредиенты</h3><IngredientList rows={ingredientRows} /><h3 className="mt-5 font-display text-lg font-extrabold">Шаги</h3><div className="mt-2 grid gap-1">{dish.steps.map((step, index) => <button key={index} className={cn('rounded-lg px-3 py-2 text-left text-xs', index === session.currentStep ? 'bg-terra-50 font-bold text-terra-700' : 'hover:bg-cream-100')} onClick={() => update({ currentStep: index })}>{index + 1}. {step.slice(0, 55)}</button>)}</div></Card></aside>
          </main>
        ) : null}

        {session.phase === 'confirm' ? (
          <main className="mx-auto w-full max-w-[660px]">
            <h2 className="font-display text-2xl font-extrabold sm:text-3xl">Подтвердите приготовление</h2>
            <p className="mt-2 text-sm text-ink-soft">До подтверждения продукты не списываются.</p>
            <Card className="mt-5 divide-y divide-cream-300 p-0">{ingredientRows.map(({ ingredient, cost: rowCost }) => <div key={`${ingredient.name}-${ingredient.unit}`} className="flex items-center justify-between gap-3 px-4 py-3"><span><strong className="block">{ingredient.name}</strong><small className="text-ink-muted">{formatCost(rowCost)}</small></span><strong>{ingredient.amount} {ingredient.unit}</strong></div>)}</Card>
            <div className="mt-4 rounded-xl bg-terra-50 p-4 text-sm text-terra-800"><strong>Примерная стоимость: {formatCost(cost)}</strong>{cost.status !== 'exact' ? <p className="mt-1">Стоимость известна не для всех ингредиентов; неизвестная часть не считается нулём.</p> : null}</div>
            {!canWriteOff ? <div className="mt-4 rounded-xl bg-honey-50 p-4 text-sm text-honey-800">Списание недоступно: сервер должен подтвердить достаточный непросроченный остаток всех ингредиентов.</div> : null}
            {cookError ? <div role="alert" className="mt-4 rounded-xl bg-berry-50 p-4 text-sm text-berry-700">{cookError}</div> : null}
            <div className="mt-5 flex gap-2"><Button variant="ghost" size="lg" className="flex-1" disabled={busy} onClick={() => update({ phase: dish.steps.length ? 'steps' : 'prep' })}><ChevronLeft className="size-5" />К шагам</Button><Button size="lg" className="flex-1" disabled={!canWriteOff || busy} onClick={() => void finish()}><Check className="size-5" />{busy ? 'Списываем…' : cookError ? 'Повторить списание' : 'Приготовлено — списать'}</Button></div>
          </main>
        ) : null}
      </div>

      <ConfirmDialog layer="cooking" open={cancelOpen} title="Отменить готовку?" description="Сохранённый прогресс будет удалён. Остатки холодильника не изменятся." actions={[{ label: 'Отменить готовку', value: 'cancel-cooking', variant: 'danger' }, { label: 'Продолжить', value: 'keep', variant: 'ghost' }]} onResolve={(value) => value === 'cancel-cooking' ? cancel() : setCancelOpen(false)} />
    </div>,
    document.body
  );
}

function IngredientList({ rows }: { rows: Array<{ ingredient: Dish['ingredients'][number]; enough: boolean; expired: boolean }> }) {
  return <div className="mt-3 divide-y divide-cream-300">{rows.map(({ ingredient, enough, expired }) => <div key={`${ingredient.name}-${ingredient.unit}`} className="flex items-center justify-between gap-2 py-2 text-sm"><span className="min-w-0 truncate">{ingredient.name}</span><span className={cn('shrink-0 font-bold', expired ? 'text-berry-700' : enough ? 'text-green-700' : 'text-honey-700')}>{ingredient.amount} {ingredient.unit}</span></div>)}</div>;
}
