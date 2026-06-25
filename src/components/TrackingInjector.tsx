// ============================================================================
// TrackingInjector — injeta snippets configurados no painel admin
// (Google Analytics, GTM, Meta Pixel etc.) em todas as páginas do app.
// Roda após hidratação para não bloquear o SSR. Re-executa scripts inline
// criando novos <script> nodes (innerHTML sozinho não executa script).
// ============================================================================
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

type Slot = "head" | "body_start" | "body_end";

function injectHTML(html: string, slot: Slot, marker: string) {
  if (!html.trim()) return;
  // Evita injeção duplicada em re-mounts (React StrictMode, navegação SPA).
  if (document.querySelector(`[data-tracking-slot="${marker}"]`)) return;

  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const frag = tpl.content;

  // Recria <script> para que o navegador execute-os (innerHTML não roda script).
  frag.querySelectorAll("script").forEach((old) => {
    const s = document.createElement("script");
    for (const attr of Array.from(old.attributes)) s.setAttribute(attr.name, attr.value);
    if (old.textContent) s.text = old.textContent;
    old.replaceWith(s);
  });

  // Wrapper invisível para marcação (e fácil remoção em hot-reload).
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
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", "tracking")
          .maybeSingle();
        if (cancelled || !data?.value) return;
        const v = data.value as { head?: string; body_start?: string; body_end?: string };
        injectHTML(v.head ?? "", "head", "head");
        injectHTML(v.body_start ?? "", "body_start", "body_start");
        injectHTML(v.body_end ?? "", "body_end", "body_end");
      } catch {
        /* silencioso: tracking nunca deve quebrar o app */
      }
    })();
    return () => { cancelled = true; };
  }, []);
  return null;
}
