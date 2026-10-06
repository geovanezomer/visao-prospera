// ============================================================================
// BrandedLogo — renderiza a logo do sistema com opção de aplicar a cor
// primária do branding em logos SVG (inline). Para PNG/JPG/WebP renderiza
// um <img> normal. Quando o usuário ativa "Recolorir SVG" no admin e a
// logo é SVG (data URL ou .svg), o componente:
//   1) Usa a própria logo como CSS mask
//   2) Aplica a cor via backgroundColor: var(--primary)
//   3) Evita o flash "SVG branco primeiro → SVG colorido depois"
//
// Resultado: logo acompanha a identidade visual (`--primary`), trocando
// automaticamente quando o admin muda a cor — sem reprocessar o arquivo.
// ============================================================================
import type { CSSProperties } from "react";

type Props = {
  src: string;
  alt: string;
  className?: string;
  /** Quando true e a logo for SVG, aplica `currentColor` nas formas. */
  recolor?: boolean;
  /** Cor CSS aplicada quando recolor=true. Padrão: `var(--primary)`. */
  color?: string;
  /** Renderização não-SVG (fallback). */
  imgProps?: React.ImgHTMLAttributes<HTMLImageElement>;
};

function looksLikeSvg(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/svg+xml")) return true;
  // URL terminando em .svg (ignorando querystring).
  return /\.svg($|\?)/i.test(src);
}

export function BrandedLogo({
  src,
  alt,
  className,
  recolor = false,
  color = "var(--primary)",
  imgProps,
}: Props) {
  const isSvg = looksLikeSvg(src);
  const shouldInline = recolor && isSvg;

  if (shouldInline) {
    const maskStyle: CSSProperties = {
      backgroundColor: color,
      color,
      display: "inline-block",
      lineHeight: 0,
      WebkitMaskImage: `url("${src}")`,
      maskImage: `url("${src}")`,
      WebkitMaskRepeat: "no-repeat",
      maskRepeat: "no-repeat",
      WebkitMaskPosition: "center",
      maskPosition: "center",
      WebkitMaskSize: "contain",
      maskSize: "contain",
    };
    return <span role="img" aria-label={alt} className={className} style={maskStyle} />;
  }

  // Fallback: <img> tradicional (PNG/JPG/WebP, ou recolor desligado, ou erro).
  return <img src={src} alt={alt} className={className} {...imgProps} />;
}
