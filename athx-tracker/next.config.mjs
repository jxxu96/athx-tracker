/** @type {import("next").NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module: keep the bundler away from it.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
