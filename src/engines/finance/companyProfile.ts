// ============================================================================
// companyProfile.ts — Catálogo de ramos de atuação por setor.
//
// Usado no cadastro de empresa (CompanyConfigDialog) para configurar
// benchmark por ramo. Lista intencionalmente curta (10 por setor) com os
// ramos mais comuns em PMEs brasileiras — fonte: classificações CNAE +
// distribuição SEBRAE/IBGE de empresas ativas.
// ============================================================================

import type { BusinessType } from "./types";

export interface Ramo {
  id: string;
  label: string;
}

export const RAMOS_POR_SETOR: Record<BusinessType, Ramo[]> = {
  industria: [
    { id: "alimentos", label: "Alimentos e Bebidas" },
    { id: "metalurgia", label: "Metalurgia e Metal-mecânica" },
    { id: "textil", label: "Têxtil e Confecção" },
    { id: "quimica", label: "Química e Cosméticos" },
    { id: "moveis", label: "Móveis e Madeira" },
    { id: "plastico", label: "Plásticos e Embalagens" },
    { id: "construcao", label: "Materiais de Construção" },
    { id: "automotivo", label: "Autopeças e Automotivo" },
    { id: "eletroeletronico", label: "Eletroeletrônicos" },
    { id: "graficaInd", label: "Gráfica e Editorial" },
  ],
  comercio: [
    { id: "varejoAlimentar", label: "Varejo Alimentar (mercados)" },
    { id: "vestuario", label: "Vestuário e Calçados" },
    { id: "farmacia", label: "Farmácias e Drogarias" },
    { id: "materialConstrucao", label: "Material de Construção" },
    { id: "autoPecas", label: "Autopeças e Acessórios" },
    { id: "eletrodomesticos", label: "Eletrodomésticos e Móveis" },
    { id: "ecommerce", label: "E-commerce / Marketplaces" },
    { id: "atacado", label: "Atacado / Distribuição" },
    { id: "petshop", label: "Pet Shop e Agropecuária" },
    { id: "papelaria", label: "Papelaria e Bazar" },
  ],
  servicos: [
    { id: "saude", label: "Saúde (clínicas, consultórios)" },
    { id: "educacao", label: "Educação e Cursos" },
    { id: "ti", label: "Tecnologia / Software" },
    { id: "consultoria", label: "Consultoria e Contabilidade" },
    { id: "alimentacao", label: "Bares, Restaurantes e Food Service" },
    { id: "construcaoCivil", label: "Construção Civil e Reformas" },
    { id: "logistica", label: "Logística e Transporte" },
    { id: "beleza", label: "Beleza e Estética" },
    { id: "turismo", label: "Turismo e Hotelaria" },
    { id: "marketing", label: "Marketing e Publicidade" },
  ],
};

/** Retorna o label legível de um ramo, ou o próprio id se desconhecido. */
export function getRamoLabel(setor: BusinessType, ramoId?: string): string {
  if (!ramoId) return "—";
  const found = RAMOS_POR_SETOR[setor]?.find((r) => r.id === ramoId);
  return found?.label ?? ramoId;
}
