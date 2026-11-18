import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';

const DB_NAME = 'chronos-value-db';
const STORE = 'wallet';
const PASSWORD_KEY = 'chronos-session-key';

export interface WalletData {
  address: string;
  publicKey: string;
  seedPhrase: string;
  createdAt: number;
  keyPair?: any;
}

/** مفتاح تشفير الجلسة (يُخزن في sessionStorage وليس localStorage) */
function getSessionKey(): Uint8Array {
  const stored = sessionStorage.getItem(PASSWORD_KEY);
  if (stored) return naclUtil.decodeBase64(stored);
  const key = nacl.randomBytes(32);
  sessionStorage.setItem(PASSWORD_KEY, naclUtil.encodeBase64(key));
  return key;
}

function encrypt(data: string): string {
  const key = getSessionKey();
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const encrypted = nacl.secretbox(naclUtil.decodeUTF8(data), nonce, key);
  const combined = new Uint8Array(nonce.length + encrypted.length);
  combined.set(nonce);
  combined.set(encrypted, nonce.length);
  return naclUtil.encodeBase64(combined);
}

function decrypt(cipher: string): string {
  try {
    const key = getSessionKey();
    const combined = naclUtil.decodeBase64(cipher);
    const nonce = combined.slice(0, nacl.secretbox.nonceLength);
    const encrypted = combined.slice(nacl.secretbox.nonceLength);
    const decrypted = nacl.secretbox.open(encrypted, nonce, key);
    if (!decrypted) throw new Error('فشل فك التشفير');
    return naclUtil.encodeUTF8(decrypted);
  } catch {
    return '';
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains('ledger')) db.createObjectStore('ledger');
      if (!db.objectStoreNames.contains('services')) db.createObjectStore('services');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function put(store: string, key: string, value: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function get(store: string, key: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWallet(wallet: WalletData): Promise<void> {
  const payload = JSON.stringify({
    address: wallet.address,
    publicKey: wallet.publicKey,
    seedPhrase: wallet.seedPhrase,
    createdAt: wallet.createdAt,
  });
  await put(STORE, 'current', encrypt(payload));
}

export async function loadWallet(): Promise<WalletData | null> {
  const encrypted = await get(STORE, 'current');
  if (!encrypted) return null;
  const json = decrypt(encrypted);
  if (!json) return null;
  try {
    return JSON.parse(json) as WalletData;
  } catch {
    return null;
  }
}

export async function clearWallet(): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete('current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** حفظ سجل المعاملات مشفراً */
export async function saveLedger(entries: any[]): Promise<void> {
  await put('ledger', 'main', encrypt(JSON.stringify(entries)));
}

export async function loadLedger(): Promise<any[]> {
  const encrypted = await get('ledger', 'main');
  if (!encrypted) return [];
  const json = decrypt(encrypted);
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}

export async function saveServices(services: any[]): Promise<void> {
  await put('services', 'main', encrypt(JSON.stringify(services)));
}

export async function loadServices(): Promise<any[]> {
  const encrypted = await get('services', 'main');
  if (!encrypted) return [];
  const json = decrypt(encrypted);
  if (!json) return [];
  try {
    return JSON.parse(json);
  } catch {
    return [];
  }
}
