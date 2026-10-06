// Alterna entre o tema escuro (padrão) e o claro. A escolha fica no navegador;
// o script em __root aplica o tema antes da primeira pintura (sem piscar).
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { THEME_KEY, type Theme } from "@/lib/theme";

function current(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

export function ThemeToggle() {
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

  const label = theme === "light" ? "Usar tema escuro" : "Usar tema claro";
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 w-8 p-0"
      onClick={toggle}
      title={label}
      aria-label={label}
    >
      {theme === "light" ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
    </Button>
  );
}
