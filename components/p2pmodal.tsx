'use client'
import { useState } from 'react'

export default function P2PModal({ onClose }: { onClose: () => void }) {
  // بيانات وهمية للعرض (يجب جلبها من الداتابيز)
  const [ads] = useState([
    { id: 1, seller: 'Ahmed', price: 1300, min: 10, max: 500, type: 'sell' },
    { id: 2, seller: 'Ali', price: 1280, min: 50, max: 1000, type: 'buy' },
  ])

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div style={{ backgroundColor: '#181a20', padding: '20px', borderRadius: '8px', width: '90%', maxWidth: '400px', border: '1px solid #2b3139', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
          <h2 style={{ color: 'white', fontSize: '16px', margin: 0 }}>سوق P2P (إعلانات)</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#848e9c', fontSize: '20px' }}>×</button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {ads.map(ad => (
            <div key={ad.id} style={{ backgroundColor: '#2b3139', padding: '12px', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: 'white', fontWeight: 'bold' }}>{ad.seller}</span>
                <span style={{ color: ad.type === 'sell' ? '#0ecb81' : '#f6465d' }}>{ad.type === 'sell' ? 'يبيع' : 'يشتري'} NIL</span>
              </div>
              <div style={{ color: '#eaecef', fontSize: '14px', marginBottom: '4px' }}>السعر: {ad.price} SDG</div>
              <div style={{ color: '#848e9c', fontSize: '11px', marginBottom: '12px' }}>الحد الأدنى: {ad.min} - الأقصى: {ad.max}</div>
              <button style={{ width: '100%', padding: '8px', backgroundColor: ad.type === 'sell' ? '#0ecb81' : '#f6465d', color: ad.type === 'sell' ? 'black' : 'white', border: 'none', borderRadius: '4px', fontWeight: 'bold' }}>تداول</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
