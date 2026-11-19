'use client';
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { PriceReport, BarterOffer } from '@/core/types';
import { calculateFairPrice } from '@/core/price-engine';
import { SyncEngine } from '@/core/sync';

interface AppContextType {
  prices: PriceReport[];
  barters: BarterOffer[];
  addPrice: (report: Omit<PriceReport, 'id' | 'timestamp'>) => void;
  addBarter: (offer: Omit<BarterOffer, 'id' | 'timestamp'>) => void;
  getFairPrice: (itemId: string) => number | null;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<PriceReport[]>([]);
  const [barters, setBarters] = useState<BarterOffer[]>([]);
  const [syncEngine, setSyncEngine] = useState<SyncEngine | null>(null);

  // 1. تحميل البيانات من التخزين المحلي
  useEffect(() => {
    const savedPrices = localStorage.getItem('fair_prices');
    const savedBarters = localStorage.getItem('fair_barters');
    
    if (savedPrices) setPrices(JSON.parse(savedPrices));
    if (savedBarters) setBarters(JSON.parse(savedBarters));

    // 2. تهيئة المزامنة (P2P)
    const engine = new SyncEngine();
    setSyncEngine(engine);

    // 3. الاستماع للرسائل الواردة من الأجهزة الأخرى (أو التبويبات)
    engine.onMessage((type, payload) => {
      if (type === 'NEW_PRICE') {
        setPrices(prev => {
          if (prev.some(p => p.id === payload.id)) return prev;
          return [...prev, payload];
        });
      }
      if (type === 'NEW_BARTER') {
        setBarters(prev => {
          if (prev.some(b => b.id === payload.id)) return prev;
          return [...prev, payload];
        });
      }
    });

    return () => engine.close();
  }, []);

  // 4. حفظ التغييرات في التخزين المحلي
  useEffect(() => {
    localStorage.setItem('fair_prices', JSON.stringify(prices));
  }, [prices]);

  useEffect(() => {
    localStorage.setItem('fair_barters', JSON.stringify(barters));
  }, [barters]);

  // 5. دوال إضافة البيانات
  const addPrice = (data: Omit<PriceReport, 'id' | 'timestamp'>) => {
    const newReport: PriceReport = {
      ...data,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };
    setPrices(prev => [...prev, newReport]);
    syncEngine?.broadcastPrice(newReport);
  };

  const addBarter = (data: Omit<BarterOffer, 'id' | 'timestamp'>) => {
    const newOffer: BarterOffer = {
      ...data,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    };
    setBarters(prev => [...prev, newOffer]);
    syncEngine?.broadcastBarter(newOffer);
  };

  const getFairPrice = (itemId: string) => {
    return calculateFairPrice(prices, itemId);
  };

  return (
    <AppContext.Provider value={{ prices, barters, addPrice, addBarter, getFairPrice }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
