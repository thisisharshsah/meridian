import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Next writes AGENTS.md/CLAUDE.md by default; this repo manages its own docs.
  agentRules: false,
  // Shipped as TypeScript source, not a build, so Next compiles it like its own.
  transpilePackages: ["@suite/shared"],
};

export default nextConfig;
