"use client";

import { useState } from "react";
import { AppRunner } from "@/components/preview/app-runner";
import type { RuntimeAuditReport } from "@/lib/preview/runtime-audit";

const GENERATED_APP_FIXTURE = String.raw`
function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [screen, setScreen] = useState('dashboard');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [products, setProducts] = useState([
    { id: 1, name: 'Plano Essencial', price: '99,90' },
    { id: 2, name: 'Plano Profissional', price: '199,90' }
  ]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [editingId, setEditingId] = useState(null);

  function submitLogin(event) {
    event.preventDefault();
    if (!email.includes('@') || password.length < 8) {
      setLoginError('Informe um e-mail válido e uma senha com pelo menos 8 caracteres.');
      return;
    }
    setLoginError('');
    setAuthenticated(true);
    setScreen('dashboard');
  }

  function submitProduct(event) {
    event.preventDefault();
    if (!name.trim() || !price.trim()) return;
    if (editingId !== null) {
      setProducts(function (current) {
        return current.map(function (product) {
          return product.id === editingId
            ? { id: product.id, name: name.trim(), price: price.trim() }
            : product;
        });
      });
    } else {
      setProducts(function (current) {
        return current.concat({ id: Date.now(), name: name.trim(), price: price.trim() });
      });
    }
    setName('');
    setPrice('');
    setEditingId(null);
  }

  function editProduct(product) {
    setEditingId(product.id);
    setName(product.name);
    setPrice(product.price);
  }

  function removeProduct(id) {
    setProducts(function (current) {
      return current.filter(function (product) { return product.id !== id; });
    });
  }

  function logout() {
    setAuthenticated(false);
    setEmail('');
    setPassword('');
    setScreen('dashboard');
  }

  if (!authenticated) {
    return (
      <main className="min-h-full bg-slate-950 px-4 py-10 text-slate-100" data-testid="login-screen">
        <section className="mx-auto max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          <p className="mb-2 text-sm font-semibold text-violet-300">AD Negócios</p>
          <h1 className="text-3xl font-bold">Acesse sua operação</h1>
          <p className="mt-2 text-sm text-slate-400">Entre para administrar produtos e clientes.</p>
          <form className="mt-6 space-y-4" onSubmit={submitLogin} noValidate>
            <div>
              <label htmlFor="login-email" className="mb-1 block text-sm font-medium">E-mail</label>
              <input id="login-email" data-testid="login-email" type="email" value={email}
                onChange={function (event) { setEmail(event.target.value); }}
                className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2"
                placeholder="voce@empresa.com" />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1 block text-sm font-medium">Senha</label>
              <input id="login-password" data-testid="login-password" type="password" value={password}
                onChange={function (event) { setPassword(event.target.value); }}
                className="w-full rounded-xl border border-slate-600 bg-slate-800 px-3 py-2"
                placeholder="Mínimo de 8 caracteres" />
            </div>
            {loginError
              ? <p role="alert" className="rounded-lg bg-red-500/15 p-3 text-sm text-red-200">{loginError}</p>
              : null}
            <button type="submit" className="w-full rounded-xl bg-violet-500 px-4 py-2.5 font-semibold">
              Entrar
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-full bg-slate-100 text-slate-900" data-testid="authenticated-app">
      <header className="border-b border-slate-200 bg-white px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <strong className="text-xl">AD Negócios</strong>
          <nav aria-label="Menu principal" className="flex flex-wrap gap-2">
            <button type="button" onClick={function () { setScreen('dashboard'); }} className="rounded-lg px-3 py-2">Painel</button>
            <button type="button" onClick={function () { setScreen('products'); }} className="rounded-lg px-3 py-2">Produtos</button>
            <button type="button" onClick={function () { setScreen('clients'); }} className="rounded-lg px-3 py-2">Clientes</button>
            <button type="button" onClick={logout} className="rounded-lg bg-slate-900 px-3 py-2 text-white">Sair</button>
          </nav>
        </div>
      </header>

      {screen === 'dashboard' ? (
        <main className="mx-auto max-w-5xl p-4" data-testid="dashboard-screen">
          <h1 className="text-3xl font-bold">Painel da operação</h1>
          <p className="mt-2 text-slate-600">Acompanhe os principais indicadores do negócio.</p>
          <section className="mt-6 grid gap-4 sm:grid-cols-3">
            <article className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Produtos</h2><p className="mt-2 text-3xl font-bold">{products.length}</p>
            </article>
            <article className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Clientes ativos</h2><p className="mt-2 text-3xl font-bold">18</p>
            </article>
            <article className="rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="font-semibold">Conversão</h2><p className="mt-2 text-3xl font-bold">24%</p>
            </article>
          </section>
        </main>
      ) : null}

      {screen === 'products' ? (
        <main className="mx-auto max-w-5xl p-4" data-testid="products-screen">
          <h1 className="text-3xl font-bold">Cadastro de produtos</h1>
          <form onSubmit={submitProduct} className="mt-5 grid gap-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-[1fr_180px_auto]">
            <div>
              <label htmlFor="product-name" className="mb-1 block text-sm font-medium">Nome do produto</label>
              <input id="product-name" data-testid="product-name" value={name}
                onChange={function (event) { setName(event.target.value); }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="Ex.: Plano Premium" />
            </div>
            <div>
              <label htmlFor="product-price" className="mb-1 block text-sm font-medium">Preço</label>
              <input id="product-price" data-testid="product-price" value={price}
                onChange={function (event) { setPrice(event.target.value); }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2"
                placeholder="199,90" />
            </div>
            <button type="submit" className="self-end rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white">
              {editingId !== null ? 'Salvar edição' : 'Adicionar produto'}
            </button>
          </form>
          <section aria-label="Lista de produtos" className="mt-5 space-y-3">
            {products.map(function (product) {
              return (
                <article key={product.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm">
                  <div>
                    <h2 className="font-semibold">{product.name}</h2>
                    <p className="text-sm text-slate-600">R$ {product.price}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={function () { editProduct(product); }}
                      className="rounded-lg border border-slate-300 px-3 py-2">Editar {product.name}</button>
                    <button type="button" onClick={function () { removeProduct(product.id); }}
                      className="rounded-lg bg-red-600 px-3 py-2 text-white">Excluir {product.name}</button>
                  </div>
                </article>
              );
            })}
          </section>
        </main>
      ) : null}

      {screen === 'clients' ? (
        <main className="mx-auto max-w-5xl p-4" data-testid="clients-screen">
          <h1 className="text-3xl font-bold">Clientes</h1>
          <p className="mt-2 text-slate-600">Consulte a carteira e os contatos ativos.</p>
          <div className="mt-5 overflow-x-auto rounded-2xl bg-white p-4 shadow-sm">
            <table className="w-full min-w-[520px] text-left">
              <thead><tr><th className="p-2">Cliente</th><th className="p-2">E-mail</th><th className="p-2">Status</th></tr></thead>
              <tbody><tr><td className="p-2">Marina Costa</td><td className="p-2">marina@empresa.com</td><td className="p-2">Ativo</td></tr></tbody>
            </table>
          </div>
        </main>
      ) : null}
    </div>
  );
}
`;

export function RuntimeE2EHarness() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [audit, setAudit] = useState<RuntimeAuditReport | null>(null);

  return (
    <main className="h-screen min-h-[640px] bg-background">
      <div className="sr-only" aria-live="polite">
        {ready ? <span data-testid="runtime-ready">preview aprovado</span> : null}
        {error ? <span data-testid="runtime-error">{error}</span> : null}
        {audit ? <span data-testid="runtime-audit">{audit.issues.length} ocorrências</span> : null}
      </div>
      <AppRunner
        code={GENERATED_APP_FIXTURE}
        version="playwright-e2e"
        engineMode="real"
        onReady={() => setReady(true)}
        onError={setError}
        onAudit={setAudit}
      />
    </main>
  );
}
