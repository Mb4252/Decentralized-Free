'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'الرئيسية' },
  { href: '/wallet', label: 'المحفظة' },
  { href: '/send', label: 'تحويل' },
  { href: '/services', label: 'الخدمات' },
  { href: '/ledger', label: 'السجل' },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="bg-white/90 backdrop-blur border-b border-chronos-200 sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="font-bold text-chronos-700 text-lg">
          ⏳ Chronos
        </Link>
        <div className="flex gap-1 flex-wrap">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
                pathname === l.href
                  ? 'bg-chronos-600 text-white'
                  : 'text-chronos-700 hover:bg-chronos-100'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
