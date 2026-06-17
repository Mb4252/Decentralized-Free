// ==========================================
// الإعدادات العامة (config.js)
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
  appCheckEnabled: true,
  recaptchaSiteKey: 'YOUR_RECAPTCHA_SITE_KEY', // ستحصل عليها من Firebase Console
};

// 🌐 إعدادات API
export const API = {
  baseUrl: window.location.origin,
  endpoints: {
    health: '/api/health',
    login: '/api/login',
    register: '/api/register',
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
  // معلومات الجهاز الحالية
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
