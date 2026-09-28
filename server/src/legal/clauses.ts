import type { DocKind, ObjectCategory } from '../domain/types.js';

export interface Clause {
  id: string;
  category: ObjectCategory | 'geral';
  doc: DocKind | 'edital' | 'contrato';
  section: string;
  title: string;
  text: string;
  basis: string;
  /** De onde veio o texto-base. Os blocos seguem a estrutura dos modelos padronizados, mas precisam de revisão local. */
  source: string;
}

export const CATEGORY_LABELS: Record<ObjectCategory, string> = {
  merenda: 'Gêneros alimentícios / merenda escolar',
  expediente: 'Material de expediente e consumo',
  limpeza: 'Serviços de limpeza com dedicação exclusiva de mão de obra',
  ti: 'Tecnologia da informação (bens e serviços)',
  engenharia: 'Serviços comuns de engenharia',
  medicamentos: 'Medicamentos e insumos de saúde',
  outros: 'Outros objetos',
};

const MODEL = 'Estrutura dos modelos AGU/SEGES — adaptar ao caso concreto';
const LOCAL = 'Banco de cláusulas do órgão';

/**
 * Banco de cláusulas. Os textos seguem a estrutura e a linguagem dos modelos
 * padronizados (art. 19, IV, e art. 25, §1º), mas são pontos de partida: o
 * órgão deve cadastrar aqui as versões aprovadas pela sua assessoria jurídica.
 * Marcadores entre colchetes devem ser preenchidos.
 */
export const CLAUSES: Clause[] = [
  // ---------- gerais ----------
  {
    id: 'g-parcelamento-sim',
    category: 'geral',
    doc: 'etp',
    section: 'parcelamento',
    title: 'Parcelamento em itens (regra geral)',
    basis: 'Art. 18, §1º, VIII; art. 40, V, "b", e §2º',
    source: MODEL,
    text:
      'A contratação será parcelada, com adjudicação por item, uma vez que o objeto é divisível e o parcelamento amplia a competitividade, ' +
      'permitindo a participação de fornecedores especializados em cada item, sem prejuízo técnico ou perda de economia de escala, ' +
      'nos termos do art. 40, V, "b", e §2º, da Lei nº 14.133/2021.',
  },
  {
    id: 'g-parcelamento-nao',
    category: 'geral',
    doc: 'etp',
    section: 'parcelamento',
    title: 'Não parcelamento (lote único) — justificativa',
    basis: 'Art. 18, §1º, VIII; art. 40, §3º',
    source: MODEL,
    text:
      'Optou-se pela adjudicação em lote único, pois a divisão do objeto [demonstrar: comprometeria a responsabilidade técnica única / ' +
      'geraria perda de economia de escala demonstrada no levantamento de mercado / prejudicaria a padronização e a compatibilidade entre os itens], ' +
      'hipótese admitida pelo art. 40, §3º, da Lei nº 14.133/2021. [Anexar a memória comparativa de custos.]',
  },
  {
    id: 'g-pagamento',
    category: 'geral',
    doc: 'tr',
    section: 'medicao',
    title: 'Critérios de medição e pagamento',
    basis: 'Art. 6º, XXIII, "g"; art. 141',
    source: MODEL,
    text:
      'A medição será realizada [mensalmente / a cada entrega], com base nas quantidades efetivamente [entregues e aceitas / executadas], ' +
      'aferidas pelo fiscal do contrato mediante o Instrumento de Medição de Resultado (IMR) constante do Anexo [X]. ' +
      'O pagamento será efetuado no prazo de até [10 (dez)] dias úteis contados do recebimento definitivo e do atesto da nota fiscal, ' +
      'observada a ordem cronológica de pagamentos (art. 141 da Lei nº 14.133/2021). Eventuais glosas serão aplicadas conforme os indicadores do IMR.',
  },
  {
    id: 'g-gestao',
    category: 'geral',
    doc: 'tr',
    section: 'gestao',
    title: 'Modelo de gestão do contrato',
    basis: 'Art. 6º, XXIII, "f"; art. 117',
    source: MODEL,
    text:
      'A execução do contrato será acompanhada e fiscalizada por gestor e fiscais (técnico e administrativo) formalmente designados, ' +
      'que registrarão as ocorrências em sistema próprio, determinarão a regularização das faltas observadas e emitirão os termos de ' +
      'recebimento provisório e definitivo (arts. 117 e 140 da Lei nº 14.133/2021). A comunicação com a contratada será formal, por meio eletrônico.',
  },
  {
    id: 'g-orcamento',
    category: 'geral',
    doc: 'tr',
    section: 'orcamento',
    title: 'Adequação orçamentária',
    basis: 'Art. 6º, XXIII, "j"',
    source: MODEL,
    text:
      'As despesas decorrentes da contratação correrão à conta da dotação orçamentária [Unidade Orçamentária / Programa de Trabalho / ' +
      'Elemento de Despesa / Fonte de Recursos] do exercício de [ano], e das correspondentes nos exercícios seguintes.',
  },
  {
    id: 'g-reajuste',
    category: 'geral',
    doc: 'tr',
    section: 'reajuste',
    title: 'Reajuste',
    basis: 'Art. 25, §7º; art. 92, V',
    source: MODEL,
    text:
      'Os preços são fixos e irreajustáveis pelo prazo de 12 (doze) meses contados da data do orçamento estimado. Após esse prazo, ' +
      'poderão ser reajustados pelo [IPCA/IBGE], com base na variação acumulada no período.',
  },
  {
    id: 'g-conclusao',
    category: 'geral',
    doc: 'etp',
    section: 'conclusao',
    title: 'Posicionamento conclusivo',
    basis: 'Art. 18, §1º, XIII',
    source: MODEL,
    text:
      'Diante do exposto, a equipe de planejamento declara que a contratação é viável e adequada ao atendimento da necessidade descrita, ' +
      'estando os seus elementos justificados neste Estudo Técnico Preliminar.',
  },
  {
    id: 'g-ambiental',
    category: 'geral',
    doc: 'etp',
    section: 'ambiental',
    title: 'Critérios de sustentabilidade',
    basis: 'Art. 11, IV; art. 18, §1º, XII',
    source: MODEL,
    text:
      'Serão exigidos critérios de sustentabilidade compatíveis com o objeto, como embalagens recicláveis, menor volume de resíduos e ' +
      'logística reversa das embalagens e dos bens ao fim da vida útil, conforme o Guia Nacional de Contratações Sustentáveis da AGU.',
  },
  // ---------- merenda escolar ----------
  {
    id: 'm-objeto',
    category: 'merenda',
    doc: 'tr',
    section: 'objeto',
    title: 'Objeto — gêneros alimentícios para a alimentação escolar',
    basis: 'Art. 6º, XXIII, "a"; Lei 11.947/2009',
    source: LOCAL,
    text:
      'Aquisição de gêneros alimentícios [perecíveis e não perecíveis] destinados ao atendimento do Programa Nacional de Alimentação Escolar (PNAE) ' +
      'nas unidades da rede municipal de ensino, conforme especificações, quantidades e cronograma de entrega constantes do Anexo [X], ' +
      'pelo sistema de registro de preços, com vigência de 12 (doze) meses.',
  },
  {
    id: 'm-quantidades',
    category: 'merenda',
    doc: 'etp',
    section: 'quantidades',
    title: 'Memória de cálculo — per capita × alunos × dias letivos',
    basis: 'Art. 18, §1º, IV',
    source: LOCAL,
    text:
      'As quantidades foram estimadas pela fórmula: per capita do cardápio (g) × número de alunos atendidos por etapa de ensino × número de dias letivos, ' +
      'conforme cardápios elaborados pela nutricionista responsável técnica e dados do Censo Escolar [ano]. A memória consta do Anexo [X].',
  },
  {
    id: 'm-requisitos',
    category: 'merenda',
    doc: 'tr',
    section: 'requisitos',
    title: 'Requisitos sanitários e de validade',
    basis: 'Art. 6º, XXIII, "d"; Resolução CD/FNDE nº 06/2020',
    source: LOCAL,
    text:
      'Os produtos deverão atender à legislação sanitária vigente, possuir registro no órgão competente quando exigível, e ser entregues com ' +
      'prazo de validade não inferior a [2/3] do prazo total indicado na embalagem. Os perecíveis serão transportados em veículo adequado, ' +
      'com controle de temperatura, e poderão ser recusados no ato da entrega em caso de não conformidade.',
  },
  {
    id: 'm-agricultura',
    category: 'merenda',
    doc: 'etp',
    section: 'correlatas',
    title: 'Agricultura familiar (contratação correlata)',
    basis: 'Lei 11.947/2009, art. 14',
    source: LOCAL,
    text:
      'Parcela dos recursos repassados pelo FNDE, no percentual mínimo exigido pelo art. 14 da Lei nº 11.947/2009 (observadas as atualizações ' +
      'normativas vigentes), será destinada à aquisição de gêneros da agricultura familiar mediante chamada pública, em procedimento correlato a esta contratação.',
  },
  // ---------- material de expediente ----------
  {
    id: 'e-objeto',
    category: 'expediente',
    doc: 'tr',
    section: 'objeto',
    title: 'Objeto — material de expediente',
    basis: 'Art. 6º, XXIII, "a"',
    source: LOCAL,
    text:
      'Registro de preços para eventual aquisição de material de expediente destinado às unidades administrativas de [ÓRGÃO], conforme ' +
      'especificações e quantidades estimadas no Anexo [X], com vigência de 12 (doze) meses, prorrogável por igual período (art. 84).',
  },
  {
    id: 'e-marca',
    category: 'expediente',
    doc: 'tr',
    section: 'requisitos',
    title: 'Indicação de marca como referência',
    basis: 'Art. 41, I',
    source: MODEL,
    text:
      'A marca eventualmente citada serve apenas como referência de qualidade, sendo aceitos produtos equivalentes, similares ou de melhor qualidade, ' +
      'comprovados mediante [amostra / catálogo / laudo].',
  },
  // ---------- limpeza ----------
  {
    id: 'l-conta-vinculada',
    category: 'limpeza',
    doc: 'tr',
    section: 'medicao',
    title: 'Conta vinculada para obrigações trabalhistas',
    basis: 'Art. 121, §3º, III',
    source: MODEL,
    text:
      'Para assegurar o cumprimento das obrigações trabalhistas, será adotada conta-depósito vinculada, bloqueada para movimentação, na qual ' +
      'serão depositados os valores provisionados para férias, 13º salário e verbas rescisórias, liberados somente mediante autorização da Administração.',
  },
  {
    id: 'l-imr',
    category: 'limpeza',
    doc: 'tr',
    section: 'medicao',
    title: 'Instrumento de Medição de Resultado (IMR)',
    basis: 'Art. 6º, XXIII, "g"',
    source: MODEL,
    text:
      'A remuneração será ajustada mensalmente pelo IMR, que avaliará [qualidade da limpeza, pontualidade, uso de uniformes e EPIs, reposição de ' +
      'insumos], atribuindo pontos que resultarão em faixas de glosa de 0% a [10%] do valor mensal.',
  },
  // ---------- TI ----------
  {
    id: 't-garantia',
    category: 'ti',
    doc: 'tr',
    section: 'requisitos',
    title: 'Garantia e suporte técnico',
    basis: 'Art. 40, §1º, III',
    source: LOCAL,
    text:
      'Os equipamentos deverão possuir garantia on-site de, no mínimo, [36] meses, com atendimento em até [2] dias úteis e solução em até [5] dias úteis, ' +
      'contados da abertura do chamado.',
  },
  {
    id: 't-lgpd',
    category: 'ti',
    doc: 'tr',
    section: 'requisitos',
    title: 'Proteção de dados pessoais',
    basis: 'Lei 13.709/2018 (LGPD)',
    source: LOCAL,
    text:
      'A contratada deverá tratar os dados pessoais a que tiver acesso exclusivamente para a execução do contrato, observando a Lei nº 13.709/2018, ' +
      'e comunicar à Administração qualquer incidente de segurança em até [24] horas.',
  },
  // ---------- engenharia ----------
  {
    id: 'en-art',
    category: 'engenharia',
    doc: 'tr',
    section: 'requisitos',
    title: 'Responsabilidade técnica (ART/RRT)',
    basis: 'Art. 67',
    source: LOCAL,
    text:
      'A contratada deverá indicar responsável técnico devidamente registrado no conselho profissional e apresentar a ART/RRT de execução antes da ordem de serviço.',
  },
  // ---------- medicamentos ----------
  {
    id: 'md-registro',
    category: 'medicamentos',
    doc: 'tr',
    section: 'requisitos',
    title: 'Registro na ANVISA e validade',
    basis: 'Art. 6º, XXIII, "d"; art. 41',
    source: LOCAL,
    text:
      'Os medicamentos deverão possuir registro válido na ANVISA e ser entregues com prazo de validade mínimo de [12] meses ou [75%] do prazo total, ' +
      'acompanhados de laudo de controle de qualidade do lote.',
  },
];

export function findClauses(filter: { category?: string; doc?: string; section?: string; q?: string } = {}): Clause[] {
  const q = filter.q?.toLowerCase();
  return CLAUSES.filter(
    (c) =>
      (!filter.category || c.category === filter.category || c.category === 'geral') &&
      (!filter.doc || c.doc === filter.doc) &&
      (!filter.section || c.section === filter.section) &&
      (!q || `${c.title} ${c.text}`.toLowerCase().includes(q)),
  ).sort((a, b) => Number(a.category === 'geral') - Number(b.category === 'geral'));
}

/** Melhor cláusula para preencher uma seção ausente: a da categoria antes da genérica. */
export function bestClause(category: ObjectCategory, doc: DocKind, section: string): Clause | undefined {
  return findClauses({ category, doc, section })[0];
}
