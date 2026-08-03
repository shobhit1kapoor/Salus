import type { NextConfig } from "next";
const apiOrigin = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const developmentScriptPolicy = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
const config: NextConfig = {
  transpilePackages: ["@salus/contracts"],
  async headers() {
    return [{ source: "/(.*)", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
      { key: "Content-Security-Policy", value: `default-src 'self'; connect-src 'self' ${apiOrigin}; img-src 'self' data: blob:; media-src 'self' blob: https://d8j0ntlcm91z4.cloudfront.net; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'${developmentScriptPolicy}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` }
    ] }];
  }
};
export default config;
