'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const checkUser = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        window.location.href = '/dashboard'
      }
    }
    checkUser()
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: true,
      }
    })

    if (error) {
      setError(error.message)
    } else {
      setError('✅ تم إرسال رابط السحر إلى بريدك الإلكتروني!')
    }
    setLoading(false)
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>💰 CryptoMine</h1>
        <p style={styles.subtitle}>تعدين سحابي | أرباح يومية تصل إلى 3.5%</p>
        
        <form onSubmit={handleLogin} style={styles.form}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="البريد الإلكتروني"
            style={styles.input}
            required
          />
          <button
            type="submit"
            disabled={loading}
            style={styles.button}
          >
            {loading ? 'جاري...' : '🚀 إرسال رابط السحر'}
          </button>
        </form>

        {error && (
          <p style={error.includes('✅') ? styles.successMsg : styles.errorMsg}>
            {error}
          </p>
        )}

        <div style={styles.stats}>
          <div style={styles.statBox}>
            <span style={styles.statNumber}>5,941+</span>
            <span style={styles.statLabel}>مستخدم نشط</span>
          </div>
          <div style={styles.statBox}>
            <span style={styles.statNumber}>$64K+</span>
            <span style={styles.statLabel}>إجمالي الأرباح</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  },
  card: {
    background: '#0f3460',
    borderRadius: '24px',
    padding: '40px',
    maxWidth: '450px',
    width: '100%',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  title: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#e94560',
    textAlign: 'center',
    marginBottom: '8px',
  },
  subtitle: {
    color: '#a0aec0',
    textAlign: 'center',
    marginBottom: '32px',
    fontSize: '14px',
  },
  form: {
    marginBottom: '32px',
  },
  input: {
    width: '100%',
    padding: '14px',
    marginBottom: '16px',
    borderRadius: '12px',
    border: 'none',
    background: '#1a1a2e',
    color: 'white',
    fontSize: '16px',
  },
  button: {
    width: '100%',
    padding: '14px',
    background: '#e94560',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
  },
  stats: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  statBox: {
    background: '#1a1a2e',
    padding: '16px',
    borderRadius: '12px',
    textAlign: 'center',
  },
  statNumber: {
    display: 'block',
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#e94560',
  },
  statLabel: {
    display: 'block',
    fontSize: '12px',
    color: '#a0aec0',
  },
  errorMsg: {
    color: '#ef4444',
    textAlign: 'center',
    marginTop: '16px',
    fontSize: '14px',
  },
  successMsg: {
    color: '#22c55e',
    textAlign: 'center',
    marginTop: '16px',
    fontSize: '14px',
  },
}
