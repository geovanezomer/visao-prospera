import { useEffect, useState } from "react";
// Tema da interface: escuro (padrão) ou claro, escolhido por navegador.
export type Theme = "dark" | "light";
export const THEME_KEY = "finnance:theme";

/** Script inline do <head>: aplica o tema salvo antes da primeira pintura. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Tema atual e a troca claro/escuro (usado no botão e no menu "Mais"). */
export function useTema() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(current()), []);

  const toggle = () => {
    const next: Theme = theme === "light" ? "dark" : "light";
    if (next === "light") document.documentElement.dataset.theme = "light";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* modo privado: vale só nesta aba */
    }
    setTheme(next);
  };
  return { theme, toggle };
}
