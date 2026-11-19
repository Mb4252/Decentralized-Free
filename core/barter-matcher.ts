import { BarterOffer, MatchResult } from './types';

/**
 * البحث عن مطابقات مباشرة ودائرية (A -> B -> C -> A)
 */
export function findMatches(offers: BarterOffer[]): MatchResult[] {
  const matches: MatchResult[] = [];
  const usedIds = new Set<string>();

  // 1. المطابقة المباشرة (Direct)
  for (const offer of offers) {
    if (offer.type !== 'offer' || usedIds.has(offer.id)) continue;
    
    for (const need of offers) {
      if (need.type !== 'need' || usedIds.has(need.id)) continue;
      
      // إذا كان ما أملكه يطابق ما تحتاجه (ويشترطان نفس الحي)
      if (offer.itemId === need.itemId && offer.location === need.location) {
        matches.push({ type: 'direct', path: [offer, need] });
        usedIds.add(offer.id);
        usedIds.add(need.id);
        break;
      }
    }
  }

  // 2. المطابقة الدائرية الثلاثية (A -> B -> C -> A)
  // نبحث عن: A يملك ما يحتاجه B، و B يملك ما يحتاجه C، و C يملك ما يحتاجه A
  const availableOffers = offers.filter(o => !usedIds.has(o.id));

  for (const a of availableOffers) {
    if (a.type !== 'offer') continue;
    for (const b of availableOffers) {
      if (b.type !== 'offer' || a.id === b.id) continue;
      for (const c of availableOffers) {
        if (c.type !== 'offer' || c.id === b.id || c.id === a.id) continue;

        // نتحقق من الشروط
        const aMatchesB = availableOffers.some(n => n.type === 'need' && n.itemId === a.itemId);
        const bMatchesC = availableOffers.some(n => n.type === 'need' && n.itemId === b.itemId);
        const cMatchesA = availableOffers.some(n => n.type === 'need' && n.itemId === c.itemId);

        if (aMatchesB && bMatchesC && cMatchesA) {
          matches.push({ type: 'cycle', path: [a, b, c] });
          usedIds.add(a.id);
          usedIds.add(b.id);
          usedIds.add(c.id);
          break;
        }
      }
    }
  }

  return matches;
}
