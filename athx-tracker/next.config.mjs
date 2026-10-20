/** @type {import("next").NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module: keep the bundler away from it.
  serverExternalPackages: ["better-sqlite3"],

  // Sensible defaults for a login-gated app reachable from the open internet.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
