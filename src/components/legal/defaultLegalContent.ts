// ============================================================================
// Templates LGPD MINUTA — usados quando o admin ainda não publicou textos
// próprios em /termos e /privacidade. Placeholders {{...}} são substituídos
// em runtime por dados da organização (env/branding). Se o placeholder não
// tiver valor configurado, permanece visível para deixar claro que o texto
// precisa ser preenchido antes da revisão jurídica.
// ============================================================================

export const MINUTA_BANNER = `
<div style="border:1px solid #f59e0b;background:#fef3c7;color:#78350f;padding:12px 16px;border-radius:8px;margin-bottom:24px;font-size:14px;">
  <strong>MINUTA</strong> — submeter à revisão jurídica antes da publicação.
</div>
`;

export const DEFAULT_PRIVACY_TEMPLATE = `
${MINUTA_BANNER}
<h1>Política de Privacidade</h1>
<p><em>Base legal: Lei nº 13.709/2018 (LGPD).</em></p>

<h2>1. Controlador dos dados</h2>
<p>{{RAZAO_SOCIAL}}, inscrita no CNPJ {{CNPJ}}, é a controladora dos dados pessoais tratados nesta plataforma (art. 5º, VI, LGPD).</p>

<h2>2. Encarregado (DPO) — art. 41</h2>
<p>Contato do Encarregado pelo Tratamento de Dados Pessoais: <a href="mailto:{{EMAIL_ENCARREGADO}}">{{EMAIL_ENCARREGADO}}</a>.</p>

<h2>3. Dados coletados</h2>
<ul>
  <li><strong>Cadastro:</strong> nome, e-mail, senha (armazenada em hash) e dados de contato.</li>
  <li><strong>Dados financeiros inseridos pelo usuário:</strong> demonstrativos, lançamentos e informações operacionais fornecidas para simulação — de titularidade do próprio cliente.</li>
  <li><strong>Logs técnicos:</strong> endereço IP, user-agent, timestamps de acesso e eventos de auditoria.</li>
</ul>

<h2>4. Bases legais (art. 7º)</h2>
<ul>
  <li>Execução de contrato (art. 7º, V) — prestação do serviço contratado.</li>
  <li>Legítimo interesse (art. 7º, IX) — segurança, prevenção a fraudes e melhoria do produto.</li>
  <li>Consentimento (art. 7º, I) — comunicações de marketing e cookies não essenciais.</li>
  <li>Cumprimento de obrigação legal/regulatória (art. 7º, II) — fiscal, contábil e tributária.</li>
</ul>

<h2>5. Finalidades</h2>
<p>Autenticação, execução das simulações e relatórios contratados, faturamento, suporte, segurança da informação, cumprimento de obrigações legais e evolução do produto.</p>

<h2>6. Operadores e suborganizações</h2>
<ul>
  <li><strong>Servidor próprio</strong> — banco de dados e autenticação hospedados na infraestrutura contratada pelo controlador, sem repasse a terceiros.</li>
  <li><strong>Stripe / Asaas</strong> — processamento de pagamentos.</li>
  <li><strong>Resend</strong> — envio de e-mail transacional.</li>
</ul>

<h2>7. Transferência internacional (art. 33)</h2>
<p>Parte dos operadores acima processa dados fora do Brasil. A transferência observa as hipóteses do art. 33 da LGPD, com cláusulas contratuais e garantias adequadas de proteção.</p>

<h2>8. Retenção e descarte</h2>
<p>Dados de conta são mantidos enquanto durar a relação contratual e pelos prazos legais aplicáveis (fiscal/contábil). Após esse período, são anonimizados ou eliminados.</p>

<h2>9. Direitos do titular (art. 18)</h2>
<p>Você pode solicitar confirmação, acesso, correção, anonimização, portabilidade, eliminação, informação sobre compartilhamento e revogação de consentimento pelo canal <a href="mailto:{{EMAIL_CONTATO}}">{{EMAIL_CONTATO}}</a>.</p>

<h2>10. Cookies</h2>
<p>Utilizamos cookies estritamente necessários para autenticação e preferências. Cookies analíticos/marketing, quando aplicáveis, exigem consentimento prévio.</p>

<h2>11. Segurança (art. 46)</h2>
<p>Adotamos medidas técnicas e administrativas para proteger os dados contra acessos não autorizados, incluindo criptografia em trânsito, controle de acesso baseado em papéis (RBAC/RLS), registro de auditoria e backups.</p>

<h2>12. Contato</h2>
<p>Dúvidas ou solicitações: <a href="mailto:{{EMAIL_CONTATO}}">{{EMAIL_CONTATO}}</a>.</p>
`;

export const DEFAULT_TERMS_TEMPLATE = `
${MINUTA_BANNER}
<h1>Termos de Uso</h1>

<h2>1. Objeto</h2>
<p>Estes Termos regulam o uso da plataforma de análise e simulação financeira operada por {{RAZAO_SOCIAL}} (CNPJ {{CNPJ}}), destinada a apoiar gestores de PMEs em decisões financeiras e tributárias.</p>

<h2>2. Elegibilidade</h2>
<p>O serviço é destinado a pessoas jurídicas e a pessoas físicas maiores de 18 anos, com capacidade civil plena para contratar.</p>

<h2>3. Planos, cobrança, cancelamento e reembolso</h2>
<p>Os planos vigentes, valores e periodicidades são exibidos na página de contratação. Assinaturas recorrentes renovam-se automaticamente até cancelamento pelo usuário no painel. O reembolso observa as regras do Código de Defesa do Consumidor (art. 49) para arrependimento em compras à distância.</p>

<h2>4. Propriedade dos dados</h2>
<p>Os dados financeiros inseridos pelo cliente permanecem de sua titularidade. A plataforma atua como operadora nos termos da LGPD para tais dados, tratando-os exclusivamente para as finalidades contratadas.</p>

<h2>5. Limitação de responsabilidade</h2>
<p>A plataforma é <strong>ferramenta de apoio à decisão</strong>. Simulações, indicadores e projeções <strong>não substituem</strong> a orientação de contador, advogado ou consultor de investimentos habilitado. O cliente é o único responsável pelas decisões tomadas com base nos resultados.</p>

<h2>6. Disponibilidade / SLA</h2>
<p>Envidamos esforços razoáveis (best-effort) para manter o serviço disponível 24/7, ressalvadas janelas de manutenção e eventos de força maior. Não há garantia contratual de tempo de resposta ou uptime, salvo previsão específica em plano contratado.</p>

<h2>7. Suspensão e encerramento</h2>
<p>Reservamo-nos o direito de suspender contas em caso de violação destes Termos, inadimplência ou uso abusivo, com notificação prévia sempre que possível.</p>

<h2>8. Foro</h2>
<p>Fica eleito o foro da comarca da sede da {{RAZAO_SOCIAL}} para dirimir controvérsias oriundas destes Termos, com renúncia a qualquer outro, por mais privilegiado que seja.</p>

<h2>9. Contato</h2>
<p>Suporte e comunicação oficial: <a href="mailto:{{EMAIL_CONTATO}}">{{EMAIL_CONTATO}}</a>.</p>
`;

/** Substitui placeholders {{CHAVE}} por valores fornecidos. Placeholders sem valor
 *  permanecem visíveis para sinalizar preenchimento pendente. */
export function fillPlaceholders(
  template: string,
  values: Partial<Record<"RAZAO_SOCIAL" | "CNPJ" | "EMAIL_CONTATO" | "EMAIL_ENCARREGADO", string>>,
): string {
  return template.replace(
    /\{\{(RAZAO_SOCIAL|CNPJ|EMAIL_CONTATO|EMAIL_ENCARREGADO)\}\}/g,
    (m, key) => {
      const v = values[key as keyof typeof values];
      return v && v.trim() ? v : m;
    },
  );
}
