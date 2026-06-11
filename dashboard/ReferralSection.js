'use client'

import { useState } from 'react'

export default function ReferralSection({ userData }) {
  const [copied, setCopied] = useState(false)
  
  const referralLink = typeof window !== 'undefined' 
    ? `${window.location.origin}/register?ref=${userData?.referral_code}`
    : ''
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(referralLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <div className="bg-white rounded-xl shadow-md p-6">
      <h3 className="text-xl font-bold mb-4">👥 نظام الإحالات</h3>
      <p className="text-gray-600 mb-3">
        قم بدعوة أصدقائك واحصل على عمولة تصل إلى 5% من استثماراتهم
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={referralLink}
          readOnly
          className="flex-1 px-3 py-2 border rounded-lg bg-gray-50 text-sm"
        />
        <button
          onClick={copyToClipboard}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          {copied ? 'تم النسخ ✓' : 'نسخ الرابط'}
        </button>
      </div>
      {userData?.referral_code && (
        <p className="text-sm text-gray-500 mt-3">
          كود الإحالة الخاص بك: <strong>{userData.referral_code}</strong>
        </p>
      )}
    </div>
  )
}
