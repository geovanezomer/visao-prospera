// ============================================================================
// BrandedLogo — renderiza a logo do sistema com opção de aplicar a cor
// primária do branding em logos SVG (inline). Para PNG/JPG/WebP renderiza
// um <img> normal. Quando o usuário ativa "Recolorir SVG" no admin e a
// logo é SVG (data URL ou .svg), o componente:
//   1) Lê o conteúdo do SVG
//   2) Sanitiza (remove <script>, on*=..., href="javascript:")
//   3) Substitui fill/stroke explícitos (≠ "none") por "currentColor"
//   4) Renderiza inline; um wrapper aplica color: var(--primary) (ou prop)
//
// Resultado: logo acompanha a identidade visual (`--primary`), trocando
// automaticamente quando o admin muda a cor — sem reprocessar o arquivo.
// ============================================================================
import { useEffect, useState } from "react";

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

// Cache simples para evitar refetch do mesmo SVG.
const svgCache = new Map<string, string>();

function looksLikeSvg(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("data:image/svg+xml")) return true;
  // URL terminando em .svg (ignorando querystring).
  return /\.svg($|\?)/i.test(src);
}

async function loadSvgText(src: string): Promise<string> {
  if (svgCache.has(src)) return svgCache.get(src)!;
  let text: string;
  if (src.startsWith("data:image/svg+xml")) {
    const comma = src.indexOf(",");
    const meta = src.slice(0, comma);
    const payload = src.slice(comma + 1);
    text = meta.includes(";base64")
      ? decodeURIComponent(escape(atob(payload)))
      : decodeURIComponent(payload);
  } else {
    const res = await fetch(src, { credentials: "omit" });
    if (!res.ok) throw new Error(`fetch svg ${res.status}`);
    text = await res.text();
  }
  svgCache.set(src, text);
  return text;
}

// Sanitiza + força currentColor em fill/stroke.
function sanitizeAndRecolor(svgText: string): string {
  if (typeof window === "undefined") return svgText;
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return "";

  // Remove tags perigosas.
  doc.querySelectorAll("script, foreignObject").forEach((n) => n.remove());

  // Reescreve fill/stroke dentro de <style> embutidos (CorelDRAW/Illustrator
  // costumam exportar cores como classes CSS — ex.: .fil0 { fill:#FEFEFE }).
  doc.querySelectorAll("style").forEach((styleEl) => {
    const css = styleEl.textContent ?? "";
    if (!css) return;
    const rewritten = css.replace(
      /(fill|stroke)\s*:\s*([^;}]+)/gi,
      (_m, prop: string, val: string) => {
        const v = val.trim().toLowerCase();
        if (v === "none" || v.startsWith("url(") || v === "currentcolor") {
          return `${prop}:${val.trim()}`;
        }
        return `${prop}:currentColor`;
      },
    );
    styleEl.textContent = rewritten;
  });



  const walker = doc.createTreeWalker(svg, NodeFilter.SHOW_ELEMENT);
  const nodes: Element[] = [svg];
  let cur = walker.nextNode();
  while (cur) {
    nodes.push(cur as Element);
    cur = walker.nextNode();
  }

  for (const el of nodes) {
    // Remove event handlers e href javascript:
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
      if (
        (attr.name === "href" || attr.name === "xlink:href") &&
        /^\s*javascript:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }

    // fill / stroke como atributo
    for (const a of ["fill", "stroke"] as const) {
      const v = el.getAttribute(a);
      if (v && v.toLowerCase() !== "none" && !v.startsWith("url(")) {
        el.setAttribute(a, "currentColor");
      }
    }

    // fill / stroke dentro de style="..."
    const style = el.getAttribute("style");
    if (style) {
      const next = style.replace(
        /(fill|stroke)\s*:\s*([^;]+)/gi,
        (_, prop: string, val: string) => {
          const v = val.trim().toLowerCase();
          if (v === "none" || v.startsWith("url(")) return `${prop}:${val}`;
          return `${prop}:currentColor`;
        },
      );
      el.setAttribute("style", next);
    }
  }

  // Garante width/height responsivos via CSS do wrapper.
  if (!svg.getAttribute("preserveAspectRatio")) {
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  }

  return new XMLSerializer().serializeToString(svg);
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
  const [inlineSvg, setInlineSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!shouldInline) {
      setInlineSvg(null);
      setFailed(false);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const text = await loadSvgText(src);
        const out = sanitizeAndRecolor(text);
        if (alive) setInlineSvg(out || null);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [src, shouldInline]);

  if (shouldInline && inlineSvg && !failed) {
    return (
      <span
        role="img"
        aria-label={alt}
        className={className}
        style={{ color, display: "inline-flex", lineHeight: 0 }}
        // SVG já sanitizado em sanitizeAndRecolor.
        dangerouslySetInnerHTML={{ __html: inlineSvg }}
      />
    );
  }

  // Fallback: <img> tradicional (PNG/JPG/WebP, ou recolor desligado, ou erro).
  return <img src={src} alt={alt} className={className} {...imgProps} />;
}
