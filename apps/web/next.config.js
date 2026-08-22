/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit .next/standalone — a self-contained server.js plus only the
  // node_modules the build actually traced. The production Docker stage ships
  // that instead of the full dev+prod node_modules tree. No effect on
  // `next dev`; `next build` just writes an extra .next/standalone directory.
  output: "standalone",
};

module.exports = nextConfig;
