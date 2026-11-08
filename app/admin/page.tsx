'use client'
// ... (نفس الاستيرادات السابقة)

export default function AdminPage() {
  // ... (نفس الـ States السابقة)
  const [deposits, setDeposits] = useState<any[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])

  async function loadDeposits() {
    const { data: d } = await supabase.from('deposits').select('*, profiles(username)').eq('status', 'pending')
    const { data: w } = await supabase.from('withdrawals').select('*, profiles(username)').eq('status', 'pending')
    if (d) setDeposits(d)
    if (w) setWithdrawals(w)
  }

  // أضف loadDeposits() داخل useEffect و load()

  async function approveDeposit(dep: any) {
    // إضافة الرصيد
    await supabase.from('deposits').update({ status: 'approved' }).eq('id', dep.id)
    await supabase.rpc('admin_add_balance', { target_email: dep.profiles.username, nils: 0, sdgs: dep.amount })
    // أو قم بتحديث الرصيد يدوياً هنا
    loadDeposits()
    alert('تمت الموافقة')
  }

  return (
    <div className="p-4">
      {/* ... الأكواد السابقة ... */}

      <h2 className="text-white text-xl mt-8 mb-4">طلبات الإيداع</h2>
      {deposits.map(d => (
        <div key={d.id} className="bg-slate-800 p-3 rounded mb-2 flex justify-between text-white">
          <span>{d.profiles?.username || 'مستخدم'} يطلب إيداع: {d.amount} SDG</span>
          <button onClick={() => approveDeposit(d)} className="bg-green-600 px-3 py-1 rounded">موافقة</button>
        </div>
      ))}

      <h2 className="text-white text-xl mt-8 mb-4">طلبات السحب</h2>
      {withdrawals.map(w => (
        <div key={w.id} className="bg-slate-800 p-3 rounded mb-2 flex justify-between text-white">
          <span>{w.profiles?.username || 'مستخدم'} يطلب سحب: {w.amount} SDG</span>
          <button onClick={() => {}} className="bg-blue-600 px-3 py-1 rounded">إرسال</button>
        </div>
      ))}
    </div>
  )
}
