'use client'
import { useEffect, useState } from 'react'

type ToastMsg = { id: number; text: string; type: 'success' | 'error' | 'info' }

let toastId = 0
const listeners: Array<(t: ToastMsg) => void> = []

export function toast(text: string, type: 'success' | 'error' | 'info' = 'info') {
  const t: ToastMsg = { id: ++toastId, text, type }
  listeners.forEach(fn => fn(t))
}

export default function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([])

  useEffect(() => {
    const handler = (t: ToastMsg) => {
      setItems(prev => [...prev, t])
      setTimeout(() => setItems(prev => prev.filter(i => i.id !== t.id)), 3500)
    }
    listeners.push(handler)
    return () => {
      const idx = listeners.indexOf(handler)
      if (idx >= 0) listeners.splice(idx, 1)
    }
  }, [])

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 space-y-2 w-[90%] max-w-sm">
      {items.map(i => (
        <div key={i.id}
          className={`px-4 py-2 rounded shadow-lg text-sm text-white text-center ${
            i.type === 'success' ? 'bg-green-600' :
            i.type === 'error' ? 'bg-red-600' : 'bg-slate-700'
          }`}>
          {i.text}
        </div>
      ))}
    </div>
  )
}
