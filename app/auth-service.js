// ==========================================
// خدمة المصادقة مع الخادم (auth-service.js)
// ==========================================

import { API } from './config.js';
import { getDeviceFingerprint } from './firebase-auth.js';

// ==========================================
// دوال المصادقة مع الخادم
// ==========================================

// 🔐 تسجيل الدخول (بريد/كلمة مرور)
export async function login(email, password) {
  try {
    const fingerprint = await getDeviceFingerprint();
    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screen: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    const response = await fetch(`${API.baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email, 
        password,
        deviceFingerprint: fingerprint,
        deviceInfo: deviceInfo
      }),
      credentials: 'include'
    });

    const data = await response.json();
    
    if (data.success) {
      localStorage.setItem('user', JSON.stringify(data.user));
      return { success: true, user: data.user };
    } else {
      return { success: false, error: data.error };
    }
    
  } catch (error) {
    console.error('❌ Login error:', error);
    return { success: false, error: 'خطأ في الاتصال بالخادم' };
  }
}

// 📝 تسجيل حساب جديد
export async function register(name, email, password, referralCode = null) {
  try {
    const fingerprint = await getDeviceFingerprint();
    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screen: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    const response = await fetch(`${API.baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name, 
        email, 
        password, 
        referralCode,
        deviceFingerprint: fingerprint,
        deviceInfo: deviceInfo
      }),
      credentials: 'include'
    });

    const data = await response.json();
    
    if (data.success) {
      localStorage.setItem('user', JSON.stringify(data.user));
      return { success: true, user: data.user, referral_code: data.referral_code };
    } else {
      return { success: false, error: data.error };
    }
    
  } catch (error) {
    console.error('❌ Register error:', error);
    return { success: false, error: 'خطأ في الاتصال بالخادم' };
  }
}

// 🔑 تسجيل الدخول عبر Google (مع الخادم)
export async function googleAuth(firebaseUser) {
  try {
    const fingerprint = await getDeviceFingerprint();
    const deviceInfo = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screen: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    };

    const response = await fetch(`${API.baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        ...firebaseUser,
        deviceFingerprint: fingerprint,
        deviceInfo: deviceInfo
      }),
      credentials: 'include'
    });

    const data = await response.json();
    
    if (data.success) {
      localStorage.setItem('user', JSON.stringify(data.user));
      return { success: true, user: data.user, isNewUser: data.isNewUser };
    } else {
      return { success: false, error: data.error };
    }
    
  } catch (error) {
    console.error('❌ Google auth error:', error);
    return { success: false, error: 'خطأ في الاتصال بالخادم' };
  }
}

// 🚪 تسجيل الخروج (مع الخادم)
export async function logout() {
  try {
    await fetch(`${API.baseUrl}/api/logout`, {
      method: 'POST',
      credentials: 'include'
    });
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    return { success: true };
  } catch (error) {
    console.error('❌ Logout error:', error);
    return { success: false, error: error.message };
  }
}

// 👤 جلب بيانات المستخدم
export async function getUser() {
  try {
    const response = await fetch(`${API.baseUrl}/api/user`, {
      method: 'POST',
      credentials: 'include'
    });

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem('user');
      return { success: false, error: 'غير مصرح به' };
    }

    const data = await response.json();
    
    if (data.error) {
      return { success: false, error: data.error };
    }
    
    localStorage.setItem('user', JSON.stringify(data));
    return { success: true, user: data };
    
  } catch (error) {
    console.error('❌ Get user error:', error);
    return { success: false, error: 'خطأ في الاتصال بالخادم' };
  }
}

// 🔄 التحقق من صحة الجلسة
export function isAuthenticated() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  return user && user.id;
}

// 📱 الحصول على بيانات المستخدم من localStorage
export function getCurrentUser() {
  return JSON.parse(localStorage.getItem('user') || '{}');
}
