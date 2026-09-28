import type { DocKind } from '../domain/types.js';

/**
 * Elemento exigido pela lei em um documento da fase preparatória. `patterns`
 * são expressões aplicadas ao texto normalizado (sem acento, minúsculo): se
 * nenhuma casar, o elemento é considerado ausente.
 */
export interface Requirement {
  key: string;
  label: string;
  basis: string;
  mandatory: boolean;
  patterns: RegExp[];
  /** Texto-base sugerido quando o elemento está ausente. */
  hint: string;
}

/**
 * Estudo Técnico Preliminar — art. 18, §1º, da Lei 14.133/2021.
 * O §2º torna obrigatórios os incisos I, IV, VI, VIII e XIII; a ausência dos
 * demais exige justificativa expressa.
 */
export const ETP_REQUIREMENTS: Requirement[] = [
  {
    key: 'necessidade',
    label: 'Descrição da necessidade (problema a resolver sob a ótica do interesse público)',
    basis: 'Art. 18, §1º, I',
    mandatory: true,
    patterns: [/necessidade (da|de) contrata/, /descricao da necessidade/, /problema a ser resolvido/, /interesse publico/],
    hint: 'Descreva o problema a ser resolvido, quem é afetado, o impacto de não contratar e o interesse público atendido.',
  },
  {
    key: 'pca',
    label: 'Previsão no Plano de Contratações Anual',
    basis: 'Art. 18, §1º, II; art. 12, VII',
    mandatory: false,
    patterns: [/plano (anual )?de contratac/, /\bpca\b/],
    hint: 'Indique o item do Plano de Contratações Anual (PCA) em que a demanda está prevista ou justifique a ausência.',
  },
  {
    key: 'requisitos',
    label: 'Requisitos da contratação',
    basis: 'Art. 18, §1º, III',
    mandatory: false,
    patterns: [/requisitos (da|de) contrata/, /requisitos tecnicos/, /requisitos necessarios/],
    hint: 'Liste os requisitos técnicos, de qualidade, de sustentabilidade e de habilitação indispensáveis para atender a necessidade.',
  },
  {
    key: 'quantidades',
    label: 'Estimativa das quantidades com memória de cálculo',
    basis: 'Art. 18, §1º, IV',
    mandatory: true,
    patterns: [/estimativa (das|de) quantidades?/, /memoria de calculo/, /quantitativos?/],
    hint: 'Apresente as quantidades estimadas e a memória de cálculo (série histórica de consumo, público atendido, per capita etc.).',
  },
  {
    key: 'mercado',
    label: 'Levantamento de mercado e justificativa da solução escolhida',
    basis: 'Art. 18, §1º, V',
    mandatory: false,
    patterns: [/levantamento de mercado/, /alternativas (possiveis|de mercado|disponiveis)/, /analise de mercado/],
    hint: 'Compare as alternativas de mercado (aquisição, locação, serviço, outsourcing etc.) e justifique técnica e economicamente a escolhida.',
  },
  {
    key: 'valor',
    label: 'Estimativa do valor da contratação',
    basis: 'Art. 18, §1º, VI; art. 23',
    mandatory: true,
    patterns: [/estimativa (do )?(valor|preco|custo)/, /valor estimado/, /pesquisa de precos?/, /precos? (unitarios? )?referencia/],
    hint: 'Informe o valor estimado com preços unitários referenciais e as fontes da pesquisa de preços (art. 23, §1º).',
  },
  {
    key: 'solucao',
    label: 'Descrição da solução como um todo (inclusive manutenção e assistência técnica)',
    basis: 'Art. 18, §1º, VII',
    mandatory: false,
    patterns: [/descricao da solucao/, /solucao como um todo/, /solucao (escolhida|proposta)/],
    hint: 'Descreva a solução completa, incluindo manutenção, assistência técnica e demais obrigações acessórias.',
  },
  {
    key: 'parcelamento',
    label: 'Justificativa para o parcelamento ou não da contratação',
    basis: 'Art. 18, §1º, VIII; art. 40, V, "b", e §§2º e 3º',
    mandatory: true,
    patterns: [/parcelamento/, /\bparcelad[oa]/, /adjudicacao por (item|lote|grupo)/, /divisao (do objeto|em (itens|lotes))/],
    hint: 'Justifique se o objeto será dividido em itens/lotes (regra geral, art. 40, V, "b") ou por que a divisão é inviável ou prejudicial (economia de escala, responsabilidade técnica única etc.).',
  },
  {
    key: 'resultados',
    label: 'Resultados pretendidos (economicidade e aproveitamento de recursos)',
    basis: 'Art. 18, §1º, IX',
    mandatory: false,
    patterns: [/resultados pretendidos/, /economicidade/, /melhor aproveitamento/],
    hint: 'Aponte os resultados esperados em termos de economicidade e de melhor uso de recursos humanos, materiais e financeiros.',
  },
  {
    key: 'providencias',
    label: 'Providências prévias ao contrato (inclusive capacitação de fiscais)',
    basis: 'Art. 18, §1º, X',
    mandatory: false,
    patterns: [/providencias (previas|a serem adotadas)/, /capacitacao (de|dos) (servidores|fiscais)/, /adequacao do ambiente/],
    hint: 'Informe as providências anteriores ao contrato: adequações físicas, capacitação dos fiscais, designação da equipe de gestão.',
  },
  {
    key: 'correlatas',
    label: 'Contratações correlatas e/ou interdependentes',
    basis: 'Art. 18, §1º, XI',
    mandatory: false,
    patterns: [/contratac(oes|ao) correlat/, /interdependente/],
    hint: 'Indique contratações correlatas ou interdependentes, ou declare que não há.',
  },
  {
    key: 'ambiental',
    label: 'Impactos ambientais e medidas mitigadoras',
    basis: 'Art. 18, §1º, XII; art. 11, IV',
    mandatory: false,
    patterns: [/impactos? ambienta/, /sustentabilidade/, /logistica reversa/, /criterios? sustentave/],
    hint: 'Descreva impactos ambientais, critérios de sustentabilidade, baixo consumo de energia e logística reversa, quando aplicável.',
  },
  {
    key: 'conclusao',
    label: 'Posicionamento conclusivo sobre a adequação da contratação',
    basis: 'Art. 18, §1º, XIII',
    mandatory: true,
    patterns: [/posicionamento conclusivo/, /conclusao/, /declara-se (a )?(viabilidade|viavel)/, /contratacao (e|se mostra) viavel/],
    hint: 'Conclua expressamente se a contratação é viável e adequada ao atendimento da necessidade.',
  },
];

/**
 * Termo de Referência — art. 6º, XXIII, da Lei 14.133/2021 (e art. 40, §1º, para compras).
 * Todos os elementos do inciso XXIII são exigidos.
 */
export const TR_REQUIREMENTS: Requirement[] = [
  {
    key: 'objeto',
    label: 'Definição do objeto (natureza, quantitativos, prazo e prorrogação)',
    basis: 'Art. 6º, XXIII, "a"',
    mandatory: true,
    patterns: [/(definicao|descricao) do objeto/, /\bdo objeto\b/, /objeto:/, /o objeto (do presente|deste|e a)/],
    hint: 'Defina o objeto com natureza, quantitativos, prazo de vigência e possibilidade de prorrogação.',
  },
  {
    key: 'fundamentacao',
    label: 'Fundamentação da contratação (referência ao ETP)',
    basis: 'Art. 6º, XXIII, "b"',
    mandatory: true,
    patterns: [/fundamentacao/, /estudo tecnico preliminar/, /\betp\b/],
    hint: 'Faça referência ao Estudo Técnico Preliminar que fundamenta a contratação.',
  },
  {
    key: 'solucao',
    label: 'Descrição da solução considerando todo o ciclo de vida',
    basis: 'Art. 6º, XXIII, "c"',
    mandatory: true,
    patterns: [/descricao da solucao/, /ciclo de vida/, /solucao como um todo/],
    hint: 'Descreva a solução como um todo, considerando todo o ciclo de vida do objeto.',
  },
  {
    key: 'requisitos',
    label: 'Requisitos da contratação',
    basis: 'Art. 6º, XXIII, "d"',
    mandatory: true,
    patterns: [/requisitos (da|de) contrata/, /requisitos tecnicos/, /especificac(ao|oes) tecnica/],
    hint: 'Detalhe os requisitos técnicos e de qualidade, sem restringir indevidamente a competição.',
  },
  {
    key: 'execucao',
    label: 'Modelo de execução do objeto',
    basis: 'Art. 6º, XXIII, "e"; art. 40, §1º, II',
    mandatory: true,
    patterns: [/modelo de execucao/, /(prazo|local|locais|forma) de entrega/, /execucao do objeto/, /cronograma/],
    hint: 'Defina como o contrato produzirá os resultados: local, prazo e forma de entrega ou execução, cronograma.',
  },
  {
    key: 'gestao',
    label: 'Modelo de gestão do contrato (fiscalização)',
    basis: 'Art. 6º, XXIII, "f"; art. 117',
    mandatory: true,
    patterns: [/modelo de gestao/, /fiscaliza/, /gestor do contrato/, /fiscal do contrato/],
    hint: 'Descreva como a execução será acompanhada: gestor, fiscais técnico e administrativo, registros e comunicação.',
  },
  {
    key: 'medicao',
    label: 'Critérios de medição e de pagamento',
    basis: 'Art. 6º, XXIII, "g"',
    mandatory: true,
    patterns: [/criterios? de medicao/, /medicao e (de )?pagamento/, /\bpagamento\b/],
    hint: 'Defina a unidade de medição, o instrumento de aferição de resultados e o prazo de pagamento em dias após o recebimento.',
  },
  {
    key: 'selecao',
    label: 'Forma e critérios de seleção do fornecedor',
    basis: 'Art. 6º, XXIII, "h"',
    mandatory: true,
    patterns: [/selecao do fornecedor/, /criterio de julgamento/, /menor preco/, /maior desconto/, /tecnica e preco/, /pregao/],
    hint: 'Indique a modalidade, o critério de julgamento (menor preço, maior desconto…) e a forma de adjudicação.',
  },
  {
    key: 'valor',
    label: 'Estimativa do valor com preços unitários referenciais',
    basis: 'Art. 6º, XXIII, "i"; art. 23',
    mandatory: true,
    patterns: [/estimativa (do )?(valor|preco|custo)/, /valor estimado/, /precos? unitarios?/],
    hint: 'Informe o valor estimado com preços unitários referenciais e memória de cálculo (pode constar em documento separado e sigiloso).',
  },
  {
    key: 'orcamento',
    label: 'Adequação orçamentária',
    basis: 'Art. 6º, XXIII, "j"',
    mandatory: true,
    patterns: [/adequacao orcamentaria/, /dotacao orcamentaria/, /recursos orcamentarios/, /elemento de despesa/],
    hint: 'Indique a dotação orçamentária (programa de trabalho, elemento de despesa e fonte de recursos).',
  },
];

export function requirementsFor(kind: DocKind): Requirement[] {
  return kind === 'etp' ? ETP_REQUIREMENTS : TR_REQUIREMENTS;
}
