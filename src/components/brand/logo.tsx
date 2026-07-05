import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * Marca "Nexaform" — monograma geométrico em N contido num frame de app
 * cuja cauda o transforma, sutilmente, num balão de conversa: software
 * que nasce de um diálogo. Vetorial, flat, sem clichês de IA.
 *
 * Assets estáticos: /public/brand/{logo,logo-mark,favicon,app-icon}.svg
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={cn("h-6 w-6", className)} aria-hidden>
      <path
        d="M10 4H22C25.3137 4 28 6.68629 28 10V18C28 21.3137 25.3137 24 22 24H15L10 28.5V24C6.68629 24 4 21.3137 4 18V10C4 6.68629 6.68629 4 10 4Z"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
      <path
        d="M12 19V9.5L20 19V9.5"
        stroke="#635BFF"
        strokeWidth="2.6"
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
      <span className="text-[17px] leading-none">Nexaform</span>
    </Link>
  );
}
