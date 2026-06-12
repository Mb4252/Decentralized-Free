/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['lh3.googleusercontent.com'],
  },
  experimental: {
    serverActions: true,
  },
  // منع ترجمة حزم Firebase
  transpilePackages: ['firebase', '@firebase/auth', 'undici'],
  webpack: (config, { isServer }) => {
    // تجاهل بعض التحذيرات
    config.ignoreWarnings = [{ module: /node_modules\/undici/ }];
    
    if (!isServer) {
      // لا تحل هذه الحزم على العميل
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        undici: false,
      };
    }
    return config;
  },
}

module.exports = nextConfig
