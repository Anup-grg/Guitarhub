import type { NextConfig } from "next";

const apiBase = process.env.API_INTERNAL_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  devIndicators: process.env.DEV_INDICATORS === "1" ? { position: "bottom-left" } : false,
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiBase}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
