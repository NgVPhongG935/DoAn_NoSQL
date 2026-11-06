import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_SERVER } from "next/constants";
import { getJwtSecret } from "./src/lib/security-config";

const nextConfig: NextConfig = {
  serverExternalPackages: ["cassandra-driver"],
  devIndicators: { position: "bottom-right" },

};

export default function configure(phase: string): NextConfig {
  // In this Next version, production instrumentation is lazy until a request.
  // Validate during config loading as well so `next start` itself fails closed.
  if (phase === PHASE_PRODUCTION_SERVER || phase === PHASE_DEVELOPMENT_SERVER) {
    getJwtSecret();
  }
  // Keep local dev output separate from files owned by another Windows account.
  return phase === PHASE_DEVELOPMENT_SERVER
    ? { ...nextConfig, distDir: ".next/local" }
    : nextConfig;
}
