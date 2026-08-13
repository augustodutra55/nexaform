/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // P0 produção: fixa a janela longa de geração no bundle do servidor.
  // A env GEN_MAX_MS da Vercel estava efetivamente em ~50s e fazia a rota
  // encerrar com HTTP 504 antes do limite de 300s configurado na Function.
  env: {
    GEN_MAX_MS: "280000",
  },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-DNS-Prefetch-Control", value: "off" },
      { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
    ] }];
  },
};

export default nextConfig;
