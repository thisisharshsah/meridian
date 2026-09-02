import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next writes AGENTS.md/CLAUDE.md by default; this repo manages its own docs.
  agentRules: false,
};

export default nextConfig;
