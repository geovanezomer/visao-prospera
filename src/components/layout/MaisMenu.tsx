// Menu "Mais" do cabeçalho: o que é usado de vez em quando (modo reunião,
// tema, restaurar dados) sai da fileira de ícones e fica longe do botão de PDF.
import { Moon, MoreHorizontal, Presentation, RotateCcw, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTema } from "@/lib/theme";

export function MaisMenu({
  onModoReuniao,
  onRestaurar,
  restaurarLabel,
}: {
  onModoReuniao: () => void;
  onRestaurar: () => void;
  restaurarLabel: string;
}) {
  const { theme, toggle } = useTema();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Mais opções">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={onModoReuniao}>
          <Presentation className="mr-2 h-4 w-4" aria-hidden="true" />
          Modo reunião (tela limpa para apresentar)
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={toggle}>
          {theme === "light" ? (
            <Moon className="mr-2 h-4 w-4" aria-hidden="true" />
          ) : (
            <Sun className="mr-2 h-4 w-4" aria-hidden="true" />
          )}
          {theme === "light" ? "Usar tema escuro" : "Usar tema claro"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onRestaurar}
          className="text-destructive focus:text-destructive"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          {restaurarLabel}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
