// Tema da interface: escuro (padrão) ou claro, escolhido por navegador.
export type Theme = "dark" | "light";
export const THEME_KEY = "finnance:theme";

/** Script inline do <head>: aplica o tema salvo antes da primeira pintura. */
export const THEME_BOOT_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;
