import './globals.css'

export const metadata = {
  title: 'Crypto Platform',
  description: 'Investment Platform',
}

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  )
}
