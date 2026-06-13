-- جدول المستخدمين
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  referral_code VARCHAR(20) UNIQUE NOT NULL,
  referrer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  available_balance DECIMAL(20,8) DEFAULT 0,
  active_deposit DECIMAL(20,8) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول طلبات الإيداع
CREATE TABLE IF NOT EXISTS deposit_requests (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- جدول طلبات السحب
CREATE TABLE IF NOT EXISTS withdrawals (
  id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(20,8) NOT NULL,
  wallet_address VARCHAR(255) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- تعطيل RLS
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE deposit_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals DISABLE ROW LEVEL SECURITY;
