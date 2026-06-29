import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "http://172.19.155.196:3000",
    "http://172.19.154.32:3000",
    "http://172.19.152.86:3000",
  ],
};

export default nextConfig;
