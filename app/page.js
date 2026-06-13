'use client'

import { useState, useEffect } from 'react'

export default function HomePage() {
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
      localStorage.setItem('user', JSON.stringify({ email }))
      window.location.href = '/dashboard'
    }
    setLoading(false)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#16213e', padding: '40px', borderRadius: '20px', width: '350px', textAlign: 'center' }}>
        <h1 style={{ color: '#7c3aed', fontSize: '28px', marginBottom: '10px' }}>CryptoMine</h1>
        <p style={{ color: '#94a3b8', marginBottom: '30px' }}>تعدين سحابي آمن</p>
        <form onSubmit={handleLogin}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="البريد الإلكتروني"
            style={{ width: '100%', padding: '12px', marginBottom: '16px', borderRadius: '8px', border: 'none', background: '#0f172a', color: 'white' }}
            required
          />
          <button
            type="submit"
            style={{ width: '100%', padding: '12px', background: '#7c3aed', border: 'none', borderRadius: '8px', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}
            disabled={loading}
          >
            {loading ? 'جاري...' : 'تسجيل الدخول'}
          </button>
        </form>
      </div>
    </div>
  )
}
