const { i18n } = require("./next-i18next.config");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Studio: do not advertise the framework in native responses.
  poweredByHeader: false,
  output: "standalone",
  // for serverSideTranslations
  outputFileTracingIncludes: {
    "/**": ["./next-i18next.config.js"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.jsdelivr.net",
      },
    ],
    unoptimized: true,
  },
  i18n,
};

module.exports = nextConfig;
