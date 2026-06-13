'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [userData, setUserData] = useState(null)
  const [depositAmount, setDepositAmount] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState('')

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        window.location.href = '/'
        return
      }
      setUser(user)
      
      // جلب بيانات المستخدم من جدول users
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', user.email)
        .single()
      
      if (data) {
        setUserData(data)
      } else if (!data && !error) {
        // إنشاء مستخدم جديد
        const { data: newUser } = await supabase
          .from('users')
          .insert({
            email: user.email,
            name: user.email?.split('@')[0],
            available_balance: 0,
            active_deposit: 0,
            referral_code: Math.random().toString(36).substring(2, 10).toUpperCase()
          })
          .select()
          .single()
        setUserData(newUser)
      }
      
      setLoading(false)
    }
    
    getUser()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const handleDeposit = async () => {
    const amount = parseFloat(depositAmount)
    if (!amount || amount < 10) {
      setMessage('⚠️ الحد الأدنى للإيداع 10 USDT')
      setMessageType('error')
      return
    }
    
    // إنشاء طلب إيداع
    const { error } = await supabase
      .from('deposit_requests')
      .insert({
        user_id: userData?.id,
        amount: amount,
        status: 'pending'
      })
    
    if (error) {
      setMessage('❌ حدث خطأ، حاول مرة أخرى')
      setMessageType('error')
    } else {
      setMessage(`✅ تم تقديم طلب إيداع بقيمة ${amount} USDT. يرجى إرسال المبلغ إلى المحفظة: 0x987cfde723a87b5ed33329eebe0595a4416b848f`)
      setMessageType('success')
      setDepositAmount('')
    }
    
    setTimeout(() => setMessage(''), 5000)
  }

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount)
    if (!amount || amount < 0.5) {
      setMessage('⚠️ الحد الأدنى للسحب 0.5 USDT')
      setMessageType('error')
      return
    }
    if (!withdrawAddress) {
      setMessage('⚠️ يرجى إدخال عنوان محفظة BSC')
      setMessageType('error')
      return
    }
    if (amount > (userData?.available_balance || 0)) {
      setMessage('⚠️ الرصيد غير كافٍ')
      setMessageType('error')
      return
    }
    
    // إنشاء طلب سحب
    const { error } = await supabase
      .from('withdrawals')
      .insert({
        user_id: userData?.id,
        amount: amount,
        wallet_address: withdrawAddress,
        status: 'pending'
      })
    
    if (error) {
      setMessage('❌ حدث خطأ، حاول مرة أخرى')
      setMessageType('error')
    } else {
      // تحديث الرصيد المحلي
      const newBalance = (userData?.available_balance || 0) - amount
      setUserData({ ...userData, available_balance: newBalance })
      
      setMessage(`✅ تم استلام طلب سحب ${amount} USDT. سيتم معالجته خلال 24 ساعة.`)
      setMessageType('success')
      setWithdrawAmount('')
      setWithdrawAddress('')
    }
    
    setTimeout(() => setMessage(''), 5000)
  }

  if (loading) {
    return <div style={styles.loading}>جاري التحميل...</div>
  }

  return (
    <div style={styles.container}>
      <nav style={styles.navbar}>
        <h1 style={styles.logo}>💰 CryptoMine</h1>
        <div style={styles.userInfo}>
          <span style={styles.userEmail}>{user?.email}</span>
          <button onClick={handleLogout} style={styles.logoutBtn}>تسجيل خروج</button>
        </div>
      </nav>

      <div style={styles.content}>
        <div style={styles.statsGrid}>
          <div style={styles.statCard}>
            <div style={styles.statIcon}>💰</div>
            <div>
              <p style={styles.statLabel}>الاستثمار النشط</p>
              <p style={styles.statValue}>{userData?.active_deposit || 0} USDT</p>
              <p style={styles.statSub}>العائد: 2% يومياً</p>
            </div>
          </div>
          <div style={styles.statCard}>
            <div style={styles.statIcon}>💎</div>
            <div>
              <p style={styles.statLabel}>الرصيد المتاح</p>
              <p style={styles.statValue}>{userData?.available_balance || 0} USDT</p>
              <p style={styles.statSub}>قابل للسحب</p>
            </div>
          </div>
        </div>

        {message && (
          <div style={messageType === 'success' ? styles.successMsg : styles.errorMsg}>
            {message}
          </div>
        )}

        <div style={styles.twoColumns}>
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>📥 إيداع USDT</h2>
            <p style={styles.walletAddress}>
              <strong>محفظة الإيداع (شبكة BSC):</strong><br />
              <code style={styles.addressCode}>0x987cfde723a87b5ed33329eebe0595a4416b848f</code>
              <button 
                onClick={() => navigator.clipboard.writeText('0x987cfde723a87b5ed33329eebe0595a4416b848f')}
                style={styles.copyBtn}
              >
                📋 نسخ
              </button>
            </p>
            <input
              type="number"
              value={depositAmount}
              onChange={(e) => setDepositAmount(e.target.value)}
              placeholder="المبلغ (USDT) - الحد الأدنى 10"
              style={styles.input}
            />
            <button onClick={handleDeposit} style={styles.depositBtn}>
              تقديم طلب إيداع
            </button>
          </div>

          <div style={styles.card}>
            <h2 style={styles.cardTitle}>📤 سحب الأرباح</h2>
            <p style={styles.balanceInfo}>الرصيد المتاح: <strong>{userData?.available_balance || 0} USDT</strong></p>
            <input
              type="number"
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="المبلغ (USDT) - الحد الأدنى 0.5"
              style={styles.input}
            />
            <input
              type="text"
              value={withdrawAddress}
              onChange={(e) => setWithdrawAddress(e.target.value)}
              placeholder="عنوان محفظة BSC"
              style={styles.input}
            />
            <button onClick={handleWithdraw} style={styles.withdrawBtn}>
              طلب سحب
            </button>
          </div>
        </div>

        <div style={styles.plansSection}>
          <h2 style={styles.sectionTitle}>📊 خطط الاستثمار</h2>
          <div style={styles.plansGrid}>
            {[
              { name: 'مبتدئ', min: 10, roi: '2%' },
              { name: 'محترف', min: 100, roi: '2.5%' },
              { name: 'VIP', min: 500, roi: '3%' },
              { name: 'دياموند', min: 1000, roi: '3.5%' }
            ].map((plan) => (
              <div key={plan.name} style={styles.planCard}>
                <h3 style={styles.planName}>{plan.name}</h3>
                <p style={styles.planRoi}>{plan.roi}</p>
                <p style={styles.planMin}>يومياً</p>
                <p style={styles.planMinAmount}>من {plan.min} USDT</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: '#0f0f1a',
  },
  loading: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#0f0f1a',
    color: 'white',
  },
  navbar: {
    background: '#1a1a2e',
    padding: '16px 32px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #2d3748',
    flexWrap: 'wrap',
    gap: '16px',
  },
  logo: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#e94560',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
  },
  userEmail: {
    color: '#a0aec0',
  },
  logoutBtn: {
    background: 'transparent',
    border: '1px solid #ef4444',
    color: '#ef4444',
    padding: '8px 16px',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  content: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '32px',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '24px',
    marginBottom: '32px',
  },
  statCard: {
    background: '#1a1a2e',
    borderRadius: '16px',
    padding: '24px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    border: '1px solid #2d3748',
  },
  statIcon: {
    fontSize: '40px',
  },
  statLabel: {
    color: '#a0aec0',
    fontSize: '14px',
  },
  statValue: {
    color: 'white',
    fontSize: '24px',
    fontWeight: 'bold',
  },
  statSub: {
    color: '#e94560',
    fontSize: '12px',
  },
  twoColumns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
    gap: '24px',
    marginBottom: '32px',
  },
  card: {
    background: '#1a1a2e',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid #2d3748',
  },
  cardTitle: {
    color: 'white',
    fontSize: '20px',
    marginBottom: '16px',
  },
  walletAddress: {
    background: '#0f0f1a',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '16px',
    color: '#a0aec0',
    fontSize: '12px',
  },
  addressCode: {
    display: 'block',
    wordBreak: 'break-all',
    color: '#e94560',
    margin: '8px 0',
  },
  copyBtn: {
    background: '#2d3748',
    border: 'none',
    color: 'white',
    padding: '4px 12px',
    borderRadius: '6px',
    cursor: 'pointer',
    marginTop: '8px',
  },
  input: {
    width: '100%',
    padding: '12px',
    marginBottom: '12px',
    borderRadius: '8px',
    border: '1px solid #2d3748',
    background: '#0f0f1a',
    color: 'white',
  },
  depositBtn: {
    width: '100%',
    padding: '12px',
    background: '#22c55e',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  withdrawBtn: {
    width: '100%',
    padding: '12px',
    background: '#ef4444',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  balanceInfo: {
    color: '#a0aec0',
    marginBottom: '16px',
  },
  successMsg: {
    background: '#22c55e20',
    border: '1px solid #22c55e',
    color: '#22c55e',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '24px',
    textAlign: 'center',
  },
  errorMsg: {
    background: '#ef444420',
    border: '1px solid #ef4444',
    color: '#ef4444',
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '24px',
    textAlign: 'center',
  },
  plansSection: {
    marginBottom: '32px',
  },
  sectionTitle: {
    color: 'white',
    fontSize: '20px',
    marginBottom: '16px',
  },
  plansGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
  },
  planCard: {
    background: '#1a1a2e',
    borderRadius: '12px',
    padding: '20px',
    textAlign: 'center',
    border: '1px solid #2d3748',
  },
  planName: {
    color: '#e94560',
    fontSize: '18px',
    fontWeight: 'bold',
    marginBottom: '8px',
  },
  planRoi: {
    color: 'white',
    fontSize: '28px',
    fontWeight: 'bold',
  },
  planMin: {
    color: '#a0aec0',
    fontSize: '12px',
  },
  planMinAmount: {
    color: '#e94560',
    fontSize: '12px',
    marginTop: '8px',
  },
}
