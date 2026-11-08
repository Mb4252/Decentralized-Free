'use client'
import { useState, useEffect } from 'react'
import { supabase, getUserProfile } from '@/lib/supabase'
import { toast } from './Toast'
import { formatNumber } from '@/lib/utils'

export default function P2PModal({ onClose }: { onClose: () => void }) {
  const [ads, setAds] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [selectedAd, setSelectedAd] = useState<any>(null)
  const [amount, setAmount] = useState('')

  // جلب الإعلانات من قاعدة البيانات
  const fetchAds = async () => {
    setLoading(true)
    // جلب الطلبات المفتوحة من جدول orders
    const { data, error } = await supabase
      .from('orders')
      .select('id, side, price, amount, user_id, profiles(username)')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(20)

    if (!error && data) setAds(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchAds()
    getUserProfile().then(setProfile)
  }, [])

  // تنفيذ التداول (مطابقة الطلب)
  const handleTrade = async (ad: any) => {
    if (!profile) return toast('يرجى تسجيل الدخول أولاً', 'error')
    const tradeAmount = Number(amount)
    if (tradeAmount <= 0 || tradeAmount > ad.amount) {
      return toast('الكمية غير صالحة أو تتجاوز المتاح', 'error')
    }

    setLoading(true)
    try {
      // إدخال طلب معاكس ليتم مطابقته تلقائياً بواسطة محرك التداول (Matching Engine) في قاعدة البيانات
      const oppositeSide = ad.side === 'buy' ? 'sell' : 'buy'
      
      const { error } = await supabase.from('orders').insert({
        user_id: profile.id,
        side: oppositeSide,
        price: ad.price,
        amount: tradeAmount,
        status: 'open'
      })

      if (error) throw error

      toast('تم تنفيذ الصفقة بنجاح!', 'success')
      onClose() // إغلاق النافذة
      window.location.reload() // تحديث الصفحة لرؤية الرصيد الجديد
    } catch (err: any) {
      toast(err.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" dir="rtl">
      <div className="bg-[#181a20] rounded-lg w-full max-w-md border border-[#2b3139] max-h-[85vh] flex flex-col">
        
        {/* رأس النافذة */}
        <div className="flex justify-between items-center p-4 border-b border-[#2b3139]">
          <h2 className="text-white font-bold text-sm">سوق P2P (إعلانات)</h2>
          <button onClick={onClose} className="text-[#848e9c] hover:text-white text-xl leading-none">&times;</button>
        </div>

        {/* محتوى النافذة */}
        <div className="p-4 overflow-y-auto flex-1 space-y-3">
          {loading && !ads.length ? (
            <div className="text-center text-[#848e9c] text-xs py-4">جاري التحميل...</div>
          ) : ads.length === 0 ? (
            <div className="text-center text-[#848e9c] text-xs py-4">لا توجد إعلانات متاحة حالياً</div>
          ) : (
            ads.map(ad => (
              <div key={ad.id} className="bg-[#2b3139] p-3 rounded-md">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-white text-xs font-bold">{ad.profiles?.username || 'مستخدم'}</span>
                  <span className={`text-xs font-bold ${ad.side === 'sell' ? 'text-[#f6465d]' : 'text-[#0ecb81]'}`}>
                    {ad.side === 'sell' ? 'يبيع NIL' : 'يشتري NIL'}
                  </span>
                </div>
                
                <div className="text-[#eaecef] text-sm mb-1">
                  السعر: <span className="font-mono">{formatNumber(ad.price, 2)}</span> SDG
                </div>
                <div className="text-[#848e9c] text-[10px] mb-3">
                  المتاح: <span className="font-mono">{formatNumber(ad.amount, 2)}</span> NIL
                </div>

                {/* إذا تم اختيار الإعلان، تظهر خانة الكمية وزر التنفيذ */}
                {selectedAd?.id === ad.id ? (
                  <div className="flex gap-2 mt-2">
                    <input 
                      type="number" 
                      placeholder="الكمية" 
                      value={amount} 
                      onChange={e => setAmount(e.target.value)}
                      className="w-full bg-[#181a20] text-white border border-[#2b3139] rounded px-2 py-1.5 text-xs outline-none text-right font-mono focus:border-[#0ecb81]" 
                    />
                    <button 
                      onClick={() => handleTrade(ad)}
                      className={`px-4 rounded font-bold text-xs ${ad.side === 'sell' ? 'bg-[#0ecb81] text-black' : 'bg-[#f6465d] text-white'}`}
                    >
                      تأكيد
                    </button>
                  </div>
                ) : (
                  <button 
                    onClick={() => { setSelectedAd(ad); setAmount(ad.amount.toString()) }}
                    className={`w-full py-1.5 rounded text-xs font-bold ${ad.side === 'sell' ? 'bg-[#0ecb81] text-black' : 'bg-[#f6465d] text-white'}`}
                  >
                    تداول
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
