import { Transaction, validateTransaction } from './transaction';
import { verifySignature } from './crypto';
import { applyDemurrage } from './demurrage';

export interface LedgerEntry extends Transaction {
  index: number;
  prevHash: string;
  hash: string;
}

export interface Balance {
  address: string;
  hours: number;
  lastActivity: number;
}

/**
 * حساب الرصيد من السجل الكامل مع تطبيق ديناميكية الرصيد.
 * يتحقق رياضياً من أن لا أحد ينفق ساعات غير موجودة.
 */
export function computeBalances(entries: LedgerEntry[]): Map<string, Balance> {
  const balances = new Map<string, Balance>();

  const ensure = (addr: string, time: number) => {
    if (!balances.has(addr)) {
      balances.set(addr, { address: addr, hours: 0, lastActivity: time });
    }
    return balances.get(addr)!;
  };

  // ترتيب زمني
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);

  for (const entry of sorted) {
    const fromBal = ensure(entry.from, entry.timestamp);
    const toBal = ensure(entry.to, entry.timestamp);

    // تطبيق التراجع التدريجي قبل المعاملة (على أساس الوقت المنقضي)
    applyDemurrage(fromBal, entry.timestamp);
    applyDemurrage(toBal, entry.timestamp);

    // التحقق الرياضي: لا يمكن إنفاق أكثر من الرصيد
    if (fromBal.hours < entry.hours) {
      // معاملة غير صالحة — نتجاهلها (السجل لا يقبل التلاعب)
      continue;
    }

    fromBal.hours -= entry.hours;
    toBal.hours += entry.hours;
    fromBal.lastActivity = entry.timestamp;
    toBal.lastActivity = entry.timestamp;
  }

  return balances;
}

/** التحقق من سلسلة السجل (Hash chain) */
export async function computeHash(entry: Omit<LedgerEntry, 'hash'>): Promise<string> {
  const data = JSON.stringify(entry);
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** إضافة معاملة إلى السجل مع التحقق الكامل */
export async function appendToLedger(
  ledger: LedgerEntry[],
  tx: Transaction
): Promise<{ ledger: LedgerEntry[]; error?: string }> {
  if (!validateTransaction(tx)) {
    return { ledger, error: 'معاملة غير صالحة' };
  }

  // التحقق من التوقيع
  const { signature, ...unsigned } = tx;
  if (!verifySignature(JSON.stringify(unsigned), signature, tx.publicKey)) {
    return { ledger, error: 'توقيع المعاملة غير صالح' };
  }

  // التحقق من الرصيد
  const balances = computeBalances(ledger);
  const senderBal = balances.get(tx.from)?.hours ?? 0;
  if (senderBal < tx.hours) {
    return { ledger, error: `الرصيد غير كافٍ. المتاح: ${senderBal.toFixed(2)} ساعة` };
  }

  // منع إعادة الإنفاق (Double Spending) — التحقق من عدم وجود نفس id
  if (ledger.some((e) => e.id === tx.id)) {
    return { ledger, error: 'معاملة مكررة' };
  }

  const prevHash = ledger.length > 0 ? ledger[ledger.length - 1].hash : '0'.repeat(64);
  const index = ledger.length;
  const partial = { ...tx, index, prevHash };
  const hash = await computeHash(partial);
  const entry: LedgerEntry = { ...partial, hash };

  return { ledger: [...ledger, entry] };
}

/** إنشاء الرصيد الافتتاحي (عطاء تأسيسي) */
export function createGenesisEntry(address: string, hours: number, publicKey: string): Transaction {
  return {
    id: 'genesis-' + address,
    from: 'CHR-GENESIS',
    to: address,
    hours,
    memo: 'عطاء تأسيسي',
    timestamp: Date.now(),
    signature: 'genesis',
    publicKey,
  };
}
