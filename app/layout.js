import './globals.css'

export const metadata = {
  title: 'CryptoMine',
  description: 'تعدين سحابي - أرباح يومية',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
