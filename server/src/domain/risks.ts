import type { ObjectCategory, ObjectNature, ProcessFeatures, Risk } from './types.js';

interface RiskTemplate extends Omit<Risk, 'level'> {
  applies: (p: { category: ObjectCategory; nature: ObjectNature; features: ProcessFeatures; estimatedCents: number | null }) => boolean;
}

export function riskLevel(probability: number, impact: number): Risk['level'] {
  const score = probability * impact;
  if (score >= 16) return 'critico';
  if (score >= 10) return 'alto';
  if (score >= 5) return 'medio';
  return 'baixo';
}

const TEMPLATES: RiskTemplate[] = [
  {
    id: 'deserta',
    title: 'Licitação deserta ou fracassada',
    description: 'Preço estimado defasado ou exigências excessivas afastam fornecedores.',
    probability: 3,
    impact: 4,
    allocation: 'contratante',
    mitigation: 'Pesquisa de preços com fontes atualizadas e habilitação proporcional ao objeto.',
    clause: 'As exigências de habilitação limitam-se às estritamente necessárias à garantia do cumprimento das obrigações (art. 37, XXI, da CF).',
    applies: () => true,
  },
  {
    id: 'atraso-entrega',
    title: 'Atraso ou inexecução das entregas',
    description: 'O fornecedor não cumpre o cronograma de entregas.',
    probability: 3,
    impact: 3,
    allocation: 'contratado',
    mitigation: 'Multa moratória diária, cronograma no TR e cadastro de reserva na ata.',
    clause:
      'O atraso injustificado sujeitará a contratada a multa de mora de [0,5%] ao dia sobre o valor da parcela em atraso, limitada a [10%], ' +
      'sem prejuízo das demais sanções do art. 156 da Lei nº 14.133/2021.',
    applies: ({ nature }) => nature === 'compra',
  },
  {
    id: 'pereciveis',
    title: 'Deterioração de produtos perecíveis',
    description: 'Produtos entregues fora da temperatura ou próximos do vencimento.',
    probability: 3,
    impact: 4,
    allocation: 'contratado',
    mitigation: 'Validade mínima na entrega, transporte refrigerado e recusa imediata no recebimento provisório.',
    clause:
      'Os produtos que não atenderem às especificações de validade, temperatura ou integridade serão recusados no ato da entrega, devendo ser ' +
      'substituídos em até [24] horas, às expensas da contratada.',
    applies: ({ category, features }) => category === 'merenda' || !!features.perishable,
  },
  {
    id: 'trabalhista',
    title: 'Passivo trabalhista da contratada',
    description: 'Inadimplemento de verbas trabalhistas pode gerar responsabilidade subsidiária da Administração.',
    probability: 3,
    impact: 5,
    allocation: 'compartilhado',
    mitigation: 'Conta vinculada ou pagamento pelo fato gerador; conferência mensal de folha, FGTS e INSS.',
    clause:
      'A Administração poderá exigir, a qualquer tempo, a comprovação do cumprimento das obrigações trabalhistas, previdenciárias e com o FGTS, ' +
      'e reter o pagamento na medida do inadimplemento (art. 121, §3º, da Lei nº 14.133/2021).',
    applies: ({ category, features }) => category === 'limpeza' || !!features.dedicatedLabor,
  },
  {
    id: 'fornecedor-unico',
    title: 'Baixa competitividade',
    description: 'Mercado restrito eleva o preço ou gera dependência de um fornecedor.',
    probability: 3,
    impact: 3,
    allocation: 'contratante',
    mitigation: 'Parcelamento por item, ampla divulgação no PNCP e aceitação de produtos equivalentes.',
    clause: 'Serão aceitos produtos equivalentes ou de melhor qualidade, mediante comprovação técnica (art. 41, I).',
    applies: ({ features }) => !!features.fewSuppliers,
  },
  {
    id: 'desequilibrio',
    title: 'Variação extraordinária de preços de insumos',
    description: 'Alta de insumos (combustível, alimentos, câmbio) ameaça o equilíbrio econômico-financeiro.',
    probability: 2,
    impact: 4,
    allocation: 'compartilhado',
    mitigation: 'Índice de reajuste setorial e prazo para resposta a pedidos de reequilíbrio.',
    clause:
      'Os pedidos de restabelecimento do equilíbrio econômico-financeiro serão respondidos em até [30] dias, nos termos do art. 92, XI, e art. 124, II, "d".',
    applies: ({ category, nature }) => category === 'merenda' || nature === 'servico_continuo' || nature === 'obra',
  },
  {
    id: 'prazo-apertado',
    title: 'Prazo insuficiente para a contratação',
    description: 'Cronograma apertado pode levar a contratação emergencial indevida.',
    probability: 4,
    impact: 3,
    allocation: 'contratante',
    mitigation: 'Tramitação prioritária, minutas padronizadas e análise jurídica em paralelo.',
    clause: 'A vigência inicial e o cronograma de execução constam do Anexo [X], admitida a prorrogação nos termos do art. 107.',
    applies: ({ features }) => !!features.tightSchedule,
  },
  {
    id: 'obsolescencia',
    title: 'Obsolescência tecnológica e descontinuidade de suporte',
    description: 'Equipamento ou software fica sem suporte durante a vida útil.',
    probability: 2,
    impact: 4,
    allocation: 'contratado',
    mitigation: 'Garantia mínima, compromisso de disponibilidade de peças e roadmap do fabricante.',
    clause:
      'A contratada garantirá a disponibilidade de peças, atualizações e suporte durante todo o período de garantia, substituindo por modelo ' +
      'equivalente ou superior o item descontinuado.',
    applies: ({ category }) => category === 'ti',
  },
  {
    id: 'projeto',
    title: 'Falhas ou omissões de projeto',
    description: 'Projeto básico incompleto gera aditivos e atrasos na obra ou serviço de engenharia.',
    probability: 3,
    impact: 5,
    allocation: 'compartilhado',
    mitigation: 'Revisão do projeto antes do edital e alocação dos riscos de projeto na matriz (art. 22, §4º).',
    clause:
      'Nos regimes de contratação integrada e semi-integrada, os riscos decorrentes de fatos supervenientes relacionados às escolhas de projeto ' +
      'da contratada serão por ela suportados (art. 22, §4º).',
    applies: ({ category, nature, features }) => category === 'engenharia' || nature === 'obra' || !!features.integratedContracting,
  },
  {
    id: 'ata-sem-demanda',
    title: 'Consumo abaixo do registrado em ata',
    description: 'Quantidades superestimadas frustram o fornecedor registrado e distorcem preços.',
    probability: 2,
    impact: 2,
    allocation: 'compartilhado',
    mitigation: 'Memória de cálculo baseada em série histórica e indicação de quantidade mínima por pedido.',
    clause: 'A existência de preços registrados não obriga a Administração a contratar, sendo as quantidades meramente estimativas (art. 83).',
    applies: ({ features }) => !!features.priceRegistration,
  },
];

/**
 * Mapeia os riscos da contratação a partir do tipo de objeto e das
 * características do processo. A matriz é obrigatória para contratações de
 * grande vulto e nos regimes integrado/semi-integrado (art. 22, §3º) e
 * recomendada nas demais.
 */
export function suggestRisks(p: Parameters<RiskTemplate['applies']>[0]): { risks: Risk[]; mandatory: boolean; basis: string } {
  const risks = TEMPLATES.filter((t) => t.applies(p)).map(({ applies: _applies, ...t }) => ({
    ...t,
    level: riskLevel(t.probability, t.impact),
  }));
  risks.sort((a, b) => b.probability * b.impact - a.probability * a.impact);
  const mandatory = !!p.features.largeScale || !!p.features.integratedContracting;
  return {
    risks,
    mandatory,
    basis: mandatory
      ? 'Matriz de riscos obrigatória: contratação de grande vulto ou regime integrado/semi-integrado (art. 22, §3º).'
      : 'Matriz de riscos facultativa, recomendada para alocar responsabilidades e mitigar impugnações (art. 22, caput).',
  };
}
