import {
  generateSeedPhrase,
  deriveKeyPairFromSeed,
  deriveAddress,
  validateSeedPhrase,
  KeyPair,
} from './crypto';
import { saveWallet, loadWallet, WalletData } from './storage';

export interface Wallet extends WalletData {
  keyPair: KeyPair;
  address: string;
}

/** إنشاء محفظة جديدة */
export async function createWallet(): Promise<Wallet> {
  const seedPhrase = generateSeedPhrase();
  return createWalletFromSeed(seedPhrase);
}

/** استعادة محفظة من عبارة الاسترداد */
export async function restoreWallet(seedPhrase: string): Promise<Wallet> {
  if (!validateSeedPhrase(seedPhrase)) {
    throw new Error('عبارة الاسترداد غير صالحة. تأكد من 12 كلمة صحيحة.');
  }
  return createWalletFromSeed(seedPhrase);
}

async function createWalletFromSeed(seedPhrase: string): Promise<Wallet> {
  const keyPair = deriveKeyPairFromSeed(seedPhrase);
  const address = deriveAddress(keyPair.publicKey);
  const wallet: Wallet = {
    address,
    publicKey: keyPair.publicKey,
    seedPhrase,
    createdAt: Date.now(),
    keyPair,
  };
  await saveWallet(wallet);
  return wallet;
}

/** تحميل المحفظة الحالية من التخزين المحلي */
export async function loadCurrentWallet(): Promise<Wallet | null> {
  const data = await loadWallet();
  if (!data) return null;
  const keyPair = deriveKeyPairFromSeed(data.seedPhrase);
  return {
    ...data,
    keyPair,
    address: deriveAddress(keyPair.publicKey),
  };
}
