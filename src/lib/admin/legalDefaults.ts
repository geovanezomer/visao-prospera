// ============================================================================
// Textos legais padrão (Termos de Uso e Política de Privacidade).
// São aplicados automaticamente quando o admin ainda não configurou nada.
// Modelo genérico para SaaS B2B brasileiro (LGPD).
// ============================================================================

export const DEFAULT_TERMS_HTML = `
<h1>Termos de Uso</h1>
<p><em>Última atualização: ${new Date().toLocaleDateString("pt-BR")}</em></p>

<h2>1. Aceitação dos Termos</h2>
<p>Ao acessar e utilizar esta plataforma, você concorda integralmente com estes Termos de Uso. Caso não concorde com qualquer disposição, recomendamos que não utilize o serviço.</p>

<h2>2. Descrição do Serviço</h2>
<p>Oferecemos uma plataforma de análise e simulação financeira voltada a pequenas e médias empresas, incluindo DRE, Balanço Patrimonial, Fluxo de Caixa, indicadores financeiros e simulações tributárias.</p>

<h2>3. Cadastro e Conta</h2>
<p>O usuário é responsável por manter a confidencialidade de suas credenciais de acesso e por todas as atividades realizadas em sua conta. Informações fornecidas no cadastro devem ser verdadeiras e atualizadas.</p>

<h2>4. Planos e Pagamentos</h2>
<p>A contratação dos planos é feita conforme valores e condições vigentes no momento da compra. Os pagamentos são processados por provedores terceirizados. A renovação de assinaturas recorrentes ocorre automaticamente até cancelamento expresso.</p>

<h2>5. Uso Permitido</h2>
<p>O usuário compromete-se a utilizar a plataforma apenas para finalidades lícitas e em conformidade com a legislação brasileira. É vedado o uso para atividades fraudulentas, ofensivas ou que violem direitos de terceiros.</p>

<h2>6. Propriedade Intelectual</h2>
<p>Todo o conteúdo, marcas, código-fonte, design e materiais da plataforma são de propriedade exclusiva da empresa ou de seus licenciadores, sendo protegidos pela legislação de propriedade intelectual.</p>

<h2>7. Limitação de Responsabilidade</h2>
<p>As análises e indicadores gerados pela plataforma têm caráter informativo e não substituem o aconselhamento profissional contábil, jurídico ou tributário. A empresa não se responsabiliza por decisões tomadas com base exclusivamente nos relatórios gerados.</p>

<h2>8. Cancelamento e Reembolso</h2>
<p>O usuário pode cancelar sua assinatura a qualquer momento. Solicitações de reembolso seguem o Código de Defesa do Consumidor — 7 dias corridos para arrependimento em contratações online.</p>

<h2>9. Alterações dos Termos</h2>
<p>Reservamo-nos o direito de alterar estes Termos a qualquer momento. Alterações relevantes serão comunicadas aos usuários por e-mail ou aviso na plataforma.</p>

<h2>10. Foro</h2>
<p>Fica eleito o foro do domicílio do contratante para dirimir quaisquer controvérsias decorrentes deste contrato, com renúncia a qualquer outro, por mais privilegiado que seja.</p>
`.trim();

export const DEFAULT_PRIVACY_HTML = `
<h1>Política de Privacidade</h1>
<p><em>Última atualização: ${new Date().toLocaleDateString("pt-BR")}</em></p>

<h2>1. Introdução</h2>
<p>Esta Política de Privacidade descreve como tratamos os dados pessoais coletados durante o uso da nossa plataforma, em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).</p>

<h2>2. Dados Coletados</h2>
<ul>
  <li><strong>Dados cadastrais:</strong> nome, e-mail, telefone, CPF/CNPJ.</li>
  <li><strong>Dados financeiros:</strong> informações da empresa inseridas voluntariamente pelo usuário (receitas, despesas, balanços).</li>
  <li><strong>Dados de navegação:</strong> endereço IP, tipo de dispositivo, páginas acessadas, cookies.</li>
  <li><strong>Dados de pagamento:</strong> processados diretamente por provedores certificados (não armazenamos dados completos de cartão).</li>
</ul>

<h2>3. Finalidade do Tratamento</h2>
<ul>
  <li>Prestação dos serviços contratados.</li>
  <li>Comunicação sobre atualizações, suporte e marketing (mediante consentimento).</li>
  <li>Cumprimento de obrigações legais e regulatórias.</li>
  <li>Melhoria contínua da plataforma.</li>
</ul>

<h2>4. Base Legal</h2>
<p>O tratamento dos dados ocorre com base em: execução de contrato, consentimento do titular, cumprimento de obrigação legal e legítimo interesse, conforme aplicável.</p>

<h2>5. Compartilhamento de Dados</h2>
<p>Não vendemos dados pessoais. Compartilhamos apenas com prestadores essenciais (hospedagem, processadores de pagamento, ferramentas de analytics), todos sob obrigação contratual de confidencialidade.</p>

<h2>6. Segurança</h2>
<p>Adotamos medidas técnicas e organizacionais para proteger os dados, incluindo criptografia em trânsito (HTTPS/TLS), controle de acesso, backups regulares e monitoramento.</p>

<h2>7. Direitos do Titular</h2>
<p>Conforme a LGPD, você pode solicitar a qualquer momento: confirmação da existência de tratamento, acesso, correção, anonimização, portabilidade, eliminação dos dados e revogação do consentimento. Entre em contato pelo e-mail informado abaixo.</p>

<h2>8. Retenção dos Dados</h2>
<p>Os dados são mantidos pelo tempo necessário para a prestação do serviço e cumprimento de obrigações legais. Após o encerramento da conta, os dados podem ser anonimizados ou eliminados, conforme política interna e legislação aplicável.</p>

<h2>9. Cookies</h2>
<p>Utilizamos cookies para autenticação, preferências do usuário e analytics. Você pode desabilitá-los nas configurações do seu navegador, ciente de que algumas funcionalidades podem ser afetadas.</p>

<h2>10. Encarregado (DPO) e Contato</h2>
<p>Para exercer seus direitos ou esclarecer dúvidas sobre esta Política, entre em contato pelo canal oficial de suporte informado em nosso site.</p>
`.trim();
