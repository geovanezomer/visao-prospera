// Trava de edição do realizado no modo Odoo: as abas de receitas, despesas e
// capital continuam visíveis, mas todo campo e botão fica desabilitado
// (<fieldset disabled>). Premissas seguem editáveis nas demais abas.
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useOdooCockpitContext } from "./cockpit";

export function ActualsLock({ what, children }: { what: string; children: ReactNode }) {
  const cockpit = useOdooCockpitContext();
  if (!cockpit?.active) return <>{children}</>;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <p>
          <strong>{what} vêm do Odoo</strong> ({cockpit.entity?.label}) e não podem ser editados
          aqui — lance ou corrija no ERP e sincronize. Para testar hipóteses, use o{" "}
          <strong>Simulador</strong> ou a visão <strong>Simulação livre</strong>.
        </p>
      </div>
      <fieldset
        disabled
        className="min-w-0 [&_input]:cursor-default [&_button:disabled]:opacity-60"
        aria-readonly="true"
      >
        {children}
      </fieldset>
    </div>
  );
}
