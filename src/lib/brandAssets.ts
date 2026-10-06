// Identidade visual padrão — arquivos locais em public/brand/ (gerados a
// partir de public/brand/logo.svg). O admin pode trocar logo, favicon e cores
// em Administração → Sistema → Branding.
//
// Antes estes arquivos ficavam no CDN da Lovable (/__l5e/...) e quebravam
// fora da plataforma deles.

// SVG (0,7 KB) no lugar do PNG de 512 px (111 KB) que o menu baixava em toda abertura.
export const logoAsset = { url: "/brand/logo.svg" } as const;
export const logoSvgUrl = "/brand/logo.svg";
