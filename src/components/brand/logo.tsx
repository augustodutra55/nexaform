import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Marca "AD Studio" — monograma AD em tile premium com gradiente indigo→violeta.
 * Um selo sólido e sofisticado, igual em qualquer fundo: cara de estúdio digital
 * de criação, não de plataforma genérica. Vetorial, flat, memorável.
 *
 * Assets estáticos: /public/brand/{logo,logo-mark,favicon,app-icon}.svg
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("h-7 w-7", className)} aria-hidden>
      <defs>
        <linearGradient id="adMarkGrad" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6D5DF6" />
          <stop offset="1" stopColor="#A855F7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#adMarkGrad)" />
      {/* Monograma AD: "A" em chevron com travessão + "D" com haste e bojo */}
      <path
        d="M9.4 22.5L12.9 9.8H15.1L18.6 22.5"
        stroke="#fff"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11 18.2H17" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
      <path
        d="M21.3 9.8V22.5M21.3 9.8C24.9 9.8 26.6 12.4 26.6 16.15C26.6 19.9 24.9 22.5 21.3 22.5"
        stroke="#fff"
        strokeOpacity="0.92"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-[17px] leading-none">
        AD <span className="font-medium text-muted-foreground">Studio</span>
      </span>
    </Link>
  );
}
