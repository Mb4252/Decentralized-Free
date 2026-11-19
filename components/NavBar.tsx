'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function NavBar() {
  const pathname = usePathname();
  const links = [
    { href: '/', label: 'الرئيسية', icon: '🏠' },
    { href: '/prices', label: 'الأسعار', icon: '📊' },
    { href: '/barter', label: 'المقايضة', icon: '🔄' },
    { href: '/add', label: 'إضافة', icon: '➕' },
  ];

  return (
    <nav className="fixed bottom-0 w-full bg-white border-t border-slate-200 flex justify-around py-2 z-50 md:top-0 md:bottom-auto md:border-b md:border-t-0">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className={`flex flex-col items-center text-xs ${
            pathname === link.href ? 'text-teal-600 font-bold' : 'text-slate-500'
          }`}
        >
          <span className="text-xl mb-1">{link.icon}</span>
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
