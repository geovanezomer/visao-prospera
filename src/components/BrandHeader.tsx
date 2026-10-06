// ============================================================================
// BrandHeader — componente único de logo+nome do sistema com fallback
// consistente para todas as páginas públicas/auth (Landing, Login, Signup,
// Forgot/Reset password, Legal/Termos/Privacidade, Callback).
//
// Regras:
//  - Se admin configurou logoUrl, usa ela; senão, asset padrão.
//  - Aplica recolor SVG quando habilitado no admin (via BrandedLogo).
//  - Tamanhos pré-definidos (sm/md/lg) — mantém consistência visual.
//  - subtitle opcional (uppercase tracking) para o lado esquerdo do login.
// ============================================================================
import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import logoAsset from "@/assets/finnancepro-logo.png.asset.json";
import { useBranding } from "@/hooks/useBranding";
import { BrandedLogo } from "@/components/BrandedLogo";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg";

const SIZE_MAP: Record<Size, { box: string; svg: string; name: string }> = {
  sm: { box: "h-8 w-8", svg: "[&>svg]:h-8 [&>svg]:w-8", name: "text-sm" },
  md: { box: "h-9 w-9", svg: "[&>svg]:h-9 [&>svg]:w-9", name: "text-base" },
  lg: { box: "h-10 w-10", svg: "[&>svg]:h-10 [&>svg]:w-10", name: "text-lg" },
};

type Props = {
  size?: Size;
  /** Quando true, envolve em <Link to="/"> para voltar à home. */
  asLink?: boolean;
  /** Linha extra abaixo do nome (e.g. "Diagnóstico & Simulação"). */
  subtitle?: ReactNode;
  /** Oculta o texto do nome — útil quando o layout exibe nome separado. */
  hideName?: boolean;
  className?: string;
};

export function BrandHeader({
  size = "md",
  asLink = false,
  subtitle,
  hideName = false,
  className,
}: Props) {
  const { branding, isReady } = useBranding();
  const sz = SIZE_MAP[size];

  // Skeleton enquanto branding hidrata — evita flash de marca padrão
  // quando o admin definiu logo personalizada.
  if (!isReady) {
    return (
      <div className={cn("flex items-center gap-3", className)}>
        <div className={cn("animate-pulse rounded-md bg-muted", sz.box)} />
        {!hideName && <div className="h-4 w-28 animate-pulse rounded bg-muted" />}
      </div>
    );
  }

  const content = (
    <>
      <BrandedLogo
        src={branding.logoUrl ?? logoAsset.url}
        alt={branding.systemName}
        recolor={branding.recolorLogo}
        className={cn(sz.box, sz.svg)}
        imgProps={{ className: cn(sz.box, "rounded-md object-contain") }}
      />
      {!hideName && (
        <div>
          <p className={cn("font-semibold tracking-tight", sz.name)}>{branding.systemName}</p>
          {subtitle && (
            <p className="text-[11.5px] uppercase tracking-[0.2em] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
      )}
    </>
  );

  if (asLink) {
    return (
      <Link to="/" className={cn("flex items-center gap-3", className)}>
        {content}
      </Link>
    );
  }
  return <div className={cn("flex items-center gap-3", className)}>{content}</div>;
}
