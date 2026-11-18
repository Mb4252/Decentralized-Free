import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import * as bip39 from 'bip39';

export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

/** توليد عبارة استرداد (12 كلمة) */
export function generateSeedPhrase(): string {
  return bip39.generateMnemonic(128); // 128 bits = 12 كلمة
}

/** التحقق من صحة عبارة الاسترداد */
export function validateSeedPhrase(phrase: string): boolean {
  return bip39.validateMnemonic(phrase.trim().toLowerCase());
}

/**
 * اشتقاق زوج مفاتيح Ed25519 من عبارة الاسترداد.
 * نستخدم تشفير العبارة إلى entropy ثم hash ثابت (SHA-512 عبر nacl).
 */
export function deriveKeyPairFromSeed(seedPhrase: string): KeyPair {
  const normalized = seedPhrase.trim().toLowerCase();
  if (!bip39.validateMnemonic(normalized)) {
    throw new Error('عبارة الاسترداد غير صالحة');
  }
  // تحويل العبارة إلى entropy (16 بايت)
  const entropyHex = bip39.mnemonicToEntropy(normalized);
  const entropyBytes = naclUtil.decodeUTF8(entropyHex);

  // اشتقاق 32 بايت seed عبر hash متكرر
  let seed = entropyBytes;
  for (let i = 0; i < 10000; i++) {
    seed = nacl.hash(seed).slice(0, 32);
  }

  const keyPair = nacl.sign.keyPair.fromSeed(seed);
  return {
    publicKey: naclUtil.encodeBase64(keyPair.publicKey),
    secretKey: naclUtil.encodeBase64(keyPair.secretKey),
  };
}

/** توقيع رسالة */
export function signMessage(message: string, secretKeyBase64: string): string {
  const secretKey = naclUtil.decodeBase64(secretKeyBase64);
  const messageBytes = naclUtil.decodeUTF8(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return naclUtil.encodeBase64(signature);
}

/** التحقق من توقيع */
export function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  try {
    const publicKey = naclUtil.decodeBase64(publicKeyBase64);
    const signature = naclUtil.decodeBase64(signatureBase64);
    const messageBytes = naclUtil.decodeUTF8(message);
    return nacl.sign.detached.verify(messageBytes, signature, publicKey);
  } catch {
    return false;
  }
}

/** اشتقاق عنوان المحفظة (مختصر) من المفتاح العام */
export function deriveAddress(publicKeyBase64: string): string {
  const hash = nacl.hash(naclUtil.decodeBase64(publicKeyBase64));
  return 'CHR-' + naclUtil.encodeBase64(hash).slice(0, 16).replace(/[+/=]/g, '');
}
