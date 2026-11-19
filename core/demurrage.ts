import { Balance } from './ledger';

/** معدل التراجع الشهري: 0.5% */
export const MONTHLY_DEMURRAGE_RATE = 0.005;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * تطبيق التراجع التدريجي على رصيد معطل.
 * الفلسفة: منع كنز الثروة وإجبارها على الدوران.
 * الحساب: كل شهر كامل بلا نشاط → خصم 0.5% من الرصيد.
 * (خصم بسيط غير مركب — لا ربا)
 */
export function applyDemurrage(balance: Balance, now: number): void {
  if (balance.hours <= 0) {
    balance.lastActivity = now;
    return;
  }
  const elapsed = now - balance.lastActivity;
  if (elapsed < MONTH_MS) return;

  const months = Math.floor(elapsed / MONTH_MS);
  // خصم بسيط لكل شهر (غير مركب) — عدالة تامة
  let deduction = 0;
  for (let i = 0; i < months; i++) {
    deduction += balance.hours * MONTHLY_DEMURRAGE_RATE;
  }
  // لا يتجاوز الخصم 50% من الرصيد في أي حال
  deduction = Math.min(deduction, balance.hours * 0.5);

  balance.hours -= deduction;
  balance.lastActivity = now;
}

/** حساب الرصيد بعد التراجع دون تعديل الأصل */
export function previewDemurrage(balance: Balance, now: number): number {
  const copy = { ...balance };
  applyDemurrage(copy, now);
  return copy.hours;
}
