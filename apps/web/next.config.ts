import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ["@vsm/api-contracts", "@vsm/simulation-core"],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  experimental: { cpus: 1 },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL ?? "http://localhost:3100"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
