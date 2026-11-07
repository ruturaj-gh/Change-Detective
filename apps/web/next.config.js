/** @type {import('next').NextConfig} */
const nextConfig = {
  // The dashboard talks to the local API at 127.0.0.1:3001
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:3001"}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

