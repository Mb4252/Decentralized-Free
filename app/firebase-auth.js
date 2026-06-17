// ==========================================
// خدمة المصادقة Firebase (firebase-auth.js)
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getAppCheck, ReCaptchaV3Provider, initializeAppCheck } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js";
import { firebaseConfig, SECURITY } from './config.js';

// ==========================================
// تهيئة Firebase
// ==========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// ⭐ إضافة نطاقات إضافية إذا لزم الأمر
provider.addScope('email');
provider.addScope('profile');

// ==========================================
// App Check (حماية من الاستخدام غير المصرح به)
// ==========================================

if (SECURITY.appCheckEnabled) {
  const appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(SECURITY.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true
  });
  console.log('✅ App Check مفعل');
}

// ==========================================
// دوال المصادقة
// ==========================================

// 🔑 تسجيل الدخول عبر Google
export async function signInWithGoogle() {
  try {
    // تعيين اللغة العربية
    auth.languageCode = 'ar';
    
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    
    return {
      success: true,
      user: {
        uid: user.uid,
        email: user.email,
        name: user.displayName || user.email.split('@')[0],
        photoURL: user.photoURL || null
      }
    };
    
  } catch (error) {
    console.error('❌ خطأ في تسجيل الدخول عبر Google:', error);
    
    // معالجة أنواع الأخطاء المختلفة
    if (error.code === 'auth/popup-closed-by-user') {
      return { success: false, error: 'تم إلغاء تسجيل الدخول' };
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      return { success: false, error: 'هذا البريد مرتبط بحساب آخر' };
    } else if (error.code === 'auth/network-request-failed') {
      return { success: false, error: 'خطأ في الاتصال بالإنترنت' };
    }
    
    return { success: false, error: error.message };
  }
}

// 🚪 تسجيل الخروج
export async function logout() {
  try {
    await signOut(auth);
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    return { success: true };
  } catch (error) {
    console.error('❌ خطأ في تسجيل الخروج:', error);
    return { success: false, error: error.message };
  }
}

// 👤 مراقبة حالة المستخدم
export function onAuthStateChange(callback) {
  return onAuthStateChanged(auth, (user) => {
    if (user) {
      callback({
        isAuthenticated: true,
        user: {
          uid: user.uid,
          email: user.email,
          name: user.displayName,
          photoURL: user.photoURL
        }
      });
    } else {
      callback({ isAuthenticated: false, user: null });
    }
  });
}

// 📧 إعادة تعيين كلمة المرور
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email, {
      url: `${window.location.origin}/login.html`,
      handleCodeInApp: true
    });
    return { success: true, message: 'تم إرسال رابط إعادة تعيين كلمة المرور' };
  } catch (error) {
    console.error('❌ خطأ في إعادة تعيين كلمة المرور:', error);
    return { success: false, error: error.message };
  }
}

// 🔒 تحديث كلمة المرور
export async function changePassword(newPassword) {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: 'يجب تسجيل الدخول أولاً' };
    }
    await updatePassword(user, newPassword);
    return { success: true, message: 'تم تغيير كلمة المرور بنجاح' };
  } catch (error) {
    console.error('❌ خطأ في تغيير كلمة المرور:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// دالة للحصول على بصمة الجهاز (للاستعادة)
// ==========================================

export async function getDeviceFingerprint() {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 200;
  canvas.height = 50;
  ctx.textBaseline = 'top';
  ctx.font = '14px Arial';
  ctx.fillStyle = '#f60';
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = '#069';
  ctx.fillText('CryptoShop', 2, 15);
  ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
  ctx.fillText('fingerprint', 4, 30);
  const canvasFingerprint = canvas.toDataURL();

  const data = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    languages: navigator.languages ? navigator.languages.join(',') : '',
    screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    timezoneOffset: new Date().getTimezoneOffset(),
    canvas: canvasFingerprint,
    hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
    deviceMemory: navigator.deviceMemory || 'unknown',
    maxTouchPoints: navigator.maxTouchPoints || 0,
    cookiesEnabled: navigator.cookieEnabled,
    plugins: Array.from(navigator.plugins || []).map(p => p.name).join(','),
  };

  const jsonString = JSON.stringify(data);
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(jsonString));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
