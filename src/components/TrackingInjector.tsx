// ============================================================================
// TrackingInjector — injeta snippets configurados no admin (GA, GTM, Meta
// Pixel). Lê o cache compartilhado de app_settings (queryKey
// ["app_settings"]) para NÃO fazer fetch adicional ao DB — BrandingApplier
// já hidrata esse cache no SSR.
//
// Só injeta quando as duas condições valem:
//   1. Página de marketing (TRACKED_PATHS). Script de terceiro roda com o
//      mesmo acesso da página: no /app leria os dados financeiros e o token
//      de sessão; no /login, a senha.
//   2. Visitante aceitou cookies de análise (LGPD) — ver CookieConsent.
// ============================================================================
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { getAppSettings, type TrackingSetting } from "@/lib/admin/settings.functions";
import { CookieConsentBanner } from "@/components/CookieConsent";
import { isTrackedPath, useAnalyticsConsent } from "@/lib/analyticsConsent";

type Slot = "head" | "body_start" | "body_end";

function injectHTML(html: string, slot: Slot, marker: string) {
  if (!html.trim()) return;
  if (document.querySelector(`[data-tracking-slot="${marker}"]`)) return;

  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const frag = tpl.content;

  frag.querySelectorAll("script").forEach((old) => {
    const s = document.createElement("script");
    for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value);
    if (old.textContent) s.text = old.textContent;
    old.replaceWith(s);
  });

  const wrapper = document.createElement("div");
  wrapper.style.display = "contents";
  wrapper.setAttribute("data-tracking-slot", marker);
  wrapper.appendChild(frag);

  if (slot === "head") {
    document.head.appendChild(wrapper);
  } else if (slot === "body_start") {
    document.body.prepend(wrapper);
  } else {
    document.body.appendChild(wrapper);
  }
}

export function TrackingInjector() {
  // Reusa o cache de app_settings (hidratado pelo loader do __root) — zero
  // chamadas extras ao DB em produção, mesmo com milhares de pageviews.
  const { data } = useQuery({
    queryKey: ["app_settings"],
    queryFn: () => getAppSettings(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const consent = useAnalyticsConsent();
  const tracking = data?.tracking as TrackingSetting | undefined;
  const hasTracking = Boolean(
    tracking?.head?.trim() || tracking?.body_start?.trim() || tracking?.body_end?.trim(),
  );
  const onTrackedPage = isTrackedPath(pathname);
  const allowed = consent === "accepted" && onTrackedPage;

  useEffect(() => {
    if (!allowed || !tracking) return;
    injectHTML(tracking.head ?? "", "head", "head");
    injectHTML(tracking.body_start ?? "", "body_start", "body_start");
    injectHTML(tracking.body_end ?? "", "body_end", "body_end");
  }, [tracking, allowed]);

  // Sem scripts configurados não há cookie de terceiro a consentir.
  return <CookieConsentBanner visible={hasTracking && onTrackedPage} />;
}
