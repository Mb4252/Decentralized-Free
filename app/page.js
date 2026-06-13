'use client'

import { useState, useEffect } from 'react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const user = localStorage.getItem('user')
    if (user) {
      window.location.href = '/dashboard'
    }
  }, [])

  const handleLogin = (e) => {
    e.preventDefault()
    setLoading(true)
    if (email) {
      localStorage.setItem('user', JSON.stringify({ email, name: email.split('@')[0] }))
      window.location.href = '/dashboard'
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
            {loading ? 'جاري...' : '🚀 تسجيل الدخول'}
          </button>
        </form>

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
}
