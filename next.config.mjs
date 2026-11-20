/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: process.env.NODE_ENV === 'production' ? '/Decentralized-Free' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/Decentralized-Free/' : '',
};

export default nextConfig;
