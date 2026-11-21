'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/lib/context';

const SAVED_ZONES_KEY = 'fair_radar_verified_zones_v1';

interface VerifiedZone {
  name: string;
  verifiedVia: 'online' | 'manual';
  verifiedAt: number;
}

function cleanZoneName(raw?: string | null): string {
  if (!raw) return '';
  let text = raw.trim();
  const dashParts = text.split(' - ');
  if (dashParts.length > 1) {
    const last = dashParts[dashParts.length - 1].trim();
    if (/^(الجميع|شخصي|عام|خاص|دكان|مركز|محل|مغلق|بقالة|صيدلية|ورشة|سوق)\b/i.test(last)) {
      text = dashParts.slice(0, -1).join(' - ').trim();
    }
  }
  return text;
}

async function verifyZoneOnline(query: string): Promise<{ ok: boolean; canonicalName: string }> {
  const cleaned = cleanZoneName(query);
  if (!cleaned || cleaned.length < 2) {
    return { ok: false, canonicalName: cleaned };
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=ar&q=${encodeURIComponent(
      cleaned
    )}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, canonicalName: cleaned };
    const data = (await res.json()) as Array<{ display_name?: string; name?: string }>;
    if (!Array.isArray(data) || data.length === 0) {
      return { ok: false, canonicalName: cleaned };
    }
    const first = data[0];
    const shortDisplay =
      first.name && first.name.trim().length >= 2
        ? first.name.trim()
        : (first.display_name || cleaned).split(',')[0].trim();
    return { ok: true, canonicalName: shortDisplay || cleaned };
  } catch {
    return { ok: false, canonicalName: cleaned };
  }
}

export function GeoFocusBanner() {
  const { entries, activeZone, setActiveZone, syncNow } = useApp();

  const [savedZones, setSavedZones] = useState<VerifiedZone[]>([]);
  const [zoneInput, setZoneInput] = useState<string>('');
  const [checking, setChecking] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_ZONES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as VerifiedZone[];
        if (Array.isArray(parsed)) {
          setSavedZones(parsed);
        }
      }
    } catch {
      // تجاهل أخطاء التخزين المحلي
    }
  }, []);

  const persistZones = (list: VerifiedZone[]) => {
    setSavedZones(list);
    try {
      localStorage.setItem(SAVED_ZONES_KEY, JSON.stringify(list));
    } catch {
      // تجاهل أخطاء التخزين المحلي
    }
  };

  const addVerifiedZone = (name: string, verifiedVia: 'online' | 'manual') => {
    const cleaned = cleanZoneName(name);
    if (!cleaned) return;
    setSavedZones((prev) => {
      const exists = prev.some((z) => z.name.toLowerCase() === cleaned.toLowerCase());
      const next = exists
        ? prev.map((z) =>
            z.name.toLowerCase() === cleaned.toLowerCase()
              ? { ...z, verifiedVia: verifiedVia === 'online' ? 'online' : z.verifiedVia }
              : z
          )
        : [{ name: cleaned, verifiedVia, verifiedAt: Date.now() }, ...prev];
      persistZones(next);
      return next;
    });
  };

  const allZones = useMemo(() => {
    const map = new Map<string, string>();
    for (const z of savedZones) {
      const c = cleanZoneName(z.name);
      if (c && !map.has(c.toLowerCase())) {
        map.set(c.toLowerCase(), c);
      }
    }
    for (const e of entries) {
      const c = cleanZoneName(e.location);
      if (c && !map.has(c.toLowerCase())) {
        map.set(c.toLowerCase(), c);
      }
    }
    const currentClean = cleanZoneName(activeZone);
    if (currentClean && !map.has(currentClean.toLowerCase())) {
      map.set(currentClean.toLowerCase(), currentClean);
    }
    return Array.from(map.values());
  }, [savedZones, entries, activeZone]);

  const currentCleanZone = cleanZoneName(activeZone);

  const handleVerifyAndSaveZone = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = cleanZoneName(zoneInput);
    if (!cleaned) return;

    setChecking(true);
    setStatusMsg('جاري التحقق من وجود المنطقة عبر الإنترنت وحفظها...');
    const result = await verifyZoneOnline(cleaned);
    setChecking(false);

    const finalName = result.ok ? result.canonicalName : cleaned;
    addVerifiedZone(finalName, result.ok ? 'online' : 'manual');
    setActiveZone(finalName);
    setZoneInput('');

    if (result.ok) {
      setStatusMsg(`تم التحقق من وجود «${finalName}» عبر الإنترنت وحفظها في مناطقك.`);
    } else {
      setStatusMsg(`تم حفظ «${finalName}» في قائمة مناطقك وتفعيلها مباشرة.`);
    }
    setTimeout(() => setStatusMsg(''), 4000);
  };

  const handleSelectZone = (zoneValue: string) => {
    const cleaned = cleanZoneName(zoneValue);
    if (!cleaned) {
      setActiveZone('');
      return;
    }
    addVerifiedZone(cleaned, 'manual');
    setActiveZone(cleaned);
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-4 text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-emerald-300">
            {currentCleanZone
              ? `📍 منطقتك المحفوظة والمفعّلة: ${currentCleanZone}`
              : '🌍 الوضع العام (عرض كل المناطق)'}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            تحقق من منطقتك مرة واحدة ليتم حفظها وتقليل الضوضاء وعرض منشورات منطقتك بوضوح.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {currentCleanZone && (
            <button
              type="button"
              onClick={() => setActiveZone('')}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
            >
              عرض كل المناطق
            </button>
          )}
          <button
            type="button"
            onClick={() => syncNow()}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            مزامنة الأقران
          </button>
        </div>
      </div>

      {/* تحقق وحفظ منطقة جديدة */}
      <form onSubmit={handleVerifyAndSaveZone} className="flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={zoneInput}
          onChange={(e) => setZoneInput(e.target.value)}
          placeholder="اكتب اسم منطقتك أو مدينتك أو حيك للتحقق وحفظها (مثال: ود مدني، ام القرى)..."
          className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white placeholder-slate-400 focus:border-emerald-400 focus:outline-none"
        />
        <button
          type="submit"
          disabled={checking || !zoneInput.trim()}
          className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {checking ? 'جاري التحقق...' : 'تحقق واحفظ المنطقة'}
        </button>
      </form>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-950/70 px-3 py-1.5 text-xs text-emerald-200">
          {statusMsg}
        </div>
      )}

      {/* قائمة المناطق المحفوظة والمرصودة للاختيار السريع */}
      <div className="space-y-1.5">
        <div className="text-[11px] font-semibold text-slate-300">
          المناطق المحفوظة ({allZones.length}) — اضغط لاختيار منطقتك:
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => handleSelectZone('')}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              !currentCleanZone
                ? 'bg-emerald-600 text-white'
                : 'border border-slate-700 bg-slate-950 text-slate-300 hover:bg-slate-800'
            }`}
          >
            كل المناطق
          </button>
          {allZones.map((zone) => {
            const active = currentCleanZone.toLowerCase() === zone.toLowerCase();
            return (
              <button
                key={zone}
                type="button"
                onClick={() => handleSelectZone(zone)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-700 bg-slate-950 text-slate-200 hover:border-emerald-500/50'
                }`}
              >
                📍 {zone}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
