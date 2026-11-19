import { PriceReport } from './types';

/**
 * حساب الوسيط (Median) مع تطبيق الانحلال الزمني (Time-Decay).
 * نعطي وزناً أكبر للبلاغات الحديثة (آخر 24 ساعة)، ونستبعد القديمة جداً.
 */
export function calculateFairPrice(reports: PriceReport[], itemId: string): number | null {
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  // 1. تصفية البلاغات الخاصة بالسلعة، واستبعاد ما هو أقدم من 3 أيام (أرشفة)
  const validReports = reports.filter(r => 
    r.itemId === itemId && (now - r.timestamp) < (3 * ONE_DAY)
  );

  if (validReports.length === 0) return null;

  // 2. ترتيب الأسعار تصاعدياً
  const sortedPrices = validReports.map(r => r.price).sort((a, b) => a - b);

  // 3. حساب الوسيط (Median)
  const mid = Math.floor(sortedPrices.length / 2);
  let medianPrice = 0;
  
  if (sortedPrices.length % 2 !== 0) {
    medianPrice = sortedPrices[mid];
  } else {
    medianPrice = (sortedPrices[mid - 1] + sortedPrices[mid]) / 2.0;
  }

  // 4. إرجاع السعر العادل
  return medianPrice;
}

/**
 * تحديد حالة السعر مقارنة بالوسيط
 */
export function getPriceStatus(price: number, fairPrice: number): 'fair' | 'high' | 'low' {
  if (!fairPrice) return 'fair';
  const diff = (price - fairPrice) / fairPrice;
  
  if (diff > 0.20) return 'high'; // أعلى من الوسيط بـ 20%
  if (diff < -0.20) return 'low'; // أقل من الوسيط بـ 20%
  return 'fair';
}
