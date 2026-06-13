-- =====================================================
-- قاعدة بيانات منصة الاستثمار (بدون Auth ولا بريد)
-- =====================================================

-- 1. إنشاء جدول المستخدمين (مع كلمة المرور)
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name VARCHAR(255),
  referral_code VARCHAR(20) UNIQUE NOT NULL,
  referrer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  package VARCHAR(50) DEFAULT 'basic',
  available_balance DECIMAL(20,8) DEFAULT 0,
  active_deposit DECIMAL(20,8) DEFAULT 0,
  total_withdrawn DECIMAL(20,8) DEFAULT 0,
  total_deposited DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. إنشاء جدول طلبات الإيداع
CREATE TABLE IF NOT EXISTS deposit_requests (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. إنشاء جدول طلبات السحب
CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- تحديث الجداول الموجودة (إذا كانت موجودة مسبقاً)
-- =====================================================

-- إضافة عمود كلمة المرور (إذا لم يكن موجوداً)
ALTER TABLE users ADD COLUMN IF NOT EXISTS password TEXT;

-- تعيين قيمة افتراضية لكلمة المرور
ALTER TABLE users ALTER COLUMN password SET DEFAULT '';

-- التأكد من وجود عمود is_admin (إذا لم يكن موجوداً)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;

-- التأكد من وجود عمود package (إذا لم يكن موجوداً)
ALTER TABLE users ADD COLUMN IF NOT EXISTS package VARCHAR(50) DEFAULT 'basic';

-- =====================================================
-- تعطيل RLS (لأننا نستخدم Node.js API للتحكم)
-- =====================================================
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals DISABLE ROW LEVEL SECURITY;

-- =====================================================
-- إنشاء فهارس لتحسين الأداء
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_user_id ON deposit_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_deposit_requests_status ON deposit_requests(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);

-- =====================================================
-- عرض جميع الجداول للتأكد
-- =====================================================
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;
