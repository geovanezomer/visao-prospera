import { fmtBRL } from "@/engines/finance/format";
import { SectionTitle } from "@/components/sim/shared/primitives";

// Quadro explicativo do Capital de Giro / NCG — só leitura.
export function NCGExplanationCard({
  ncg,
  pmr,
  pmp,
  receitaDia,
  cpvDia,
}: {
  ncg: number;
  pmr: number;
  pmp: number;
  receitaDia: number;
  cpvDia: number;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/60 p-5">
      <SectionTitle hint="Explicação CFO sobre a composição do Capital de Giro.">
        Por dentro do seu Capital de Giro
      </SectionTitle>
      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sua operação mantém hoje <strong className="text-foreground">{fmtBRL(ncg)}</strong>{" "}
            imobilizados. Isso significa que, antes de ver a cor do lucro, você precisa "adiantar"
            esse valor para o negócio não parar.
          </p>
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between rounded bg-muted/20 p-2 text-xs">
              <span className="text-muted-foreground">Ciclo de Recebimento</span>
              <span className="font-semibold">{pmr} dias</span>
            </div>
            <div className="flex items-center justify-between rounded bg-muted/20 p-2 text-xs">
              <span className="text-muted-foreground">Ciclo de Pagamento</span>
              <span className="font-semibold">{pmp} dias</span>
            </div>
          </div>
        </div>
        <div className="rounded-md border border-primary/20 bg-primary/5 p-4 flex flex-col justify-center">
          <div className="text-[10px] uppercase tracking-wider text-primary font-bold mb-1">
            Impacto CFO
          </div>
          <div className="text-lg font-bold leading-tight">
            {pmr >= pmp
              ? `Seu desencaixe operacional é de ${pmr - pmp} dias.`
              : `Você tem um encaixe operacional de ${pmp - pmr} dias (paga fornecedores depois de receber).`}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
            Cada dia a mais que o cliente demora a pagar (PMR) te custa{" "}
            <strong className="text-foreground">{fmtBRL(receitaDia)}</strong>. Cada dia que você
            consegue a mais com fornecedores (PMP) te economiza{" "}
            <strong className="text-foreground">{fmtBRL(cpvDia)}</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
