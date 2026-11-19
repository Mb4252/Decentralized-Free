import { v4 as uuidv4 } from 'uuid';
import { signMessage } from './crypto';

export interface Transaction {
  id: string;
  from: string;        // عنوان المرسل
  to: string;          // عنوان المستقبل
  hours: number;       // ساعات العطاء
  memo: string;        // وصف الخدمة/السلعة
  timestamp: number;
  signature: string;   // توقيع المرسل
  publicKey: string;   // المفتاح العام للمرسل
}

/** إنشاء معاملة جديدة موقعة */
export function createTransaction(params: {
  from: string;
  to: string;
  hours: number;
  memo: string;
  secretKey: string;
  publicKey: string;
}): Transaction {
  if (params.hours <= 0) {
    throw new Error('عدد الساعات يجب أن يكون أكبر من صفر');
  }
  if (params.from === params.to) {
    throw new Error('لا يمكن التحويل إلى نفس المحفظة');
  }
  if (!params.to.startsWith('CHR-')) {
    throw new Error('عنوان المستقبل غير صالح');
  }

  const tx: Omit<Transaction, 'signature'> = {
    id: uuidv4(),
    from: params.from,
    to: params.to,
    hours: Math.round(params.hours * 100) / 100, // دقة منزلتين
    memo: params.memo || 'عطاء بدون وصف',
    timestamp: Date.now(),
    publicKey: params.publicKey,
  };

  // الرسالة الموقعة = المحتوى الكامل بدون التوقيع
  const message = JSON.stringify(tx);
  const signature = signMessage(message, params.secretKey);

  return { ...tx, signature };
}

/** التحقق من سلامة المعاملة */
export function validateTransaction(tx: Transaction): boolean {
  if (!tx.id || !tx.from || !tx.to) return false;
  if (tx.hours <= 0) return false;
  if (tx.from === tx.to) return false;
  if (!tx.to.startsWith('CHR-')) return false;
  return true;
}
