import { useEffect } from "react";

/**
 * Hook: registra o atalho ⌘K / Ctrl+K enquanto o componente estiver montado.
 * Use no admin.tsx para deixar o listener ativo apenas na rota /admin.
 */
export function useAdminCommandShortcut(onToggle: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onToggle]);
}
