'use client'

import { useSession } from "next-auth/react"
import Link from "next/link"
import { redirect } from "next/navigation"

export default function HomePage() {
  const { data: session, status } = useSession()

  // إذا كان المستخدم مسجل الدخول، حوله إلى لوحة التحكم
  if (status === "authenticated") {
    redirect("/dashboard")
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      {/* Navbar */}
      <nav className="bg-white shadow-sm border-b">
        <div className="container mx-auto px-4 py-4 flex justify-between items-center">
          <div className="text-2xl font-bold text-blue-600">
            CryptoInvest
          </div>
          <div className="flex gap-4">
            <Link 
              href="/login" 
              className="px-4 py-2 text-blue-600 hover:text-blue-700 font-medium"
            >
              تسجيل الدخول
            </Link>
            <Link 
              href="/login" 
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              ابدأ الآن
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="container mx-auto px-4 py-20 text-center">
        <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6">
          استثمر في العملات الرقمية
          <span className="text-blue-600"> بثقة وأمان</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          منصة استثمارية متطورة تقدم عوائد يومية تصل إلى 3.5% مع نظام إحالات مميز
        </p>
        <div className="flex gap-4 justify-center">
          <Link 
            href="/login" 
            className="px-8 py-3 bg-blue-600 text-white rounded-lg text-lg font-semibold hover:bg-blue-700 transition"
          >
            ابدأ الاستثمار الآن
          </Link>
          <Link 
            href="#features" 
            className="px-8 py-3 border-2 border-blue-600 text-blue-600 rounded-lg text-lg font-semibold hover:bg-blue-50 transition"
          >
            تعرف على المزيد
          </Link>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="bg-white py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">
            لماذا تختار منصتنا؟
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center p-6 rounded-xl hover:shadow-lg transition">
              <div className="text-5xl mb-4">📈</div>
              <h3 className="text-xl font-bold mb-2">عوائد يومية</h3>
              <p className="text-gray-600">
                احصل على أرباح يومية تصل إلى 3.5% من استثمارك النشط
              </p>
            </div>
            <div className="text-center p-6 rounded-xl hover:shadow-lg transition">
              <div className="text-5xl mb-4">🔒</div>
              <h3 className="text-xl font-bold mb-2">آمن وموثوق</h3>
              <p className="text-gray-600">
                تقنية تشفير متقدمة وحماية كاملة لأموالك وبياناتك
              </p>
            </div>
            <div className="text-center p-6 rounded-xl hover:shadow-lg transition">
              <div className="text-5xl mb-4">👥</div>
              <h3 className="text-xl font-bold mb-2">نظام إحالات</h3>
              <p className="text-gray-600">
                احصل على عمولات إضافية عند دعوة أصدقائك للانضمام
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">
            كيف تعمل المنصة؟
          </h2>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">1</div>
              <h3 className="font-bold mb-2">إنشاء حساب</h3>
              <p className="text-gray-600 text-sm">سجل دخولك باستخدام Google</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">2</div>
              <h3 className="font-bold mb-2">إيداع الأموال</h3>
              <p className="text-gray-600 text-sm">قم بإيداع USDT عبر شبكة BSC</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">3</div>
              <h3 className="font-bold mb-2">احصل على أرباح</h3>
              <p className="text-gray-600 text-sm">استلم أرباحك اليومية تلقائياً</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-2xl font-bold mx-auto mb-4">4</div>
              <h3 className="font-bold mb-2">سحب الأرباح</h3>
              <p className="text-gray-600 text-sm">اسحب أرباحك في أي وقت</p>
            </div>
          </div>
        </div>
      </section>

      {/* Investment Plans */}
      <section className="bg-gray-50 py-20">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">
            خطط الاستثمار
          </h2>
          <div className="grid md:grid-cols-4 gap-6">
            <div className="bg-white rounded-xl p-6 text-center shadow-md hover:shadow-xl transition">
              <h3 className="text-2xl font-bold text-blue-600 mb-2">مبتدئ</h3>
              <p className="text-4xl font-bold my-4">10 USDT<span className="text-sm text-gray-500">+</span></p>
              <p className="text-green-600 font-semibold text-2xl my-2">2% يومياً</p>
              <p className="text-gray-500 text-sm">الحد الأدنى 10 USDT</p>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-md hover:shadow-xl transition relative overflow-hidden">
              <div className="absolute top-0 right-0 bg-yellow-500 text-white px-3 py-1 text-sm rounded-bl-lg">الأكثر طلباً</div>
              <h3 className="text-2xl font-bold text-blue-600 mb-2">محترف</h3>
              <p className="text-4xl font-bold my-4">100 USDT<span className="text-sm text-gray-500">+</span></p>
              <p className="text-green-600 font-semibold text-2xl my-2">2.5% يومياً</p>
              <p className="text-gray-500 text-sm">الحد الأدنى 100 USDT</p>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-md hover:shadow-xl transition">
              <h3 className="text-2xl font-bold text-blue-600 mb-2">VIP</h3>
              <p className="text-4xl font-bold my-4">500 USDT<span className="text-sm text-gray-500">+</span></p>
              <p className="text-green-600 font-semibold text-2xl my-2">3% يومياً</p>
              <p className="text-gray-500 text-sm">الحد الأدنى 500 USDT</p>
            </div>
            <div className="bg-white rounded-xl p-6 text-center shadow-md hover:shadow-xl transition">
              <h3 className="text-2xl font-bold text-blue-600 mb-2">دياموند</h3>
              <p className="text-4xl font-bold my-4">1000 USDT<span className="text-sm text-gray-500">+</span></p>
              <p className="text-green-600 font-semibold text-2xl my-2">3.5% يومياً</p>
              <p className="text-gray-500 text-sm">الحد الأدنى 1000 USDT</p>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="bg-blue-600 text-white py-16">
        <div className="container mx-auto px-4">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div>
              <div className="text-4xl font-bold mb-2">500+</div>
              <p>مستثمر نشط</p>
            </div>
            <div>
              <div className="text-4xl font-bold mb-2">$2.5M+</div>
              <p>إجمالي الاستثمارات</p>
            </div>
            <div>
              <div className="text-4xl font-bold mb-2">$500K+</div>
              <p>أرباح مدفوعة</p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-6">
            جاهز لبدء رحلة الاستثمار؟
          </h2>
          <p className="text-xl text-gray-600 mb-8">
            انضم إلى آلاف المستثمرين وابدأ في جني الأرباح اليومية
          </p>
          <Link 
            href="/login" 
            className="px-8 py-3 bg-blue-600 text-white rounded-lg text-lg font-semibold hover:bg-blue-700 transition inline-block"
          >
            سجل الآن وابدأ الاستثمار
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="container mx-auto px-4 text-center">
          <p>&copy; 2024 CryptoInvest. جميع الحقوق محفوظة.</p>
          <p className="text-sm mt-4">
            الاستثمار في العملات الرقمية يحمل مخاطر. يرجى الاستثمار بمسؤولية.
          </p>
        </div>
      </footer>
    </div>
  )
}
