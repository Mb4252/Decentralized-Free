'use client'
import { useState } from 'react'

export default function DepositModal({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState('')
  
  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
      <div style={{ backgroundColor: '#181a20', width: '100%', maxWidth: '360px', borderRadius: '8px', border: '1px solid #2b3139', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h2 style={{ color: 'white', margin: 0, fontSize: '18px' }}>إيداع (بنكك)</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#848e9c', cursor: 'pointer', fontSize: '18px' }}>✕</button>
        </div>
        
        <p style={{ color: '#848e9c', fontSize: '12px', marginBottom: '16px', lineHeight: '1.5' }}>
          قم بتحويل المبلغ إلى الحساب التالي ثم أدخل رقم عملية بنكك:
          <br /><br />
          <strong style={{ color: 'white' }}>رقم الحساب:</strong> 1234567890
          <br />
          <strong style={{ color: 'white' }}>الاسم:</strong> منصة نيل كوين
        </p>

        <input 
          type="text" 
          placeholder="رقم عملية بنكك" 
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: '100%', padding: '10px', backgroundColor: '#2b3139', color: 'white', border: '1px solid transparent', borderRadius: '4px', marginBottom: '16px', outline: 'none' }} 
        />
        
        <button style={{ width: '100%', padding: '12px', backgroundColor: '#0ecb81', color: 'black', border: 'none', borderRadius: '4px', fontWeight: 'bold', cursor: 'pointer' }}>
          تأكيد الإيداع
        </button>
      </div>
    </div>
  )
}
