import { CATEGORY_LABELS } from '../legal/clauses.js';
import { normalize } from '../legal/text.js';
import type { Bid, Contract, Occurrence, Process, ReceiptTerm } from './types.js';

export const brl = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '[valor]' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

const MODALITY: Record<Process['modality'], string> = {
  pregao: 'PREGÃO ELETRÔNICO',
  concorrencia: 'CONCORRÊNCIA',
  dispensa: 'DISPENSA ELETRÔNICA',
  inexigibilidade: 'INEXIGIBILIDADE',
};

const CRITERION: Record<Process['criterion'], string> = {
  menor_preco: 'menor preço',
  maior_desconto: 'maior desconto',
  tecnica_preco: 'técnica e preço',
  melhor_tecnica: 'melhor técnica ou conteúdo artístico',
};

/** Extrai do TR aprovado o parágrafo que contém um termo, para reaproveitar no edital. */
function fromTr(p: Process, pattern: RegExp): string | null {
  const paras = p.documents.tr.text.split(/\n\s*\n/);
  return paras.find((t) => pattern.test(normalize(t)))?.trim() ?? null;
}

/**
 * Minuta do edital montada a partir dos dados já aprovados (TR, pesquisa de
 * preços e matriz de riscos), com o checklist do art. 25.
 */
export function generateEdital(p: Process, estimatedCents: number, org: string): NonNullable<Process['edital']> & { text: string } {
  const exclusiveMe = estimatedCents <= 80_000_00;
  const payment = fromTr(p, /pagamento/);
  const delivery = fromTr(p, /(entrega|execucao)/);
  const reajuste = fromTr(p, /reajust/);
  const riskClauses = p.risks.map((r, i) => `${i + 1}. ${r.title} (alocação: ${r.allocation}) — ${r.clause}`);

  const sections: [string, string][] = [
    ['1. DO OBJETO', `${p.object}, conforme especificações do Termo de Referência (Anexo I). Categoria: ${CATEGORY_LABELS[p.category]}.`],
    [
      '2. DA PARTICIPAÇÃO',
      [
        'Poderão participar os interessados cujo ramo de atividade seja compatível com o objeto e que estejam cadastrados no sistema eletrônico utilizado.',
        exclusiveMe
          ? 'A participação é exclusiva para microempresas e empresas de pequeno porte (art. 48, I, da LC nº 123/2006).'
          : 'Será assegurado às ME/EPP o tratamento diferenciado da LC nº 123/2006.',
        'Não poderão participar os impedidos nos termos do art. 14 da Lei nº 14.133/2021.',
      ].join('\n'),
    ],
    [
      '3. DA APRESENTAÇÃO DA PROPOSTA E DO JULGAMENTO',
      `O critério de julgamento será o de ${CRITERION[p.criterion]}, com modo de disputa [aberto / aberto e fechado]. ` +
        `O valor estimado da contratação é de ${brl(estimatedCents)}${p.modality === 'pregao' ? ' [ou sigiloso, nos termos do art. 24]' : ''}. ` +
        'Serão desclassificadas as propostas com preços inexequíveis ou acima do orçamento estimado (art. 59).',
    ],
    [
      '4. DA HABILITAÇÃO',
      'Serão exigidos os documentos de habilitação jurídica, fiscal, social e trabalhista, econômico-financeira e técnica previstos nos arts. 62 a 70, ' +
        'conforme o Anexo [X], somente do licitante vencedor (art. 63, II). Serão consultados o CEIS, o CNEP e o cadastro de inidôneos do TCU.',
    ],
    [
      '5. DOS RECURSOS',
      'A intenção de recorrer deverá ser manifestada imediatamente após o julgamento ou a habilitação, com prazo de 3 (três) dias úteis para as razões (art. 165).',
    ],
    ['6. DA ENTREGA E DA EXECUÇÃO', delivery ?? 'Conforme modelo de execução definido no Termo de Referência.'],
    [
      '7. DA FISCALIZAÇÃO E DA GESTÃO',
      'A execução será acompanhada por gestor e fiscais designados, que emitirão os termos de recebimento provisório e definitivo (arts. 117 e 140).',
    ],
    ['8. DO PAGAMENTO', payment ?? 'Conforme critérios de medição e pagamento definidos no Termo de Referência.'],
    ['9. DO REAJUSTE', reajuste ?? 'Os preços poderão ser reajustados após 12 meses da data do orçamento estimado, pelo índice [IPCA/IBGE] (art. 25, §7º).'],
    [
      '10. DAS SANÇÕES',
      'O licitante ou contratado que incorrer nas infrações do art. 155 ficará sujeito às sanções do art. 156 (advertência, multa, impedimento de licitar e contratar e declaração de inidoneidade).',
    ],
    ['11. DA MATRIZ DE RISCOS', riskClauses.length ? riskClauses.join('\n') : 'Não se aplica.'],
    [
      '12. DA IMPUGNAÇÃO E DOS ESCLARECIMENTOS',
      'Qualquer pessoa poderá impugnar o edital ou pedir esclarecimentos até 3 (três) dias úteis antes da abertura da sessão (art. 164).',
    ],
    ['13. DOS ANEXOS', 'Anexo I — Termo de Referência; Anexo II — Estudo Técnico Preliminar (extrato); Anexo III — Minuta do contrato / ata; Anexo IV — Modelo de proposta.'],
  ];

  const text = [
    `${org}`,
    `${MODALITY[p.modality]} Nº [__]/${new Date().getFullYear()} — PROCESSO ${p.number}`,
    '',
    `Torna-se público que ${org} realizará licitação na modalidade ${MODALITY[p.modality].toLowerCase()}, ` +
      `nos termos da Lei nº 14.133/2021 e demais normas aplicáveis, conforme as condições a seguir.`,
    '',
    ...sections.flatMap(([title, body]) => [title, body, '']),
  ].join('\n');

  const checklist = [
    { item: 'Objeto definido e vinculado ao TR aprovado', basis: 'Art. 25, caput', ok: p.documents.tr.status === 'aprovado' },
    { item: 'Critério de julgamento', basis: 'Art. 25, caput; art. 33', ok: true },
    { item: 'Regras de habilitação', basis: 'Art. 25, caput; arts. 62–70', ok: true },
    { item: 'Prazos e regras de recurso', basis: 'Art. 25, caput; art. 165', ok: true },
    { item: 'Condições de pagamento definidas', basis: 'Art. 25, caput', ok: payment !== null },
    { item: 'Índice de reajuste', basis: 'Art. 25, §7º', ok: reajuste !== null },
    { item: 'Matriz de riscos (quando obrigatória)', basis: 'Art. 22, §3º', ok: !(p.features.largeScale || p.features.integratedContracting) || p.risks.length > 0 },
    { item: 'Valor estimado fundamentado em pesquisa de preços', basis: 'Art. 23', ok: estimatedCents > 0 },
    { item: 'Tratamento ME/EPP', basis: 'LC 123/2006, arts. 47–49', ok: true },
    { item: 'Parecer jurídico antes da publicação', basis: 'Art. 53', ok: false },
  ];

  return { text, checklist, generatedAt: new Date().toISOString() };
}

/** Contrato (art. 92) ou Ata de Registro de Preços (arts. 82–86) preenchidos com a proposta vencedora. */
export function generateContract(
  p: Process,
  bid: Bid,
  opts: { org: string; number: string; signedAt: string; months: number; fiscalName: string },
): string {
  const ata = !!p.features.priceRegistration;
  const until = new Date(opts.signedAt);
  until.setMonth(until.getMonth() + opts.months);
  const items = bid.items
    .map((it) => {
      const item = p.prices.items.find((i) => i.id === it.itemId);
      const qty = item?.quantity ?? 0;
      return `  • ${item?.description ?? it.itemId}${it.brand ? ` — marca ${it.brand}` : ''}: ${qty} ${item?.unit ?? 'un'} × ${brl(it.unitPriceCents)} = ${brl(qty * it.unitPriceCents)}`;
    })
    .join('\n');

  const header = ata
    ? `ATA DE REGISTRO DE PREÇOS Nº ${opts.number}`
    : `CONTRATO ADMINISTRATIVO Nº ${opts.number}`;
  const clauses: [string, string][] = ata
    ? [
        ['CLÁUSULA PRIMEIRA — DO OBJETO', `Registro de preços para ${p.object}, conforme o edital do processo ${p.number} e a proposta vencedora.`],
        ['CLÁUSULA SEGUNDA — DOS PREÇOS REGISTRADOS', `${items}\nValor total estimado: ${brl(bid.totalCents)}.`],
        [
          'CLÁUSULA TERCEIRA — DA VIGÊNCIA',
          `A ata vigorará de ${date(opts.signedAt)} a ${date(until.toISOString())}, prorrogável por igual período, desde que comprovada a vantajosidade do preço (art. 84).`,
        ],
        ['CLÁUSULA QUARTA — DA UTILIZAÇÃO', 'A existência de preços registrados não obriga a Administração a contratar (art. 83). As contratações serão formalizadas por termo de contrato ou instrumento equivalente.'],
        ['CLÁUSULA QUINTA — DO CANCELAMENTO', 'O registro poderá ser cancelado nas hipóteses previstas no edital e no regulamento do sistema de registro de preços do órgão (art. 82).'],
      ]
    : [
        ['CLÁUSULA PRIMEIRA — DO OBJETO', `${p.object}, vinculado ao edital do processo ${p.number} e à proposta da contratada (art. 92, I e II).`],
        ['CLÁUSULA SEGUNDA — DO PREÇO', `${items}\nValor total: ${brl(bid.totalCents)} (art. 92, V).`],
        ['CLÁUSULA TERCEIRA — DA VIGÊNCIA', `De ${date(opts.signedAt)} a ${date(until.toISOString())}, admitida a prorrogação nos termos dos arts. 106 e 107.`],
        ['CLÁUSULA QUARTA — DA DOTAÇÃO ORÇAMENTÁRIA', `${p.budgetLine || '[dotação orçamentária]'} (art. 92, VIII).`],
        ['CLÁUSULA QUINTA — DO PAGAMENTO E DO REAJUSTE', 'Conforme os critérios de medição, pagamento e reajuste do Termo de Referência (art. 92, V e VI).'],
        ['CLÁUSULA SEXTA — DO RECEBIMENTO', 'O objeto será recebido provisória e definitivamente nos termos do art. 140, mediante termos detalhados emitidos pela fiscalização.'],
        ['CLÁUSULA SÉTIMA — DA FISCALIZAÇÃO', `A execução será fiscalizada por ${opts.fiscalName}, designado(a) pela autoridade competente (art. 117).`],
        ['CLÁUSULA OITAVA — DA MATRIZ DE RISCOS', p.risks.length ? p.risks.map((r) => `${r.title}: risco do ${r.allocation}.`).join(' ') : 'Não se aplica.'],
        ['CLÁUSULA NONA — DAS SANÇÕES', 'Aplicam-se as sanções dos arts. 155 a 163 da Lei nº 14.133/2021, garantidos o contraditório e a ampla defesa.'],
        ['CLÁUSULA DÉCIMA — DA EXTINÇÃO', 'O contrato poderá ser extinto nas hipóteses dos arts. 137 a 139.'],
        ['CLÁUSULA DÉCIMA PRIMEIRA — DA PUBLICAÇÃO', 'O extrato será divulgado no PNCP como condição de eficácia (art. 94).'],
      ];

  return [
    header,
    `PROCESSO ${p.number}`,
    '',
    `Pelo presente instrumento, ${opts.org}, doravante CONTRATANTE, e ${bid.supplierName}, inscrita no CNPJ ${bid.cnpj}, ` +
      `doravante ${ata ? 'FORNECEDOR REGISTRADO' : 'CONTRATADA'}, ajustam o seguinte, com fundamento na Lei nº 14.133/2021:`,
    '',
    ...clauses.flatMap(([t, b]) => [t, b, '']),
    `${date(opts.signedAt)}`,
  ].join('\n');
}

export const OCCURRENCE_LABELS: Record<Occurrence['kind'], string> = {
  entrega: 'Entrega',
  atraso: 'Atraso',
  nao_conformidade: 'Não conformidade',
  observacao: 'Observação',
};

/** Termo de recebimento (art. 140) com base nas ocorrências e glosas do período. */
export function buildReceipt(
  contract: Contract,
  type: ReceiptTerm['type'],
  opts: { id: string; at: string; authorId: string; authorName: string; nature: Process['nature']; periodLabel: string; measuredCents: number; occurrences: Occurrence[] },
): ReceiptTerm {
  const glosaPercent = Math.min(100, opts.occurrences.reduce((a, o) => a + o.glosaPercent, 0));
  const glosaCents = Math.round((opts.measuredCents * glosaPercent) / 100);
  const payableCents = opts.measuredCents - glosaCents;
  const occ = opts.occurrences.length
    ? opts.occurrences.map((o) => `  • ${date(o.at)} — ${OCCURRENCE_LABELS[o.kind]}: ${o.description}${o.glosaPercent ? ` (glosa ${o.glosaPercent}%)` : ''}`).join('\n')
    : '  • Nenhuma ocorrência registrada no período.';

  const title = type === 'provisorio' ? 'TERMO DE RECEBIMENTO PROVISÓRIO' : 'TERMO DE RECEBIMENTO DEFINITIVO';
  // Art. 140: inciso I para obras e serviços, inciso II para compras
  const inciso = opts.nature === 'compra' ? 'II' : 'I';
  const lead =
    type === 'provisorio'
      ? `Recebo provisoriamente o objeto abaixo, para efeito de posterior verificação de sua conformidade com as especificações (art. 140, ${inciso}, "a").`
      : `Recebo definitivamente o objeto abaixo, atestando o atendimento das exigências contratuais após a verificação da qualidade e da quantidade (art. 140, ${inciso}, "b").`;

  const text = [
    title,
    `${contract.kind === 'ata' ? 'Ata' : 'Contrato'} nº ${contract.number} — ${contract.supplierName} (CNPJ ${contract.cnpj})`,
    `Período: ${opts.periodLabel}`,
    '',
    lead,
    '',
    'Ocorrências do período:',
    occ,
    '',
    `Valor medido: ${brl(opts.measuredCents)}`,
    `Glosas (IMR): ${glosaPercent}% = ${brl(glosaCents)}`,
    `Valor liberado para pagamento: ${brl(payableCents)}`,
    '',
    `${date(opts.at)} — ${opts.authorName}, fiscal do contrato`,
  ].join('\n');

  return { id: opts.id, type, at: opts.at, authorId: opts.authorId, periodLabel: opts.periodLabel, measuredCents: opts.measuredCents, glosaCents, payableCents, occurrenceIds: opts.occurrences.map((o) => o.id), text };
}
