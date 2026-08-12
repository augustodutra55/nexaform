const base = (process.env.PRODUCTION_URL || "https://nexaform-rho.vercel.app").replace(/\/$/, "");

const checks = [
  { path: "/", expect: [200], label: "home" },
  { path: "/login", expect: [200], label: "login" },
  { path: "/pricing", expect: [200], label: "pricing" },
  { path: "/api/templates", expect: [200], label: "catálogo de templates" },
  { path: "/api/system/readiness", expect: [401, 403], label: "readiness protegido" },
  { path: "/api/workspaces", expect: [401], label: "workspaces protegido" },
];

let failed = false;
for (const check of checks) {
  const url = `${base}${check.path}`;
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "ad-studio-production-smoke/1.0" },
      signal: AbortSignal.timeout(20000),
    });
    const ok = check.expect.includes(response.status);
    console.log(`${ok ? "PASS" : "FAIL"} ${check.label}: HTTP ${response.status} ${url}`);
    if (!ok) failed = true;
  } catch (error) {
    failed = true;
    console.error(`FAIL ${check.label}: ${url} -> ${error?.message || error}`);
  }
}

if (failed) process.exit(1);
console.log(`Produção operacional em ${base}.`);
