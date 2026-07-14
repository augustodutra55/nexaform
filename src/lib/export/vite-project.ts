import type { AppFile } from "@/lib/engine/app-types";

export interface ExportFile {
  path: string;
  content: string;
}

interface BuildViteProjectOptions {
  files: AppFile[];
  entry: string;
  projectName: string;
  projectId: string;
  apiOrigin: string;
}

const PACKAGE_VERSIONS: Record<string, string> = {
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "lucide-react": "^0.468.0",
  "react-icons": "^5.4.0",
  "framer-motion": "^11.15.0",
  recharts: "^2.15.0",
  swiper: "^11.2.0",
  clsx: "^2.1.1",
  lodash: "^4.17.21",
  "date-fns": "^4.1.0",
  sonner: "^1.7.0",
};

function normalizedPath(value: string): string {
  const path = value.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === ".." || part === ".")) {
    throw new Error(`Caminho de arquivo inválido: ${value}`);
  }
  return parts.join("/");
}

function packageName(specifier: string): string | null {
  if (!specifier || specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("#")) return null;
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character] as string));
}

export function collectDependencies(files: AppFile[]): Record<string, string> {
  const dependencies: Record<string, string> = {
    react: PACKAGE_VERSIONS.react,
    "react-dom": PACKAGE_VERSIONS["react-dom"],
  };
  const source = files.map((file) => file.content).join("\n");
  const patterns = [
    /from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source))) {
      const name = packageName(match[1]);
      if (name && !dependencies[name]) dependencies[name] = PACKAGE_VERSIONS[name] || "latest";
    }
  }
  return dependencies;
}

function adRuntime(projectId: string): string {
  return `const PID = import.meta.env.VITE_AD_PROJECT_ID || ${JSON.stringify(projectId)};
const TOKEN_KEY = 'adstudio:app-token:' + PID;
const endpoint = (kind) => '/api/ad/' + kind + '/' + PID;
const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const setToken = (value) => { try { value ? localStorage.setItem(TOKEN_KEY, value) : localStorage.removeItem(TOKEN_KEY); } catch {} };

async function request(kind, method = 'GET', options = {}) {
  const headers = new Headers();
  const authToken = token();
  if (authToken && kind !== 'view') headers.set('authorization', 'Bearer ' + authToken);
  let body;
  if (options.file) {
    body = new FormData(); body.append('file', options.file);
  } else if (options.body !== undefined && method !== 'GET') {
    headers.set('content-type', 'application/json'); body = JSON.stringify(options.body);
  }
  const response = await fetch(endpoint(kind) + (options.qs || ''), { method, headers, body });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || ('Erro ' + response.status));
  return payload;
}
function query(collection, options = {}) {
  let qs = '?collection=' + encodeURIComponent(collection || 'default');
  if (options.where) qs += '&where=' + encodeURIComponent(JSON.stringify(options.where));
  if (options.search) qs += '&search=' + encodeURIComponent(options.search);
  if (options.searchField) qs += '&searchField=' + encodeURIComponent(options.searchField);
  if (options.sort) qs += '&sort=' + encodeURIComponent(options.sort);
  if (options.limit != null) qs += '&limit=' + encodeURIComponent(options.limit);
  if (options.offset != null) qs += '&offset=' + encodeURIComponent(options.offset);
  return qs;
}

export function installADRuntime() {
  let speechRequest = 0;
  function voiceScore(voice, requestedLang) {
    const requested = String(requestedLang || 'pt-BR').toLowerCase().replace('_', '-');
    const language = String(voice?.lang || '').toLowerCase().replace('_', '-');
    if (language.split('-')[0] !== requested.split('-')[0]) return -100000;
    const name = String(voice?.name || '').toLowerCase();
    let score = language === requested ? 1000 : 600;
    if (voice.localService) score += 180;
    if (voice.default) score += 30;
    if (/enhanced|premium|natural|neural/.test(name)) score += 180;
    if (/samantha|ava|allison|alex|victoria|karen|daniel|serena|tessa|fiona|moira|luciana|joana|felipe/.test(name)) score += 150;
    if (/google.*(english|portugu|brazil)|microsoft.*natural/.test(name)) score += 80;
    if (/compact|eloquence|novelty|zarvox|trinoids|whisper|boing|bubbles|cellos|organ|bells|bad news|good news/.test(name)) score -= 600;
    return score;
  }
  function preferredVoice(lang) {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    let best = null, bestScore = -100000;
    for (const voice of voices) { const score = voiceScore(voice, lang); if (score > bestScore) { best = voice; bestScore = score; } }
    return bestScore > -100000 ? best : null;
  }
  try { window.speechSynthesis?.getVoices?.(); } catch {}
  function listen(options = {}) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) return Promise.reject(new Error('Reconhecimento de voz não disponível. Use Chrome ou Edge atualizado.'));
    return new Promise((resolve, reject) => {
      const recognition = new Recognition();
      recognition.lang = options.lang || 'pt-BR'; recognition.interimResults = false; recognition.continuous = false;
      let transcript = '';
      recognition.onresult = (event) => { for (let index = event.resultIndex || 0; index < event.results.length; index++) transcript += event.results[index][0]?.transcript || ''; };
      recognition.onerror = (event) => reject(new Error(event.error === 'not-allowed' ? 'Permissão do microfone bloqueada.' : 'Falha no reconhecimento de voz: ' + event.error));
      recognition.onend = () => transcript.trim() ? resolve(transcript.trim()) : reject(new Error('Nenhuma fala foi reconhecida.'));
      recognition.start();
    });
  }
  function speak(text, options = {}) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return Promise.reject(new Error('Leitura em voz alta indisponível.'));
    const utterance = new SpeechSynthesisUtterance(String(text || ''));
    utterance.lang = options.lang || 'pt-BR'; utterance.rate = options.rate || 1; utterance.pitch = options.pitch || 1; utterance.volume = options.volume == null ? 1 : options.volume;
    utterance.voice = preferredVoice(utterance.lang);
    const queueWasBusy = window.speechSynthesis.speaking || window.speechSynthesis.pending || window.speechSynthesis.paused;
    const request = ++speechRequest;
    if (queueWasBusy) window.speechSynthesis.cancel();
    const play = () => { if (request !== speechRequest) return; window.speechSynthesis.resume(); window.speechSynthesis.speak(utterance); };
    if (queueWasBusy) window.setTimeout(play, 120); else play();
    return Promise.resolve({ speaking: true });
  }
  window.AD = {
    enabled: true,
    list: (collection, options) => request('data', 'GET', { qs: query(collection, options) }).then((r) => r.items || []),
    get: (collection, id) => request('data', 'GET', { qs: query(collection) + '&id=' + encodeURIComponent(id) }).then((r) => r.item || null),
    count: (collection, where) => request('data', 'GET', { qs: query(collection, { where }) + '&count=1' }).then((r) => r.count || 0),
    insert: (collection, data) => request('data', 'POST', { body: { collection: collection || 'default', data: data || {} } }).then((r) => r.item),
    update: (id, data) => request('data', 'PATCH', { body: { id, data: data || {} } }).then((r) => r.item),
    remove: (id) => request('data', 'DELETE', { qs: '?id=' + encodeURIComponent(id) }).then(() => true),
    upload: (file) => request('upload', 'POST', { file }).then((r) => r.url),
    email: (payload) => request('email', 'POST', { body: payload || {} }),
    voice: { listen, speak, cancel: () => { speechRequest++; window.speechSynthesis?.cancel(); return Promise.resolve(); } },
    auth: {
      signUp: (email, password, name) => request('app-auth', 'POST', { body: { action: 'signup', email, password, name } }).then((r) => { setToken(r.token); return r.user; }),
      signIn: (email, password) => request('app-auth', 'POST', { body: { action: 'login', email, password } }).then((r) => { setToken(r.token); return r.user; }),
      signOut: () => request('app-auth', 'POST', { body: { action: 'logout' } }).catch(() => null).then(() => { setToken(null); return true; }),
      me: () => request('app-auth', 'GET', { qs: '?me=1' }).then((r) => r.user || null).catch(() => null),
      token,
    },
  };
  request('view', 'POST').catch(() => null);
}
`;
}

export function buildViteProject(options: BuildViteProjectOptions): ExportFile[] {
  const files = options.files.map((file) => ({ path: normalizedPath(file.path), content: file.content }));
  const entry = normalizedPath(options.entry);
  if (!files.some((file) => file.path === entry)) throw new Error(`Arquivo de entrada não encontrado: ${entry}`);

  const packageNameValue = options.projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "ad-studio-app";
  const origin = new URL(options.apiOrigin).origin;
  const displayName = escapeHtml(options.projectName);
  const dependencies = collectDependencies(files);
  const generated = files.map((file) => ({ path: `src/generated/${file.path}`, content: file.content }));
  const entryImport = `./generated/${entry}`;

  const scaffold: ExportFile[] = [
    { path: "package.json", content: JSON.stringify({
      name: packageNameValue, private: true, version: "1.0.0", type: "module",
      scripts: { dev: "vite", build: "vite build", preview: "vite preview" },
      dependencies,
      devDependencies: { "@vitejs/plugin-react": "^4.3.4", vite: "^6.0.7", tailwindcss: "^3.4.17", postcss: "^8.5.1", autoprefixer: "^10.4.20" },
    }, null, 2) + "\n" },
    { path: "index.html", content: `<!doctype html>\n<html lang="pt-BR">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <meta name="description" content="${displayName}" />\n  <title>${displayName}</title>\n</head>\n<body>\n  <div id="root"></div>\n  <script type="module" src="/src/main.jsx"></script>\n</body>\n</html>\n` },
    { path: "src/main.jsx", content: `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from ${JSON.stringify(entryImport)};\nimport './styles.css';\nimport { installADRuntime } from './ad-runtime.js';\n\ninstallADRuntime();\nReactDOM.createRoot(document.getElementById('root')).render(\n  <React.StrictMode><App /></React.StrictMode>\n);\n` },
    { path: "src/styles.css", content: "@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\nhtml, body, #root { min-height: 100%; margin: 0; }\n" },
    { path: "src/ad-runtime.js", content: adRuntime(options.projectId) },
    { path: "vite.config.js", content: `import { defineConfig } from 'vite';\nimport react from '@vitejs/plugin-react';\n\nexport default defineConfig({\n  plugins: [react()],\n  server: {\n    proxy: {\n      '/api/ad': { target: ${JSON.stringify(origin)}, changeOrigin: true, rewrite: (path) => path.replace(/^\\/api\\/ad/, '/api') },\n    },\n  },\n});\n` },
    { path: "tailwind.config.js", content: "export default { content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'], theme: { extend: {} }, plugins: [] };\n" },
    { path: "postcss.config.js", content: "export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n" },
    { path: "vercel.json", content: JSON.stringify({ rewrites: ["data", "upload", "email", "app-auth", "view"].map((kind) => ({ source: `/api/ad/${kind}/:path*`, destination: `${origin}/api/${kind}/:path*` })) }, null, 2) + "\n" },
    { path: ".env.example", content: `VITE_AD_PROJECT_ID=${options.projectId}\n` },
    { path: ".gitignore", content: "node_modules\ndist\n.env.local\n.DS_Store\n" },
    { path: "README.md", content: `# ${options.projectName}\n\nProjeto React + Vite exportado pelo AD Studio.\n\n## Rodar\n\n\`\`\`bash\nnpm install\ncp .env.example .env\nnpm run dev\n\`\`\`\n\n## Publicar\n\nExecute \`npm run build\` ou conecte este repositório à Vercel. O arquivo \`vercel.json\` mantém o backend \`window.AD\` ligado ao projeto original.\n\n## Dados e formulários\n\nAs permissões das coleções continuam administradas no painel Dados do AD Studio. Para uma entrega com backend totalmente transferido ao cliente, migre o banco antes de remover o proxy.\n\nOrigem atual do backend: ${origin}\nProjeto: ${options.projectId}\n` },
  ];
  return scaffold.concat(generated);
}
