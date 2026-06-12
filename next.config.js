/** @type {import('next').NextConfig} */
const nextConfig = {
  // قم بإزالة experimental.serverActions
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        fs: false,
        net: false,
        tls: false,
        undici: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
