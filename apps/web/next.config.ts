import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@vsm/api-contracts"],
};

export default nextConfig;
