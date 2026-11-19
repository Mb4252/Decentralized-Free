'use client';

import { useState } from 'react';
import { useWallet } from '@/lib/context';

export default function WalletPage() {
  const { wallet, createNewWallet, restoreFromSeed, logout } = useWallet();
  const [seedInput, setSeedInput] = useState('');
  const [showSeed, setShowSeed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleCreate = async () => {
    setBusy(true);
    setError('');
    try {
      await createNewWallet();
      setShowSeed(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async () => {
    setBusy(true);
    setError('');
    try {
      await restoreFromSeed(seedInput.trim());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (wallet) {
    return (
      <div className="space-y-4 mt-4">
        <div className="card">
          <h2 className="font-bold text-chronos-800 mb-2">محفظتك</h2>
          <p className="text-xs text-slate-500 mb-1">العنوان:</p>
          <p className="font-mono text-sm break-all" dir="ltr">
            {wallet.address}
          </p>
          <p className="text-xs text-slate-500 mt-3 mb-1">المفتاح العام:</p>
          <p className="font-mono text-xs break-all text-slate-600" dir="ltr">
            {wallet.publicKey}
          </p>
        </div>
        <div className="card">
          <h3 className="font-bold text-red-700 mb-2">⚠️ عبارة الاسترداد</h3>
          <p className="text-sm text-slate-600 mb-3">
            احفظ هذه الكلمات في مكان آمن. هي الطريقة الوحيدة لاستعادة محفظتك.
          </p>
          {showSeed ? (
            <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-4 font-mono text-sm">
              {wallet.seedPhrase}
            </div>
          ) : (
            <button className="btn-secondary" onClick={() => setShowSeed(true)}>
              إظهار عبارة الاسترداد
            </button>
          )}
        </div>
        <button className="btn-secondary w-full" onClick={logout}>
          تسجيل الخروج (مسح المحفظة من هذا الجهاز)
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-4">
      <div className="card space-y-3">
        <h2 className="font-bold text-chronos-800">إنشاء محفظة جديدة</h2>
        <p className="text-sm text-slate-600">
          سيتم توليد 12 كلمة سرية (Seed Phrase). احفظها بعناية.
        </p>
        <button className="btn-primary w-full" onClick={handleCreate} disabled={busy}>
          {busy ? 'جارٍ الإنشاء...' : 'إنشاء محفظة'}
        </button>
      </div>
      <div className="card space-y-3">
        <h2 className="font-bold text-chronos-800">استعادة محفظة</h2>
        <textarea
          className="input-field font-mono"
          rows={3}
          value={seedInput}
          onChange={(e) => setSeedInput(e.target.value)}
          placeholder="أدخل الكلمات الـ12 مفصولة بمسافات"
        />
        <button className="btn-secondary w-full" onClick={handleRestore} disabled={busy}>
          {busy ? 'جارٍ الاستعادة...' : 'استعادة'}
        </button>
      </div>
      {error && (
        <div className="bg-red-100 text-red-800 p-3 rounded-xl text-sm">{error}</div>
      )}
    </div>
  );
}
