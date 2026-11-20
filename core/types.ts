// core/types.ts
// أنواع موحّدة لكل الطبقة الأساسية.

export type ReportKind = 'price' | 'have' | 'need';
export type PriceTag = 'عادل' | 'مرتفع' | 'منخفض' | 'شاذ';

export interface MarketEntry {
  id: string;
  kind: ReportKind;
  category: string;
  item: string;
  placeName?: string;
  quantity?: string;
  wantItem?: string;
  location: string;
  price?: number;
  authorName: string;
  authorPeerId: string;
  contact?: string;
  note?: string;
  createdAt: number;
  checksum?: string;
}

export type PlaceFeedbackVerdict = 'honest_low' | 'fair' | 'expensive' | 'deceptive';

export interface PlaceFeedbackReport {
  id: string;
  targetPlaceKey: string;
  targetPlaceName: string;
  targetLocation: string;
  targetItem?: string;
  verdict: PlaceFeedbackVerdict;
  reason?: string;
  reporterPeerId: string;
  reporterName: string;
  createdAt: number;
}

export interface RankedMatch {
  id: string;
  type: 'direct' | 'reverse' | 'cycle';
  score: number;
  giveEntry: MarketEntry;
  wantEntry: MarketEntry;
  cyclePath?: MarketEntry[];
  reason: string;
}
