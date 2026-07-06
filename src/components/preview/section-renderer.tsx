"use client";

/**
 * Renderiza uma Section do component tree.
 * Todo o estilo respeita o ThemeConfig do schema (não o tema do AD Studio),
 * para que o preview seja fiel ao produto sendo criado.
 */
import { Zap, Shield, Sparkles, Layers, Clock, Heart, Check, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Section, ThemeConfig } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  zap: Zap,
  shield: Shield,
  sparkles: Sparkles,
  layers: Layers,
  clock: Clock,
  heart: Heart,
};

interface Ctx {
  theme: ThemeConfig;
  compact?: boolean; // modo mobile
  onNavigate?: (path: string) => void;
  selected?: boolean;
  onSelect?: () => void;
}

export function SectionRenderer({ section, ctx }: { section: Section; ctx: Ctx }) {
  const { theme } = ctx;
  const dark = theme.mode === "dark";
  const p = section.props;
  const primary = theme.primary;
  const radius = `${theme.radius}px`;

  const muted = dark ? "rgba(255,255,255,0.6)" : "rgba(0,0,0,0.55)";
  const border = dark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.09)";
  const cardBg = dark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.02)";

  const wrap = (children: React.ReactNode, className = "") => (
    <section
      onClick={(e) => {
        e.stopPropagation();
        ctx.onSelect?.();
      }}
      className={cn(
        "relative px-6 py-12 transition-shadow md:px-10",
        ctx.compact && "px-4 py-8",
        ctx.onSelect && "cursor-pointer",
        ctx.selected && "ring-2 ring-inset",
        className
      )}
      style={ctx.selected ? ({ ["--tw-ring-color" as any]: primary } as React.CSSProperties) : undefined}
    >
      {children}
    </section>
  );

  const btn = (label: string, filled = true) => (
    <span
      className="inline-flex items-center px-5 py-2.5 text-sm font-medium"
      style={{
        borderRadius: radius,
        background: filled ? primary : "transparent",
        color: filled ? "#fff" : undefined,
        border: filled ? "none" : `1px solid ${border}`,
      }}
    >
      {label}
    </span>
  );

  switch (section.type) {
    case "navbar":
      return (
        <div
          onClick={(e) => {
            e.stopPropagation();
            ctx.onSelect?.();
          }}
          className={cn("flex items-center justify-between border-b px-6 py-4 md:px-10", ctx.selected && "ring-2 ring-inset")}
          style={{ borderColor: border, ...(ctx.selected ? { ["--tw-ring-color" as any]: primary } : {}) }}
        >
          <span className="font-semibold" style={{ color: primary }}>
            {p.brand}
          </span>
          {!ctx.compact && (
            <nav className="flex items-center gap-5 text-sm" style={{ color: muted }}>
              {(p.links ?? []).map((l: any) => (
                <button
                  key={l.path}
                  className="hover:opacity-70"
                  onClick={(e) => {
                    e.stopPropagation();
                    ctx.onNavigate?.(l.path);
                  }}
                >
                  {l.name}
                </button>
              ))}
            </nav>
          )}
          {btn(p.cta ?? "Começar")}
        </div>
      );

    case "hero":
      return wrap(
        <div className="mx-auto max-w-3xl text-center">
          {p.badge && (
            <span
              className="mb-4 inline-block px-3 py-1 text-xs font-medium"
              style={{ borderRadius: 999, background: `${primary}22`, color: primary }}
            >
              {p.badge}
            </span>
          )}
          <h1 className={cn("font-bold tracking-tight", ctx.compact ? "text-3xl" : "text-5xl")}>{p.title}</h1>
          <p className="mx-auto mt-4 max-w-xl text-base" style={{ color: muted }}>
            {p.subtitle}
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {p.cta && btn(p.cta)}
            {p.secondaryCta && btn(p.secondaryCta, false)}
          </div>
        </div>,
        "text-center"
      );

    case "features":
      return wrap(
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">{p.title}</h2>
          <div className={cn("grid gap-4", ctx.compact ? "grid-cols-1" : "grid-cols-3")}>
            {(p.items ?? []).map((item: any, i: number) => {
              const Icon = ICONS[item.icon] ?? Sparkles;
              return (
                <div key={i} className="border p-5" style={{ borderRadius: radius, borderColor: border, background: cardBg }}>
                  <Icon className="mb-3 h-5 w-5" style={{ color: primary } as any} />
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-1 text-sm" style={{ color: muted }}>
                    {item.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      );

    case "stats":
      return wrap(
        <div className={cn("mx-auto grid max-w-4xl gap-6 text-center", ctx.compact ? "grid-cols-2" : "grid-cols-4")}>
          {(p.items ?? []).map((s: any, i: number) => (
            <div key={i}>
              <p className="text-3xl font-bold" style={{ color: primary }}>
                {s.value}
              </p>
              <p className="mt-1 text-sm" style={{ color: muted }}>
                {s.label}
              </p>
            </div>
          ))}
        </div>
      );

    case "testimonials":
      return wrap(
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">{p.title}</h2>
          <div className={cn("grid gap-4", ctx.compact ? "grid-cols-1" : "grid-cols-3")}>
            {(p.items ?? []).map((t: any, i: number) => (
              <figure key={i} className="border p-5" style={{ borderRadius: radius, borderColor: border, background: cardBg }}>
                <blockquote className="text-sm">“{t.quote}”</blockquote>
                <figcaption className="mt-4 text-sm">
                  <span className="font-medium">{t.name}</span>
                  <span style={{ color: muted }}> · {t.role}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      );

    case "pricing":
      return wrap(
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center text-3xl font-bold tracking-tight">{p.title}</h2>
          {p.subtitle && (
            <p className="mt-2 text-center text-sm" style={{ color: muted }}>
              {p.subtitle}
            </p>
          )}
          <div className={cn("mt-8 grid gap-4", ctx.compact ? "grid-cols-1" : "grid-cols-3")}>
            {(p.plans ?? []).map((plan: any, i: number) => (
              <div
                key={i}
                className="border p-6"
                style={{
                  borderRadius: radius,
                  borderColor: plan.highlighted ? primary : border,
                  background: cardBg,
                  boxShadow: plan.highlighted ? `0 8px 40px -12px ${primary}66` : undefined,
                }}
              >
                <p className="font-medium">{plan.name}</p>
                <p className="mt-2">
                  <span className="text-3xl font-bold">{plan.price}</span>{" "}
                  <span className="text-sm" style={{ color: muted }}>
                    {plan.note}
                  </span>
                </p>
                <ul className="mt-4 space-y-2 text-sm">
                  {(plan.features ?? []).map((f: string) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: primary } as any} />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-5">{btn("Escolher", plan.highlighted)}</div>
              </div>
            ))}
          </div>
        </div>
      );

    case "faq":
      return wrap(
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-6 text-center text-3xl font-bold tracking-tight">{p.title}</h2>
          <div className="space-y-3">
            {(p.items ?? []).map((f: any, i: number) => (
              <details key={i} className="border p-4" style={{ borderRadius: radius, borderColor: border, background: cardBg }}>
                <summary className="cursor-pointer text-sm font-medium">{f.q}</summary>
                <p className="mt-2 text-sm" style={{ color: muted }}>
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      );

    case "cta":
      return wrap(
        <div
          className="mx-auto max-w-3xl px-8 py-12 text-center"
          style={{ borderRadius: radius, background: `${primary}18`, border: `1px solid ${primary}44` }}
        >
          <h2 className="text-2xl font-bold tracking-tight">{p.title}</h2>
          <p className="mt-2 text-sm" style={{ color: muted }}>
            {p.subtitle}
          </p>
          <div className="mt-5">{btn(p.cta ?? "Começar")}</div>
        </div>
      );

    case "footer":
      return wrap(
        <div className="mx-auto max-w-5xl border-t pt-8" style={{ borderColor: border }}>
          <div className={cn("grid gap-8", ctx.compact ? "grid-cols-2" : "grid-cols-4")}>
            <div>
              <p className="font-semibold" style={{ color: primary }}>
                {p.brand}
              </p>
              <p className="mt-2 text-xs" style={{ color: muted }}>
                {p.tagline}
              </p>
            </div>
            {(p.columns ?? []).map((c: any, i: number) => (
              <div key={i}>
                <p className="text-sm font-medium">{c.title}</p>
                <ul className="mt-2 space-y-1.5 text-xs" style={{ color: muted }}>
                  {(c.links ?? []).map((l: string) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );

    case "gallery":
      return wrap(
        <div className="mx-auto max-w-5xl">
          <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">{p.title}</h2>
          <div className={cn("grid gap-4", ctx.compact ? "grid-cols-2" : "grid-cols-3")}>
            {(p.items ?? []).map((g: any, i: number) => (
              <div key={i} className="overflow-hidden border" style={{ borderRadius: radius, borderColor: border }}>
                <div
                  className="aspect-[4/3]"
                  style={{
                    background: `linear-gradient(135deg, ${primary}${(30 + i * 8).toString(16).padStart(2, "0")}, ${primary}11)`,
                  }}
                />
                <div className="p-3">
                  <p className="text-sm font-medium">{g.title}</p>
                  <p className="text-xs" style={{ color: muted }}>
                    {g.tag}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "form":
      return wrap(
        <div className="mx-auto max-w-md">
          <h2 className="text-center text-2xl font-bold tracking-tight">{p.title}</h2>
          {p.subtitle && (
            <p className="mt-1 text-center text-sm" style={{ color: muted }}>
              {p.subtitle}
            </p>
          )}
          <div className="mt-6 space-y-3">
            {(p.fields ?? []).map((f: any, i: number) =>
              f.type === "textarea" ? (
                <div key={i}>
                  <label className="mb-1 block text-xs font-medium">{f.label}</label>
                  <div className="h-20 border px-3 py-2 text-sm" style={{ borderRadius: radius, borderColor: border, color: muted }}>
                    {f.placeholder}
                  </div>
                </div>
              ) : (
                <div key={i}>
                  <label className="mb-1 block text-xs font-medium">{f.label}</label>
                  <div className="border px-3 py-2 text-sm" style={{ borderRadius: radius, borderColor: border, color: muted }}>
                    {f.placeholder}
                  </div>
                </div>
              )
            )}
            <div className="pt-1">{btn(p.submit ?? "Enviar")}</div>
          </div>
        </div>
      );

    case "kpis":
      return wrap(
        <div className={cn("mx-auto grid max-w-5xl gap-4", ctx.compact ? "grid-cols-2" : "grid-cols-4")}>
          {(p.items ?? []).map((k: any, i: number) => (
            <div key={i} className="border p-4" style={{ borderRadius: radius, borderColor: border, background: cardBg }}>
              <p className="text-xs" style={{ color: muted }}>
                {k.label}
              </p>
              <p className="mt-1 text-2xl font-bold">{k.value}</p>
              <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: k.up ? "#10b981" : "#ef4444" }}>
                {k.up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {k.delta}
              </p>
            </div>
          ))}
        </div>
      );

    case "chart": {
      const points: number[] = p.points ?? [];
      const max = Math.max(...points, 1);
      return wrap(
        <div className="mx-auto max-w-5xl border p-5" style={{ borderRadius: radius, borderColor: border, background: cardBg }}>
          <p className="mb-4 font-medium">{p.title}</p>
          <div className="flex h-40 items-end gap-2">
            {points.map((v, i) => (
              <div key={i} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full transition-all"
                  style={{
                    height: `${(v / max) * 100}%`,
                    background: `linear-gradient(180deg, ${primary}, ${primary}88)`,
                    borderRadius: `${Math.min(theme.radius, 6)}px ${Math.min(theme.radius, 6)}px 0 0`,
                  }}
                />
                <span className="text-[10px]" style={{ color: muted }}>
                  {p.labels?.[i] ?? ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case "table":
      return wrap(
        <div className="mx-auto max-w-5xl overflow-hidden border" style={{ borderRadius: radius, borderColor: border }}>
          <p className="border-b px-5 py-3 font-medium" style={{ borderColor: border }}>
            {p.title}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ background: cardBg }}>
                {(p.columns ?? []).map((c: string) => (
                  <th key={c} className="px-5 py-2.5 text-xs font-medium" style={{ color: muted }}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(p.rows ?? []).map((row: string[], i: number) => (
                <tr key={i} className="border-t" style={{ borderColor: border }}>
                  {row.map((cell, j) => (
                    <td key={j} className="px-5 py-2.5">
                      {j === row.length - 1 ? (
                        <span
                          className="px-2 py-0.5 text-xs"
                          style={{
                            borderRadius: 999,
                            background:
                              cell === "Pago" ? "#10b98122" : cell === "Falhou" ? "#ef444422" : `${primary}22`,
                            color: cell === "Pago" ? "#10b981" : cell === "Falhou" ? "#ef4444" : primary,
                          }}
                        >
                          {cell}
                        </span>
                      ) : (
                        cell
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "content":
      return wrap(
        <div className="mx-auto max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight">{p.title}</h2>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: muted }}>
            {p.body}
          </p>
        </div>
      );

    default:
      return wrap(
        <p className="text-center text-sm" style={{ color: muted }}>
          Seção desconhecida: {String(section.type)}
        </p>
      );
  }
}
