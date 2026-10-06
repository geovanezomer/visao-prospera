// Aceite obrigatório dos Termos de Uso e da Política de Privacidade (versão
// vigente) antes de usar o app. O registro (data, IP, navegador) fica no banco.
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileCheck2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { acceptLegal, getLegalStatus } from "@/lib/legal.functions";

export function LegalAcceptGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [marcado, setMarcado] = useState(false);
  const status = useQuery({
    queryKey: ["legal-status"],
    queryFn: () => getLegalStatus(),
    staleTime: 10 * 60_000,
  });
  const aceitar = useMutation({
    mutationFn: (version: string) => acceptLegal({ data: { version } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["legal-status"] }),
  });

  // Falha ao consultar não bloqueia o app (o aceite é pedido na próxima vez).
  if (status.isLoading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  if (!status.data || status.data.accepted) return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-sm"
        aria-labelledby="legal-titulo"
      >
        <h1 id="legal-titulo" className="flex items-center gap-2 text-lg font-semibold">
          <FileCheck2 className="h-5 w-5 text-primary" /> Termos de uso e privacidade
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Para continuar, leia e aceite os documentos abaixo. Eles explicam como o FinnancePRO trata
          os dados da sua empresa e do ERP conectado (LGPD).
        </p>
        <ul className="mt-4 space-y-1 text-sm">
          <li>
            <a className="text-primary underline" href="/termos" target="_blank" rel="noreferrer">
              Termos de Uso
            </a>
          </li>
          <li>
            <a
              className="text-primary underline"
              href="/privacidade"
              target="_blank"
              rel="noreferrer"
            >
              Política de Privacidade
            </a>
          </li>
        </ul>
        <p className="mt-4 rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
          Ferramenta de apoio à análise: diagnósticos, projeções, simulações e indicadores têm
          caráter informativo e não substituem o parecer de contador, advogado ou consultor
          responsável, nem constituem recomendação de investimento.
        </p>
        <label className="mt-4 flex items-start gap-2 text-sm">
          <Checkbox
            checked={marcado}
            onCheckedChange={(v) => setMarcado(v === true)}
            aria-label="Li e aceito os Termos de Uso e a Política de Privacidade"
          />
          <span>Li e aceito os Termos de Uso e a Política de Privacidade.</span>
        </label>
        {aceitar.error && (
          <p className="mt-2 text-xs text-destructive">
            {aceitar.error instanceof Error ? aceitar.error.message : "Não foi possível registrar."}
          </p>
        )}
        <Button
          className="mt-4 w-full"
          disabled={!marcado || aceitar.isPending}
          onClick={() => aceitar.mutate(status.data!.version)}
        >
          {aceitar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Aceitar e continuar
        </Button>
      </section>
    </main>
  );
}
