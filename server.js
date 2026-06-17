const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');  // ⭐ تأكد من هذا السطر
require('dotenv').config();

const bsc = require('./lib/bsc');

const app = express();
// ... باقي الكود
// ==========================================
// إعدادات الأمان
// ==========================================

app.set('trust proxy', 1);

// Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'", "https://*.supabase.co", "https://*.firebaseapp.com", "https://*.googleapis.com"],
      fontSrc: ["'self'", "data:"],
    },
  },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS
const allowedOrigins = [
  process.env.CLIENT_URL || 'https://crypto-api-c2v8.onrender.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'https://sudan-market-6b122.firebaseapp.com'
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('❌ CORS blocked:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie', 'X-Requested-With']
}));

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static('app'));

// ==========================================
// Rate Limiting
// ==========================================

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: '⚠️太多 طلبات. يرجى الانتظار' },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: '⚠️太多 محاولات تسجيل الدخول. يرجى الانتظار دقيقة' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: '⚠️太多 طلبات. يرجى الانتظار' },
});

app.use('/api/', generalLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/register', loginLimiter);
app.use('/api/products', apiLimiter);

// ========================================
// HTTPS إجباري
// ========================================
app.use((req, res, next) => {
  if (req.headers['x-forwarded-proto'] !== 'https' && process.env.NODE_ENV === 'production') {
    return res.redirect(`https://${req.headers.host}${req.url}`);
  }
  next();
});

// ========================================
// إعداد البريد الإلكتروني (Nodemailer)
// ========================================

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_SECURE === 'true' || false,
  auth: {
    user: process.env.SMTP_USER || 'your-email@gmail.com',
    pass: process.env.SMTP_PASS || 'your-app-password'
  }
});

// ========================================
// دالة إرسال رمز التحقق عبر البريد
// ========================================

async function sendVerificationEmail(email, name, code) {
  try {
    const htmlContent = `
      <!DOCTYPE html>
      <html dir="rtl" lang="ar">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>رمز التحقق</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f0f2f5; padding: 20px; }
          .container { max-width: 500px; margin: 0 auto; background: white; border-radius: 16px; padding: 32px; border: 1px solid #00aa55; }
          .header { text-align: center; margin-bottom: 24px; }
          .header h1 { color: #00aa55; font-size: 24px; }
          .code { 
            font-size: 48px; 
            font-weight: bold; 
            color: #00aa55; 
            text-align: center; 
            padding: 16px; 
            background: #f5f5f5; 
            border-radius: 12px;
            letter-spacing: 8px;
            margin: 16px 0;
          }
          .footer { text-align: center; color: #888; font-size: 12px; margin-top: 24px; }
          .warning { color: #ff4444; font-size: 12px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🛍️ CryptoShop</h1>
            <p>مرحباً ${name}،</p>
          </div>
          <p style="color:#666;text-align:center;">لقد تلقينا طلباً لإنشاء حساب جديد. لتفعيل حسابك، يرجى استخدام رمز التحقق التالي:</p>
          <div class="code">${code}</div>
          <p style="color:#666;text-align:center;">هذا الرمز صالح لمدة <strong>10 دقائق</strong>.</p>
          <p style="color:#666;text-align:center;font-size:14px;">إذا لم تطلب هذا، يمكنك تجاهل هذا البريد.</p>
          <div class="warning">⚠️ لا تشارك هذا الرمز مع أي شخص</div>
          <div class="footer">
            © ${new Date().getFullYear()} CryptoShop - منصة الشراء الجماعي
          </div>
        </div>
      </body>
      </html>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@cryptoshop.com',
      to: email,
      subject: '🔑 رمز التحقق - CryptoShop',
      html: htmlContent
    });

    console.log(`✅ تم إرسال رمز التحقق إلى ${email}`);
    return { success: true };
  } catch (error) {
    console.error('❌ فشل إرسال البريد:', error);
    return { success: false, error: error.message };
  }
}

// ========================================
// Supabase
// ========================================
const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ========================================
// JWT
// ========================================
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';
const SALT_ROUNDS = 12;

// ========================================
// دوال مساعدة
// ========================================

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==========================================
// Audit Log
// ==========================================
async function logAudit(userId, action, details = {}, req = null) {
  try {
    await supabaseAdmin
      .from('audit_log')
      .insert({
        user_id: userId,
        action: action,
        details: details,
        ip_address: req?.ip || req?.connection?.remoteAddress || 'unknown',
        user_agent: req?.headers?.['user-agent'] || 'unknown',
        created_at: new Date().toISOString()
      });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

// ==========================================
// Middleware
// ==========================================

function authenticateToken(req, res, next) {
  const token = req.cookies.token;
  
  if (!token) {
    return res.status(401).json({ error: 'غير مصرح به - يرجى تسجيل الدخول' });
  }
  
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'انتهت صلاحية الجلسة' });
      }
      return res.status(403).json({ error: 'رمز غير صالح' });
    }
    req.user = decoded;
    next();
  });
}

function authenticateAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'صلاحيات أدمن مطلوبة' });
    }
    next();
  });
}

// ==========================================
// API: صحّة الخادم
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==========================================
// API: طلب رمز التحقق (للتسجيل)
// ==========================================
app.post('/api/request-verification', async (req, res) => {
  const { email, name } = req.body;
  
  console.log('📝 طلب رمز تحقق:', email);
  
  if (!email || !name) {
    return res.status(400).json({ error: 'البريد والاسم مطلوبان' });
  }
  
  try {
    // التحقق من عدم وجود البريد
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: 'هذا البريد مسجل بالفعل' });
    }
    
    // إنشاء رمز تحقق
    const code = generateVerificationCode();
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 10);
    
    // تخزين رمز التحقق
    await supabaseAdmin
      .from('verification_codes')
      .upsert({
        email: email,
        code: code,
        name: name,
        expiry: expiry.toISOString(),
        created_at: new Date().toISOString()
      }, { onConflict: 'email' });
    
    // إرسال رمز التحقق عبر البريد
    const emailResult = await sendVerificationEmail(email, name, code);
    
    if (!emailResult.success) {
      return res.status(500).json({ error: 'فشل إرسال رمز التحقق. يرجى المحاولة لاحقاً.' });
    }
    
    console.log(`✅ تم إرسال رمز التحقق إلى ${email}`);
    
    res.json({
      success: true,
      message: '✅ تم إرسال رمز التحقق إلى بريدك الإلكتروني'
    });
    
  } catch (error) {
    console.error('Request verification error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: إعادة إرسال رمز التحقق
// ==========================================
app.post('/api/resend-verification', async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
  }
  
  try {
    const { data: verification, error: vError } = await supabaseAdmin
      .from('verification_codes')
      .select('*')
      .eq('email', email)
      .single();
    
    if (vError || !verification) {
      return res.status(400).json({ error: 'لا يوجد طلب تحقق لهذا البريد' });
    }
    
    // إنشاء رمز جديد
    const newCode = generateVerificationCode();
    const expiry = new Date();
    expiry.setMinutes(expiry.getMinutes() + 10);
    
    await supabaseAdmin
      .from('verification_codes')
      .update({
        code: newCode,
        expiry: expiry.toISOString(),
        created_at: new Date().toISOString()
      })
      .eq('email', email);
    
    // إرسال الرمز الجديد
    const emailResult = await sendVerificationEmail(email, verification.name, newCode);
    
    if (!emailResult.success) {
      return res.status(500).json({ error: 'فشل إرسال رمز التحقق' });
    }
    
    res.json({
      success: true,
      message: '✅ تم إعادة إرسال رمز التحقق إلى بريدك الإلكتروني'
    });
    
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: إنشاء حساب (مع التحقق من الرمز)
// ==========================================
app.post('/api/register', loginLimiter, async (req, res) => {
  const { 
    email, password, name, referralCode,
    verificationCode,
    deviceFingerprint, deviceInfo
  } = req.body;
  
  console.log('📝 محاولة إنشاء حساب مع التحقق:', email);
  
  if (!email || !password || !name || !verificationCode) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة (بما في ذلك رمز التحقق)' });
  }
  
  if (password.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور 4 أحرف على الأقل' });
  }
  
  try {
    // التحقق من رمز التحقق
    const { data: verification, error: vError } = await supabaseAdmin
      .from('verification_codes')
      .select('*')
      .eq('email', email)
      .single();
    
    if (vError || !verification) {
      return res.status(400).json({ error: 'لم يتم طلب رمز تحقق لهذا البريد' });
    }
    
    // التحقق من صحة الرمز
    if (verification.code !== verificationCode) {
      return res.status(400).json({ error: 'رمز التحقق غير صحيح' });
    }
    
    // التحقق من صلاحية الرمز
    const expiry = new Date(verification.expiry);
    if (expiry < new Date()) {
      return res.status(400).json({ error: 'انتهت صلاحية رمز التحقق. يرجى طلب رمز جديد' });
    }
    
    // التحقق من عدم وجود المستخدم
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('email', email)
      .single();
    
    if (existing) {
      return res.status(400).json({ error: 'هذا البريد مسجل بالفعل' });
    }
    
    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const userId = generateUUID();
    const newReferralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
    
    let referrerId = null;
    if (referralCode) {
      const { data: referrer } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('referral_code', referralCode.toUpperCase())
        .single();
      if (referrer) referrerId = referrer.id;
    }
    
    // تخزين آخر كلمة مرور للاستعادة
    const lastPasswordUsed = await bcrypt.hash(password, 8);
    
    const userData = {
      id: userId,
      email,
      password: hashedPassword,
      name: name || email.split('@')[0],
      referral_code: newReferralCode,
      referrer_id: referrerId,
      is_admin: false,
      available_balance: 0,
      platform_balance: 0,
      total_orders: 0,
      total_spent: 0,
      device_fingerprint: deviceFingerprint || null,
      device_info: deviceInfo || null,
      last_password_used: lastPasswordUsed,
      email_verified: true,
      created_at: new Date().toISOString()
    };
    
    const { error: insertError } = await supabaseAdmin
      .from('users')
      .insert(userData);
    
    if (insertError) {
      console.error('Insert error:', insertError);
      return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
    }
    
    // حذف رمز التحقق بعد الاستخدام
    await supabaseAdmin
      .from('verification_codes')
      .delete()
      .eq('email', email);
    
    // إنشاء JWT token
    const token = jwt.sign(
      { userId, email, name, is_admin: false },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    
    await logAudit(userId, 'register_verified', { email }, req);
    
    console.log('✅ تم إنشاء الحساب بنجاح مع التحقق:', email);
    
    res.json({
      success: true,
      user: { id: userId, email, name, is_admin: false },
      referral_code: newReferralCode
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: تسجيل الدخول
// ==========================================
app.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password, deviceFingerprint, deviceInfo } = req.body;
  
  console.log('🔐 محاولة تسجيل دخول:', email);
  
  if (!email || !password) {
    return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبة' });
  }
  
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      console.log('❌ مستخدم غير موجود:', email);
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
    
    // التحقق من المستخدم عبر Google
    if (user.auth_provider === 'google') {
      return res.status(400).json({ 
        error: '⚠️ هذا الحساب مسجل عبر Google. يرجى استخدام "تسجيل الدخول عبر Google".' 
      });
    }
    
    // التحقق من كلمة المرور
    let passwordValid = false;
    
    try {
      passwordValid = await bcrypt.compare(password, user.password);
    } catch (e) {}
    
    if (!passwordValid && user.password === password) {
      passwordValid = true;
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      await supabaseAdmin
        .from('users')
        .update({ password: hashedPassword })
        .eq('id', user.id);
      console.log(`✅ تم تحديث كلمة مرور ${email} إلى النص المشفر`);
    }
    
    if (!passwordValid) {
      console.log('❌ كلمة مرور خاطئة:', email);
      return res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
    
    // تحديث بصمة الجهاز
    if (deviceFingerprint) {
      await supabaseAdmin
        .from('users')
        .update({
          device_fingerprint: deviceFingerprint,
          device_info: deviceInfo || null,
          last_login_ip: req.ip || req.connection?.remoteAddress || 'unknown',
          last_login_at: new Date().toISOString()
        })
        .eq('id', user.id);
    }
    
    // إنشاء JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    
    await logAudit(user.id, 'login', { email: user.email }, req);
    
    console.log('✅ تم تسجيل الدخول بنجاح:', email);
    
    res.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin || false }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: تسجيل الخروج
// ==========================================
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });
  res.json({ success: true, message: 'تم تسجيل الخروج بنجاح' });
});

// ==========================================
// API: تسجيل الدخول عبر Google (Firebase)
// ==========================================
app.post('/api/auth/google', async (req, res) => {
  const { uid, email, name, photoURL, deviceFingerprint, deviceInfo } = req.body;
  
  console.log('🔐 محاولة تسجيل دخول عبر Google:', email);
  
  if (!email || !uid) {
    return res.status(400).json({ error: 'بيانات ناقصة' });
  }
  
  try {
    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    
    let userId;
    let isNewUser = false;
    
    if (!existingUser) {
      isNewUser = true;
      const randomPassword = Math.random().toString(36).substring(2, 15);
      const hashedPassword = await bcrypt.hash(randomPassword, SALT_ROUNDS);
      const lastPasswordUsed = await bcrypt.hash(randomPassword, 8);
      userId = generateUUID();
      const referralCode = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      const { error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: userId,
          email: email,
          password: hashedPassword,
          name: name || email.split('@')[0],
          referral_code: referralCode,
          is_admin: false,
          available_balance: 0,
          platform_balance: 0,
          total_orders: 0,
          total_spent: 0,
          auth_provider: 'google',
          auth_provider_id: uid,
          photo_url: photoURL || null,
          device_fingerprint: deviceFingerprint || null,
          device_info: deviceInfo || null,
          last_password_used: lastPasswordUsed,
          email_verified: true,
          created_at: new Date().toISOString()
        });
      
      if (insertError) {
        console.error('Insert error:', insertError);
        return res.status(500).json({ error: 'حدث خطأ في إنشاء الحساب' });
      }
      
      console.log('✅ تم إنشاء حساب جديد عبر Google:', email);
      
    } else {
      userId = existingUser.id;
      
      await supabaseAdmin
        .from('users')
        .update({
          name: name || existingUser.name,
          photo_url: photoURL || existingUser.photo_url,
          auth_provider_id: uid,
          device_fingerprint: deviceFingerprint || existingUser.device_fingerprint,
          device_info: deviceInfo || existingUser.device_info,
          last_login_ip: req.ip || req.connection?.remoteAddress || 'unknown',
          last_login_at: new Date().toISOString()
        })
        .eq('id', userId);
    }
    
    const token = jwt.sign(
      { 
        userId: userId, 
        email: email, 
        name: name || email.split('@')[0],
        is_admin: existingUser?.is_admin || false,
        auth_provider: 'google'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/'
    });
    
    await logAudit(userId, 'google_login', { email, isNewUser }, req);
    
    res.json({
      success: true,
      isNewUser: isNewUser,
      user: {
        id: userId,
        email: email,
        name: name || email.split('@')[0],
        photoURL: photoURL || null,
        is_admin: existingUser?.is_admin || false
      }
    });
    
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: جلب بيانات المستخدم
// ==========================================
app.post('/api/user', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();
    
    if (error) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    delete data.password;
    delete data.last_password_used;
    res.json(data);
    
  } catch (error) {
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: عرض المنتجات
// ==========================================
app.get('/api/products', async (req, res) => {
  try {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: تفاصيل منتج
// ==========================================
app.get('/api/product/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*')
      .eq('id', req.params.id)
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: شراء منتج
// ==========================================
app.post('/api/order-product', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { productId, quantity, location, acceptTerms } = req.body;
  
  if (!productId || !quantity || !location) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  if (!acceptTerms) {
    return res.status(400).json({ error: 'يجب الموافقة على الشروط' });
  }
  
  try {
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();
    
    if (productError || !product) {
      return res.status(404).json({ error: 'المنتج غير موجود' });
    }
    
    if (product.status === 'completed') {
      return res.status(400).json({ error: 'العدد اكتمل' });
    }
    
    const remaining = product.min_quantity - product.current_orders;
    if (quantity > remaining) {
      return res.status(400).json({ error: `المتبقي ${remaining} قطعة فقط` });
    }
    
    const totalAmount = product.group_price * quantity;
    
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();
    
    if (userError || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    if (user.available_balance < totalAmount) {
      return res.status(400).json({ error: `الرصيد غير كافٍ` });
    }
    
    const newBalance = user.available_balance - totalAmount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);
    
    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        quantity,
        total_amount: totalAmount,
        location,
        status: 'pending',
        withdraw_count: 0,
        is_banned: false,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (orderError) throw orderError;
    
    const newCurrentOrders = product.current_orders + quantity;
    await supabaseAdmin
      .from('products')
      .update({ current_orders: newCurrentOrders })
      .eq('id', productId);
    
    await logAudit(userId, 'order_product', { productId, quantity, totalAmount }, req);
    
    let message = `✅ تم شراء ${quantity} × ${product.name}`;
    let isCompleted = false;
    
    if (newCurrentOrders >= product.min_quantity) {
      isCompleted = true;
      message += ' 🎉 اكتمل العدد!';
      await supabaseAdmin
        .from('products')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', productId);
    }
    
    res.json({ success: true, message, order, isCompleted });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: طلباتي
// ==========================================
app.post('/api/my-orders', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('product_orders')
      .select('*, products(name, image_url, delivery_date, delivery_locations, status)')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: سحب الطلب
// ==========================================
app.post('/api/withdraw-order', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { orderId } = req.body;
  
  if (!orderId) {
    return res.status(400).json({ error: 'معرف الطلب مطلوب' });
  }
  
  try {
    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .select('*, products(status)')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }
    
    if (order.user_id !== userId) {
      return res.status(403).json({ error: 'هذا الطلب ليس لك' });
    }
    
    if (order.products.status === 'completed') {
      return res.status(400).json({ error: 'العدد اكتمل، لا يمكن السحب' });
    }
    
    if (order.is_banned) {
      return res.status(400).json({ error: 'تم استبعادك' });
    }
    
    const newWithdrawCount = (order.withdraw_count || 0) + 1;
    let isBanned = false;
    
    if (newWithdrawCount >= 2) {
      isBanned = true;
      await supabaseAdmin
        .from('product_orders')
        .update({ is_banned: true, status: 'withdrawn', withdrawn_at: new Date().toISOString() })
        .eq('id', orderId);
    } else {
      await supabaseAdmin
        .from('product_orders')
        .update({ status: 'withdrawn', withdraw_count: newWithdrawCount, withdrawn_at: new Date().toISOString() })
        .eq('id', orderId);
    }
    
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();
    
    const newBalance = (user.available_balance || 0) + order.total_amount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);
    
    await supabaseAdmin
      .from('products')
      .update({ current_orders: supabaseAdmin.raw('current_orders - ?', order.quantity) })
      .eq('id', order.product_id);
    
    await logAudit(userId, 'withdraw_order', { orderId, amount: order.total_amount }, req);
    
    let message = `✅ تم سحب الطلب وإعادة ${order.total_amount} USDT`;
    if (isBanned) message += ' ⚠️ تم استبعادك نهائياً';
    
    res.json({ success: true, message, isBanned, withdrawCount: newWithdrawCount });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: الإيداع
// ==========================================
app.post('/api/deposit', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { amount, transactionHash } = req.body;
  
  if (!amount || amount < 1) {
    return res.status(400).json({ error: 'الحد الأدنى 1 USDT' });
  }
  
  if (!transactionHash || transactionHash.length < 10) {
    return res.status(400).json({ error: 'TXID مطلوب' });
  }
  
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();
    
    if (!user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    const { data: existing } = await supabaseAdmin
      .from('deposit_requests')
      .select('id')
      .eq('transaction_hash', transactionHash)
      .maybeSingle();
    
    if (existing) {
      return res.status(400).json({ error: 'هذا TXID مستخدم مسبقاً' });
    }
    
    const verification = await bsc.verifyTransaction(transactionHash, amount, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ error: verification.error });
    }
    
    const actualAmount = verification.amount || amount;
    
    await supabaseAdmin
      .from('deposit_requests')
      .insert({
        user_id: userId,
        amount: actualAmount,
        transaction_hash: transactionHash,
        status: 'approved',
        created_at: new Date().toISOString(),
        approved_at: new Date().toISOString()
      });
    
    const newBalance = (user.available_balance || 0) + actualAmount;
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', userId);
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'deposit',
        amount: actualAmount,
        status: 'approved',
        description: `💰 إيداع ${actualAmount} USDT`,
        created_at: new Date().toISOString()
      });
    
    await logAudit(userId, 'deposit', { amount: actualAmount, transactionHash }, req);
    
    res.json({ success: true, message: `✅ تم إضافة ${actualAmount} USDT` });
    
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: التحقق من الإيداع
// ==========================================
app.post('/api/verify-deposit', authenticateToken, async (req, res) => {
  const { transactionHash, amount } = req.body;
  
  if (!transactionHash) {
    return res.status(400).json({ success: false, error: 'TXID مطلوب' });
  }
  
  try {
    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }
    
    res.json({ success: true, message: 'المعاملة صالحة', verification });
    
  } catch (error) {
    res.status(500).json({ success: false, error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: سحب رصيد
// ==========================================
app.post('/api/withdraw', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { amount, walletAddress } = req.body;
  
  if (!amount || amount < 0.5) {
    return res.status(400).json({ error: 'الحد الأدنى 0.5 USDT' });
  }
  
  if (!walletAddress || !walletAddress.startsWith('0x') || walletAddress.length < 30) {
    return res.status(400).json({ error: 'عنوان محفظة غير صالح' });
  }
  
  try {
    const { data: user } = await supabaseAdmin
      .from('users')
      .select('available_balance')
      .eq('id', userId)
      .single();
    
    if (!user || user.available_balance < amount) {
      return res.status(400).json({ error: 'الرصيد غير كافٍ' });
    }
    
    const { data: pending } = await supabaseAdmin
      .from('withdrawals')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    
    if (pending) {
      return res.status(400).json({ error: 'لديك طلب سحب قيد المعالجة' });
    }
    
    const { data: withdrawal, error: wError } = await supabaseAdmin
      .from('withdrawals')
      .insert({
        user_id: userId,
        amount,
        wallet_address: walletAddress,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (wError) {
      return res.status(500).json({ error: 'حدث خطأ في تسجيل السحب' });
    }
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: userId,
        type: 'withdraw',
        amount,
        status: 'pending',
        reference_id: withdrawal.id,
        description: `📤 طلب سحب ${amount} USDT`,
        created_at: new Date().toISOString()
      });
    
    await logAudit(userId, 'withdraw', { amount, walletAddress }, req);
    
    res.json({ success: true, message: `✅ تم تسجيل طلب سحب ${amount} USDT` });
    
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: المعاملات
// ==========================================
app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ============ APIs الأدمن ============
// ==========================================

// إضافة منتج
app.post('/api/admin/add-product', authenticateAdmin, async (req, res) => {
  const { name, description, imageUrl, wholesalePrice, groupPrice, minQuantity, deliveryLocations, deliveryDate, pickupTime } = req.body;
  
  if (!name || !description || !wholesalePrice || !groupPrice || !minQuantity) {
    return res.status(400).json({ error: 'جميع الحقول الأساسية مطلوبة' });
  }
  
  try {
    const productData = {
      name,
      description,
      image_url: imageUrl || '',
      wholesale_price: parseFloat(wholesalePrice),
      group_price: parseFloat(groupPrice),
      min_quantity: parseInt(minQuantity),
      current_orders: 0,
      delivery_locations: deliveryLocations || ['الخرطوم', 'أم درمان', 'بحري'],
      status: 'active',
      created_at: new Date().toISOString()
    };
    
    if (deliveryDate) productData.delivery_date = deliveryDate;
    if (pickupTime) productData.pickup_time = pickupTime;
    
    const { data, error } = await supabaseAdmin
      .from('products')
      .insert(productData)
      .select()
      .single();
    
    if (error) throw error;
    
    await logAudit(req.user.userId, 'add_product', { name, wholesalePrice, groupPrice }, req);
    
    res.json({ success: true, message: `✅ تم إضافة ${name}`, product: data });
    
  } catch (error) {
    console.error('Add product error:', error);
    res.status(500).json({ error: error.message });
  }
});

// حذف منتج
app.post('/api/admin/delete-product', authenticateAdmin, async (req, res) => {
  const { productId } = req.body;
  
  try {
    const { data: orders } = await supabaseAdmin
      .from('product_orders')
      .select('id')
      .eq('product_id', productId)
      .eq('status', 'pending');
    
    if (orders && orders.length > 0) {
      return res.status(400).json({ error: 'يوجد طلبات معلقة' });
    }
    
    await supabaseAdmin
      .from('products')
      .delete()
      .eq('id', productId);
    
    await logAudit(req.user.userId, 'delete_product', { productId }, req);
    
    res.json({ success: true, message: '✅ تم حذف المنتج' });
    
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ error: error.message });
  }
});

// طلبات المنتج
app.post('/api/admin/product-orders', authenticateAdmin, async (req, res) => {
  const { productId } = req.body;
  
  try {
    const { data, error } = await supabaseAdmin
      .from('product_orders')
      .select('*, users!product_orders_user_id_fkey(name, email)')
      .eq('product_id', productId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// تحديث حالة الطلب
app.post('/api/admin/update-order-status', authenticateAdmin, async (req, res) => {
  const { orderId, status } = req.body;
  
  const validStatuses = ['pending', 'confirmed', 'shipped', 'in_location', 'delivered', 'cancelled', 'refunded', 'delayed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'حالة غير صالحة' });
  }
  
  try {
    await supabaseAdmin
      .from('product_orders')
      .update({
        status: status,
        confirmed_at: status === 'confirmed' ? new Date().toISOString() : undefined,
        delivered_at: status === 'delivered' ? new Date().toISOString() : undefined,
        refunded_at: status === 'refunded' ? new Date().toISOString() : undefined
      })
      .eq('id', orderId);
    
    await logAudit(req.user.userId, 'update_order_status', { orderId, status }, req);
    
    res.json({ success: true, message: `✅ تم تحديث الحالة إلى ${status}` });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: استرداد أموال (Refund)
// ==========================================
app.post('/api/admin/refund-order', authenticateAdmin, async (req, res) => {
  const { orderId, reason } = req.body;
  
  console.log('💰 طلب استرداد:', { orderId, reason });
  
  if (!orderId) {
    return res.status(400).json({ error: 'معرف الطلب مطلوب' });
  }
  
  try {
    const { data: order, error: orderError } = await supabaseAdmin
      .from('product_orders')
      .select('*, users!product_orders_user_id_fkey(available_balance, name, email)')
      .eq('id', orderId)
      .single();
    
    if (orderError || !order) {
      return res.status(404).json({ error: 'الطلب غير موجود' });
    }
    
    if (order.status === 'refunded') {
      return res.status(400).json({ error: 'تم استرداد هذا الطلب مسبقاً' });
    }
    
    if (order.status === 'delivered') {
      return res.status(400).json({ error: 'لا يمكن استرداد طلب تم تسليمه' });
    }
    
    if (order.status === 'withdrawn') {
      return res.status(400).json({ error: 'لا يمكن استرداد طلب تم سحبه' });
    }
    
    const refundAmount = order.total_amount;
    const newBalance = (order.users.available_balance || 0) + refundAmount;
    
    await supabaseAdmin
      .from('users')
      .update({ available_balance: newBalance })
      .eq('id', order.user_id);
    
    const refundReason = reason || 'استرداد بسبب عدم توفر المنتج';
    await supabaseAdmin
      .from('product_orders')
      .update({
        status: 'refunded',
        refunded_at: new Date().toISOString(),
        refund_reason: refundReason,
        admin_notes: `تم الاسترداد بواسطة: ${req.user.name || 'أدمن'}`
      })
      .eq('id', orderId);
    
    await supabaseAdmin
      .from('transactions')
      .insert({
        user_id: order.user_id,
        type: 'refund',
        amount: refundAmount,
        status: 'approved',
        description: `🔄 استرداد ${refundAmount} USDT للطلب #${orderId}`,
        created_at: new Date().toISOString()
      });
    
    await logAudit(req.user.userId, 'refund_order', { 
      orderId, 
      amount: refundAmount,
      userId: order.user_id,
      reason: refundReason
    }, req);
    
    console.log(`✅ تم استرداد ${refundAmount} USDT للمستخدم ${order.users.name}`);
    
    res.json({
      success: true,
      message: `✅ تم استرداد ${refundAmount} USDT للمستخدم ${order.users.name}`,
      refundAmount: refundAmount,
      userId: order.user_id
    });
    
  } catch (error) {
    console.error('Refund error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// ==========================================
// API: تأخير منتج (Delay)
// ==========================================
app.post('/api/admin/delay-product', authenticateAdmin, async (req, res) => {
  const { productId, newDeliveryDate, reason } = req.body;
  
  console.log('📅 طلب تأخير منتج:', { productId, newDeliveryDate, reason });
  
  if (!productId || !newDeliveryDate) {
    return res.status(400).json({ error: 'معرف المنتج والتاريخ الجديد مطلوبان' });
  }
  
  try {
    const { data: product, error: productError } = await supabaseAdmin
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();
    
    if (productError || !product) {
      return res.status(404).json({ error: 'المنتج غير موجود' });
    }
    
    const delayReason = reason || 'تأخر في التوريد';
    await supabaseAdmin
      .from('products')
      .update({
        delivery_date: newDeliveryDate,
        status: 'delayed',
        delay_reason: delayReason
      })
      .eq('id', productId);
    
    await supabaseAdmin
      .from('product_orders')
      .update({
        status: 'delayed',
        delay_reason: delayReason,
        delayed_until: newDeliveryDate,
        admin_notes: `تم تأجيل المنتج إلى ${newDeliveryDate}`
      })
      .eq('product_id', productId)
      .in('status', ['pending', 'confirmed']);
    
    await logAudit(req.user.userId, 'delay_product', { 
      productId, 
      newDeliveryDate,
      reason: delayReason
    }, req);
    
    console.log(`✅ تم تأجيل المنتج ${product.name} إلى ${newDeliveryDate}`);
    
    res.json({
      success: true,
      message: `✅ تم تأجيل المنتج ${product.name} إلى ${newDeliveryDate}`,
      productId: productId,
      newDeliveryDate: newDeliveryDate
    });
    
  } catch (error) {
    console.error('Delay product error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي: ' + error.message });
  }
});

// فحص TXID للأدمن
app.post('/api/admin/verify-deposit', authenticateAdmin, async (req, res) => {
  const { transactionHash, amount } = req.body;
  
  if (!transactionHash) {
    return res.status(400).json({ error: 'TXID مطلوب' });
  }
  
  try {
    const verification = await bsc.verifyTransaction(transactionHash, amount || 0, bsc.HOT_WALLET_ADDRESS);
    
    if (!verification.success) {
      return res.status(400).json({ success: false, error: verification.error });
    }
    
    res.json({ success: true, message: 'المعاملة صالحة', verification });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// عرض جميع المستخدمين
app.post('/api/admin/users', authenticateAdmin, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, name, email, available_balance, platform_balance, total_orders, total_spent, is_admin, created_at')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// API: استعادة كلمة المرور عبر الجهاز (Device Recovery)
// ==========================================

// الخطوة 1: التحقق من البريد والجهاز
app.post('/api/recovery/device-check', async (req, res) => {
  const { email, deviceFingerprint } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });
  }
  
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, device_fingerprint, recovery_attempts, recovery_blocked_until, security_question_enabled')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      return res.json({ 
        success: true,
        deviceMatched: false,
        message: 'إذا كان البريد مسجلاً، سيتم التحقق من الجهاز'
      });
    }
    
    if (user.recovery_blocked_until && new Date(user.recovery_blocked_until) > new Date()) {
      const remaining = Math.ceil((new Date(user.recovery_blocked_until) - new Date()) / 60000);
      return res.status(400).json({
        error: `تم حظر استعادة كلمة المرور. حاول بعد ${remaining} دقيقة`
      });
    }
    
    const deviceMatched = user.device_fingerprint === deviceFingerprint;
    
    if (!deviceMatched) {
      const attempts = (user.recovery_attempts || 0) + 1;
      let blockedUntil = null;
      let timeMessage = '';
      
      if (attempts >= 3) {
        blockedUntil = new Date();
        blockedUntil.setHours(blockedUntil.getHours() + 1);
        timeMessage = 'تم حظر المحاولات لمدة ساعة';
      } else {
        timeMessage = `محاولة ${attempts} من 3`;
      }
      
      await supabaseAdmin
        .from('users')
        .update({
          recovery_attempts: attempts,
          recovery_blocked_until: blockedUntil
        })
        .eq('id', user.id);
      
      return res.json({
        success: true,
        deviceMatched: false,
        message: `الجهاز غير معروف. ${timeMessage}`,
        attemptsLeft: 3 - attempts
      });
    }
    
    await supabaseAdmin
      .from('users')
      .update({
        recovery_attempts: 0,
        recovery_blocked_until: null
      })
      .eq('id', user.id);
    
    res.json({
      success: true,
      deviceMatched: true,
      message: 'تم التحقق من الجهاز. أدخل آخر كلمة مرور تتذكرها.',
      userId: user.id,
      hasSecurityQuestion: user.security_question_enabled
    });
    
  } catch (error) {
    console.error('Device check error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// الخطوة 2: التحقق من آخر كلمة مرور وإعادة التعيين
app.post('/api/recovery/verify-last-password', async (req, res) => {
  const { email, lastPassword, newPassword, deviceFingerprint } = req.body;
  
  if (!email || !lastPassword || !newPassword) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  
  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'كلمة المرور الجديدة يجب أن تكون 4 أحرف على الأقل' });
  }
  
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, device_fingerprint, last_password_used')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      return res.status(400).json({ error: 'بيانات غير صحيحة' });
    }
    
    if (user.device_fingerprint !== deviceFingerprint) {
      return res.status(400).json({ error: 'الجهاز غير معروف لهذا الحساب' });
    }
    
    let lastPasswordValid = false;
    try {
      lastPasswordValid = await bcrypt.compare(lastPassword, user.last_password_used);
    } catch (e) {
      if (user.last_password_used === lastPassword) {
        lastPasswordValid = true;
      }
    }
    
    if (!lastPasswordValid) {
      return res.status(400).json({ error: 'كلمة المرور القديمة غير صحيحة' });
    }
    
    const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const newLastPassword = await bcrypt.hash(newPassword, 8);
    
    await supabaseAdmin
      .from('users')
      .update({
        password: hashedPassword,
        last_password_used: newLastPassword,
        recovery_attempts: 0,
        recovery_blocked_until: null
      })
      .eq('id', user.id);
    
    console.log(`✅ تم استعادة كلمة مرور ${email} عبر الجهاز`);
    
    res.json({
      success: true,
      message: '✅ تم استعادة كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن.'
    });
    
  } catch (error) {
    console.error('Recovery verify error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// API: استعادة كلمة المرور عبر السؤال الأمني
// ==========================================
app.post('/api/recovery/security-question', async (req, res) => {
  const { email, answer } = req.body;
  
  if (!email || !answer) {
    return res.status(400).json({ error: 'البريد والإجابة مطلوبان' });
  }
  
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, security_question, security_answer, security_question_enabled')
      .eq('email', email)
      .single();
    
    if (error || !user) {
      return res.status(404).json({ error: 'المستخدم غير موجود' });
    }
    
    if (!user.security_question_enabled) {
      return res.status(400).json({ error: 'لم يتم تفعيل السؤال الأمني لهذا الحساب' });
    }
    
    const isValid = await bcrypt.compare(answer, user.security_answer);
    
    if (!isValid) {
      return res.status(400).json({ error: 'الإجابة غير صحيحة' });
    }
    
    res.json({
      success: true,
      message: '✅ تم التحقق من السؤال الأمني',
      userId: user.id,
      securityQuestion: user.security_question
    });
    
  } catch (error) {
    console.error('Security question error:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
});

// ==========================================
// تشغيل الخادم
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║   🛍️  منصة الشراء الجماعي - النسخة النهائية                    ║
  ║   📡 الخادم على المنفذ: ${PORT}                                  ║
  ║   🌐 ${process.env.CLIENT_URL || `http://localhost:${PORT}`}     ║
  ║   🔐 JWT + HttpOnly Cookies                                    ║
  ║   📧 التحقق الإلزامي من البريد الإلكتروني (OTP)               ║
  ║   🔑 Google Sign-In (Firebase) مفعل                           ║
  ║   📱 استعادة كلمة المرور عبر الجهاز                           ║
  ║   💰 نظام استرداد الأموال (Refund) مفعل                         ║
  ║   📅 نظام تأجيل المنتجات (Delay) مفعل                           ║
  ║   🛡️ Helmet + Rate Limiting + CORS محدود                      ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
});
