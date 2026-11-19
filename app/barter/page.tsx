'use client';

import { useState } from 'react';
import { useApp } from '@/lib/context';

export default function BarterPage() {
  const { barterOffers, matches, removeEntry } = useApp();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyContact = async (matchId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(matchId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(matchId);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  return (
    <div className="mt-4 space-y-5 pb-24">
      <div className="card space-y-1">
        <h1 className="text-xl font-bold text-slate-900">سوق المقايضة</h1>
        <p className="text-sm text-slate-600">
          مطابقات ذكية بين العروض والطلبات مع إظهار الأطراف وبيانات التواصل للتبديل.
        </p>
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-slate-900">🤝 المطابقات الذكية المكتشفة</h2>

        {matches.length === 0 ? (
          <p className="text-sm text-slate-500">
            لا توجد مطابقات حالياً. أضف عرضك أو طلبك.
          </p>
        ) : (
          <div className="space-y-3">
            {matches.map((match) => {
              const contactInfo = [
                `المطابقة: ${match.summary}`,
                `الطرف الأول (${match.firstParty.authorName} - ${match.firstParty.authorPeerId}): يملك ${match.firstParty.item}${
                  match.firstParty.quantity ? ` (${match.firstParty.quantity})` : ''
                } | الموقع: ${match.firstParty.location}${
                  match.firstParty.contact ? ` | تواصل: ${match.firstParty.contact}` : ''
                }`,
                `الطرف الثاني (${match.secondParty.authorName} - ${match.secondParty.authorPeerId}): يحتاج ${match.secondParty.item}${
                  match.secondParty.quantity ? ` (${match.secondParty.quantity})` : ''
                } | الموقع: ${match.secondParty.location}${
                  match.secondParty.contact ? ` | تواصل: ${match.secondParty.contact}` : ''
                }`,
              ].join('\n');

              return (
                <div
                  key={match.id}
                  className="p-3 rounded-lg border border-teal-200 bg-teal-50/50 space-y-2"
                >
                  <div className="text-sm font-bold text-teal-900">{match.summary}</div>

                  <div className="grid grid-cols-1 gap-2 text-xs text-slate-700">
                    <div className="p-2 rounded bg-white border border-slate-200">
                      <strong>العارض:</strong> {match.firstParty.authorName} ({match.firstParty.authorPeerId}) — يملك{' '}
                      <strong>{match.firstParty.item}</strong>
                      {match.firstParty.quantity ? ` (${match.firstParty.quantity})` : ''} — 📍 {match.firstParty.location}
                      {match.firstParty.contact && (
                        <div className="mt-1 text-teal-800 font-medium">📞 تواصل: {match.firstParty.contact}</div>
                      )}
                    </div>

                    <div className="p-2 rounded bg-white border border-slate-200">
                      <strong>الطالب:</strong> {match.secondParty.authorName} ({match.secondParty.authorPeerId}) — يحتاج{' '}
                      <strong>{match.secondParty.item}</strong>
                      {match.secondParty.quantity ? ` (${match.secondParty.quantity})` : ''} — 📍 {match.secondParty.location}
                      {match.secondParty.contact && (
                        <div className="mt-1 text-teal-800 font-medium">📞 تواصل: {match.secondParty.contact}</div>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCopyContact(match.id, contactInfo)}
                    className="w-full py-2 px-3 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 transition"
                  >
                    {copiedId === match.id ? '✅ تم نسخ تفاصيل التبديل والتواصل' : '📋 نسخ تفاصيل التبديل والتواصل'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card space-y-3">
        <h2 className="font-bold text-slate-900">كل العروض والطلبات</h2>

        {barterOffers.length === 0 ? (
          <p className="text-sm text-slate-500">لا توجد عروض بعد.</p>
        ) : (
          <div className="space-y-2.5">
            {barterOffers.map((offer) => (
              <div
                key={offer.id}
                className="p-3 rounded-lg border border-slate-200 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-bold ${
                      offer.kind === 'have'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {offer.kind === 'have' ? 'أملك' : 'أحتاج'}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeEntry(offer.id)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    حذف
                  </button>
                </div>

                <div className="font-bold text-slate-900">
                  {offer.item} {offer.quantity ? `(${offer.quantity})` : ''}
                </div>

                {offer.wantItem && (
                  <div className="text-xs text-teal-800 font-medium">
                    المقابل المطلوب: {offer.wantItem}
                  </div>
                )}

                <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                  <span>📍 {offer.location}</span>
                  <span>
                    بواسطة: <strong>{offer.authorName}</strong> ({offer.authorPeerId})
                  </span>
                  {offer.contact && <span>📞 {offer.contact}</span>}
                </div>

                {offer.note && <p className="text-xs text-slate-500">{offer.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
