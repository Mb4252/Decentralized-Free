// core/normalization.ts

export function normalizeGeoText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^a-zA-Z0-9\u0600-\u06FF\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * درجة قرب جغرافي 0..1
 * - تطابق تام: 1
 * - نفس الجزء الأول + جزأين مشتركين: 0.9
 * - نفس الجزء الأول (مدينة) فقط: 0.7
 * - لا تطابق: 0
 */
export function geoProximity(a?: string | null, b?: string | null): number {
  if (!a || !b) return 0;
  const na = normalizeGeoText(a);
  const nb = normalizeGeoText(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const partsA = na.split(/[\s-]+/).filter(Boolean);
  const partsB = nb.split(/[\s-]+/).filter(Boolean);
  if (partsA[0] && partsB[0] && partsA[0] === partsB[0]) {
    const shared = partsA.filter((p) => partsB.includes(p)).length;
    if (shared >= 2) return 0.9;
    return 0.7;
  }
  return 0;
}
