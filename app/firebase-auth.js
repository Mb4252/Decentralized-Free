// ==========================================
// ملف: app/firebase-auth.js
// خدمة المصادقة Firebase - كاملة
// ==========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
  getAuth, 
  signInWithPopup, 
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getAppCheck, ReCaptchaV3Provider, initializeAppCheck } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app-check.js";
import { firebaseConfig, SECURITY } from './config.js';

// ==========================================
// تهيئة Firebase
// ==========================================

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

// إضافة نطاقات إضافية
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

// 📧 إعادة تعيين كلمة المرور (Firebase)
export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email, {
      url: `${window.location.origin}/reset-password.html`,
      handleCodeInApp: true
    });
    return { 
      success: true, 
      message: '✅ تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني' 
    };
  } catch (error) {
    console.error('❌ خطأ في إعادة تعيين كلمة المرور:', error);
    
    let errorMessage = 'حدث خطأ أثناء إرسال رابط إعادة التعيين';
    if (error.code === 'auth/user-not-found') {
      errorMessage = '⚠️ هذا البريد غير مسجل في النظام';
    } else if (error.code === 'auth/too-many-requests') {
      errorMessage = '⚠️太多 محاولات. يرجى الانتظار ثم المحاولة مرة أخرى';
    }
    
    return { success: false, error: errorMessage };
  }
}

// 🔒 تغيير كلمة المرور (للمستخدم المسجل)
export async function changePassword(newPassword) {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: 'يجب تسجيل الدخول أولاً' };
    }
    await updatePassword(user, newPassword);
    return { success: true, message: '✅ تم تغيير كلمة المرور بنجاح' };
  } catch (error) {
    console.error('❌ خطأ في تغيير كلمة المرور:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// 📧 دوال إرسال رمز التحقق عبر البريد (OTP)
// ==========================================

// إرسال رمز تحقق عبر البريد الإلكتروني (Email Link)
export async function sendVerificationLink(email) {
  try {
    const actionCodeSettings = {
      url: `${window.location.origin}/verify-email.html`,
      handleCodeInApp: true,
      iOS: { bundleId: 'com.cryptoshop.app' },
      android: { packageName: 'com.cryptoshop.app' },
      dynamicLinkDomain: 'cryptoshop.page.link'
    };

    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    
    // تخزين البريد في localStorage
    window.localStorage.setItem('emailForVerification', email);
    
    return { 
      success: true, 
      message: '✅ تم إرسال رابط التحقق إلى بريدك الإلكتروني' 
    };
  } catch (error) {
    console.error('❌ خطأ في إرسال رابط التحقق:', error);
    return { success: false, error: error.message };
  }
}

// التحقق من الرابط وإكمال تسجيل الدخول
export async function completeVerification() {
  try {
    const email = window.localStorage.getItem('emailForVerification');
    if (!email) {
      return { success: false, error: 'البريد الإلكتروني غير موجود' };
    }
    
    if (isSignInWithEmailLink(auth, window.location.href)) {
      const result = await signInWithEmailLink(auth, email, window.location.href);
      window.localStorage.removeItem('emailForVerification');
      
      return {
        success: true,
        user: {
          uid: result.user.uid,
          email: result.user.email,
          name: result.user.displayName || result.user.email.split('@')[0],
          photoURL: result.user.photoURL || null
        }
      };
    } else {
      return { success: false, error: 'رابط غير صالح' };
    }
  } catch (error) {
    console.error('❌ خطأ في إكمال التحقق:', error);
    return { success: false, error: error.message };
  }
}

// ==========================================
// 📱 دالة الحصول على بصمة الجهاز
// ==========================================

export async function getDeviceFingerprint() {
  try {
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
    
  } catch (error) {
    console.error('❌ خطأ في إنشاء بصمة الجهاز:', error);
    return 'fallback-fingerprint-' + Date.now();
  }
}
