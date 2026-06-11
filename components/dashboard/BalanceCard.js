'use client'

export default function BalanceCard({ title, amount, type, icon }) {
  const formattedAmount = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)
  
  return (
    <div className="card bg-gradient-to-r from-blue-500 to-blue-600 text-white">
      <div className="flex justify-between items-start mb-4">
        <div>
          <p className="text-blue-100 text-sm">{title}</p>
          <p className="text-3xl font-bold mt-2">{formattedAmount} USDT</p>
        </div>
        <div className="text-4xl">{icon}</div>
      </div>
      {type === 'active' && (
        <p className="text-blue-100 text-sm">العائد اليومي: 2% - 3.5% حسب المستوى</p>
      )}
    </div>
  )
}
