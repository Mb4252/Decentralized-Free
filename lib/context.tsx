'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Wallet, loadCurrentWallet, createWallet, restoreWallet } from '@/core/wallet';
import { LedgerEntry, computeBalances, appendToLedger, createGenesisEntry } from '@/core/ledger';
import { loadLedger, saveLedger, loadServices, saveServices, clearWallet } from '@/core/storage';
import { Transaction, createTransaction } from '@/core/transaction';

interface Service {
  id: string;
  title: string;
  description: string;
  hours: number;
  owner: string;
  createdAt: number;
}

interface WalletContextType {
  wallet: Wallet | null;
  ledger: LedgerEntry[];
  services: Service[];
  balance: number;
  loading: boolean;
  createNewWallet: () => Promise<void>;
  restoreFromSeed: (seed: string) => Promise<void>;
  logout: () => Promise<void>;
  sendHours: (to: string, hours: number, memo: string) => Promise<string>;
  addService: (title: string, description: string, hours: number) => Promise<void>;
  refresh: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const w = await loadCurrentWallet();
    setWallet(w);
    const l = await loadLedger();
    setLedger(l);
    const s = await loadServices();
    setServices(s);
    if (w) {
      const balances = computeBalances(l);
      setBalance(balances.get(w.address)?.hours ?? 0);
    }
  };

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, []);

  const createNewWallet = async () => {
    const w = await createWallet();
    setWallet(w);
    // عطاء تأسيسي: 10 ساعات لمن يبدأ (لتحريك الاقتصاد)
    const genesis = createGenesisEntry(w.address, 10, w.publicKey);
    const result = await appendToLedger([], genesis);
    await saveLedger(result.ledger);
    await refresh();
  };

  const restoreFromSeed = async (seed: string) => {
    const w = await restoreWallet(seed);
    setWallet(w);
    await refresh();
  };

  const logout = async () => {
    await clearWallet();
    setWallet(null);
    setBalance(0);
    setLedger([]);
  };

  const sendHours = async (to: string, hours: number, memo: string): Promise<string> => {
    if (!wallet) throw new Error('لا توجد محفظة');
    const tx: Transaction = createTransaction({
      from: wallet.address,
      to,
      hours,
      memo,
      secretKey: wallet.keyPair.secretKey,
      publicKey: wallet.keyPair.publicKey,
    });
    const result = await appendToLedger(ledger, tx);
    if (result.error) throw new Error(result.error);
    setLedger(result.ledger);
    await saveLedger(result.ledger);
    const balances = computeBalances(result.ledger);
    setBalance(balances.get(wallet.address)?.hours ?? 0);
    return tx.id;
  };

  const addService = async (title: string, description: string, hours: number) => {
    if (!wallet) throw new Error('لا توجد محفظة');
    const service: Service = {
      id: crypto.randomUUID(),
      title,
      description,
      hours,
      owner: wallet.address,
      createdAt: Date.now(),
    };
    const updated = [...services, service];
    setServices(updated);
    await saveServices(updated);
  };

  return (
    <WalletContext.Provider
      value={{
        wallet,
        ledger,
        services,
        balance,
        loading,
        createNewWallet,
        restoreFromSeed,
        logout,
        sendHours,
        addService,
        refresh,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
