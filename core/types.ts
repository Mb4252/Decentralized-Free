export interface PriceReport {
  id: string;
  itemId: string;      // مثال: "flour_1kg", "sugar_1kg"
  itemName: string;    // الاسم المعروض
  price: number;       // السعر بالعملة المحلية
  unitRef: number;     // ما يعادله بوحدة مرجعية (مثلاً كجم دقيق)
  location: string;    // الحي/المنطقة
  timestamp: number;
}

export interface BarterOffer {
  id: string;
  type: 'offer' | 'need';
  userId: string;      // معرف عشوائي للمستخدم (لعدم كشف هويته)
  itemId: string;
  itemName: string;
  quantity: string;    // مثال: "10 كجم"
  location: string;
  timestamp: number;
  matchedWith?: string; // معرف العرض المطابق
}

export interface MatchResult {
  type: 'direct' | 'cycle';
  path: BarterOffer[]; // مسار التبادل (أ -> ب -> ج -> أ)
}
