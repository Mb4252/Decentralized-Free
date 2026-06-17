// ==========================================
// ملف: app/config.js
// الإعدادات العامة - كاملة
// ==========================================

// 🔥 إعدادات Firebase (من Console)
export const firebaseConfig = {
  apiKey: "AIzaSyAI_mUhuPNoO-XC0Q-VNoWft8UWFbAbIGg",
  authDomain: "sudan-market-6b122.firebaseapp.com",
  databaseURL: "https://sudan-market-6b122-default-rtdb.firebaseio.com",
  projectId: "sudan-market-6b122",
  storageBucket: "sudan-market-6b122.firebasestorage.app",
  messagingSenderId: "66729481566",
  appId: "1:66729481566:web:93393f28dc22d32cceebcf",
  measurementId: "G-L4SDJWKPK5"
};

// 🔐 إعدادات الأمان
export const SECURITY = {
  // تفعيل App Check (يحتاج تسجيل في Firebase Console)
  appCheckEnabled: false, // ⭐ فعّل إلى true بعد إعداد App Check
  recaptchaSiteKey: 'YOUR_RECAPTCHA_SITE_KEY', // ستحصل عليها من Firebase Console
};

// 🌐 إعدادات API
export const API = {
  baseUrl: window.location.origin,
  endpoints: {
    health: '/api/health',
    login: '/api/login',
    register: '/api/register',
    requestVerification: '/api/request-verification',
    resendVerification: '/api/resend-verification',
    googleAuth: '/api/auth/google',
    user: '/api/user',
    products: '/api/products',
    deposit: '/api/deposit',
    withdraw: '/api/withdraw',
    transactions: '/api/transactions',
  }
};

// 📱 إعدادات الجهاز
export const DEVICE = {
  getInfo: function() {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      screen: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    };
  }
};

// ⏰ إعدادات المؤقتات
export const TIMERS = {
  verificationCodeExpiry: 600, // 10 دقائق بالثواني
  sessionTimeout: 7 * 24 * 60 * 60, // 7 أيام بالثواني
  rateLimitReset: 60, // دقيقة واحدة
};

// 📧 إعدادات البريد الإلكتروني
export const EMAIL = {
  verificationSubject: '🔑 رمز التحقق - CryptoShop',
  resetSubject: '🔐 إعادة تعيين كلمة المرور - CryptoShop',
  welcomeSubject: '🎉 مرحباً بك في CryptoShop',
};

// 🎯 إعدادات التطبيق
export const APP = {
  name: 'CryptoShop',
  version: '2.0.0',
  description: 'منصة الشراء الجماعي',
  supportEmail: 'support@cryptoshop.com',
  supportPhone: '+966500000000',
};
