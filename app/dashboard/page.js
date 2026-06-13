'use client'

import { useState, useEffect } from 'react'

export default function DashboardPage() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const storedUser = localStorage.getItem('user')
    if (!storedUser) {
      window.location.href = '/'
      return
    }
    setUser(JSON.parse(storedUser))
    setLoading(false)
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('user')
    window.location.href = '/'
  }

  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#1a1a2e', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>جاري التحميل...</div>
  }

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a2e' }}>
      <nav style={{ background: '#16213e', padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ color: '#7c3aed', fontSize: '24px' }}>CryptoMine</h1>
        <button onClick={handleLogout} style={{ background: 'transparent', border: '1px solid #ef4444', color: '#ef4444', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer' }}>تسجيل خروج</button>
      </nav>
      <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
        <div style={{ background: '#16213e', borderRadius: '16px', padding: '24px', marginBottom: '24px' }}>
          <p style={{ color: '#94a3b8' }}>مرحباً</p>
          <p style={{ color: 'white', fontSize: '20px' }}>{user?.email}</p>
        </div>
        <div style={{ background: '#16213e', borderRadius: '16px', padding: '24px' }}>
          <p style={{ color: '#fbbf24', marginBottom: '12px' }}>محفظة الإيداع (شبكة BSC)</p>
          <code style={{ color: '#94a3b8', wordBreak: 'break-all' }}>0x987cfde723a87b5ed33329eebe0595a4416b848f</code>
        </div>
      </div>
    </div>
  )
}
