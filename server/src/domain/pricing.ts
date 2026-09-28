import type { PriceItem, PriceResearch, PriceSample, PriceSource } from './types.js';

export const SOURCE_LABELS: Record<PriceSource, string> = {
  painel: 'Painel de Preços / PNCP (art. 23, §1º, I)',
  contratacao_similar: 'Contratações similares da Administração (art. 23, §1º, II)',
  midia: 'Mídia especializada / sítios eletrônicos (art. 23, §1º, III)',
  fornecedor: 'Pesquisa direta com fornecedores (art. 23, §1º, IV)',
  nota_fiscal: 'Base nacional de notas fiscais eletrônicas (art. 23, §1º, V)',
};

/** Validade máxima de cada fonte, em meses, contada até a data de referência (divulgação do edital). */
const MAX_AGE_MONTHS: Partial<Record<PriceSource, number>> = {
  contratacao_similar: 12, // art. 23, §1º, II
  fornecedor: 6, // art. 23, §1º, IV
  painel: 12, // IN SEGES/ME 65/2021, art. 5º, I
  nota_fiscal: 12, // IN SEGES/ME 65/2021, art. 5º, V
};

export type SampleStatus = 'valido' | 'inexequivel' | 'excessivo' | 'desatualizado';

export interface SampleAnalysis extends PriceSample {
  status: SampleStatus;
  reason?: string;
}

export interface ItemAnalysis {
  item: PriceItem;
  samples: SampleAnalysis[];
  valid: number;
  meanCents: number | null;
  medianCents: number | null;
  minCents: number | null;
  /** Coeficiente de variação dos preços válidos (desvio-padrão / média). */
  cv: number | null;
  method: 'media' | 'mediana' | null;
  estimatedUnitCents: number | null;
  estimatedTotalCents: number | null;
  warnings: string[];
}

export interface PriceReport {
  items: ItemAnalysis[];
  totalCents: number;
  complete: boolean;
  text: string;
}

/** CV acima do qual a média deixa de ser representativa e adotamos a mediana. */
export const CV_LIMIT = 0.25;

export function monthsBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (30.4375 * 24 * 3600 * 1000);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Tratamento estatístico da pesquisa de preços (IN SEGES/ME 65/2021, art. 6º):
 * descarta preços desatualizados, inexequíveis e excessivos (limites em
 * relação à mediana, configuráveis pelo órgão) e adota a média quando o
 * conjunto é homogêneo (CV ≤ 25%) ou a mediana quando é disperso.
 */
export function analyzeItem(item: PriceItem, criteria: PriceResearch['criteria'], refDate: Date): ItemAnalysis {
  const warnings: string[] = [];
  const dated = item.samples.map<SampleAnalysis>((s) => {
    const limit = MAX_AGE_MONTHS[s.source];
    if (limit && monthsBetween(new Date(s.date), refDate) > limit) {
      return { ...s, status: 'desatualizado', reason: `Mais de ${limit} meses até a data de referência` };
    }
    return { ...s, status: 'valido' };
  });

  const current = dated.filter((s) => s.status === 'valido');
  if (current.length) {
    const med = median(current.map((s) => s.unitPriceCents));
    for (const s of current) {
      if (s.unitPriceCents < med * criteria.lowFactor) {
        s.status = 'inexequivel';
        s.reason = `Abaixo de ${Math.round(criteria.lowFactor * 100)}% da mediana`;
      } else if (s.unitPriceCents > med * criteria.highFactor) {
        s.status = 'excessivo';
        s.reason = `Acima de ${Math.round(criteria.highFactor * 100)}% da mediana`;
      }
    }
  }

  const values = dated.filter((s) => s.status === 'valido').map((s) => s.unitPriceCents);
  const suppliers = dated.filter((s) => s.status === 'valido' && s.source === 'fornecedor').length;
  if (values.length < 3) {
    warnings.push(
      `Apenas ${values.length} preço(s) válido(s). A IN SEGES/ME 65/2021 exige no mínimo 3; menos que isso só com justificativa da autoridade competente.`,
    );
  }
  if (suppliers > 0 && suppliers < 3 && values.length === suppliers) {
    warnings.push('Pesquisa baseada só em fornecedores deve ter no mínimo 3 cotações formais (art. 23, §1º, IV).');
  }
  if (!dated.some((s) => s.source === 'painel' || s.source === 'contratacao_similar')) {
    warnings.push('Priorize o Painel de Preços e contratações similares (art. 5º, §1º, da IN 65/2021).');
  }

  if (!values.length) {
    return { item, samples: dated, valid: 0, meanCents: null, medianCents: null, minCents: null, cv: null, method: null, estimatedUnitCents: null, estimatedTotalCents: null, warnings };
  }

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length);
  const cv = mean ? sd / mean : 0;
  const med = median(values);
  const method = cv <= CV_LIMIT ? 'media' : 'mediana';
  const unit = method === 'media' ? Math.round(mean) : med;

  return {
    item,
    samples: dated,
    valid: values.length,
    meanCents: Math.round(mean),
    medianCents: med,
    minCents: Math.min(...values),
    cv,
    method,
    estimatedUnitCents: unit,
    estimatedTotalCents: Math.round(unit * item.quantity),
    warnings,
  };
}

const brl = (cents: number | null) =>
  cents === null ? '—' : (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export function priceReport(research: PriceResearch, opts: { processNumber: string; object: string; refDate: Date }): PriceReport {
  const items = research.items.map((i) => analyzeItem(i, research.criteria, opts.refDate));
  const totalCents = items.reduce((a, i) => a + (i.estimatedTotalCents ?? 0), 0);
  const complete = items.length > 0 && items.every((i) => i.valid >= 3);

  const lines: string[] = [
    `RELATÓRIO DE PESQUISA DE PREÇOS — PROCESSO ${opts.processNumber}`,
    '',
    `Objeto: ${opts.object}`,
    `Data de referência: ${opts.refDate.toLocaleDateString('pt-BR')}`,
    '',
    'Metodologia: pesquisa realizada conforme o art. 23 da Lei nº 14.133/2021 e a IN SEGES/ME nº 65/2021. Foram desconsiderados ' +
      `os preços desatualizados, os inferiores a ${Math.round(research.criteria.lowFactor * 100)}% da mediana (inexequíveis) e os superiores a ` +
      `${Math.round(research.criteria.highFactor * 100)}% da mediana (excessivamente elevados). Adotou-se a média quando o coeficiente de variação ` +
      `dos preços válidos foi de até ${CV_LIMIT * 100}% e a mediana nos demais casos.`,
    '',
  ];
  items.forEach((a, idx) => {
    lines.push(`${idx + 1}. ${a.item.description} — ${a.item.quantity} ${a.item.unit}`);
    for (const s of a.samples) {
      lines.push(
        `   • ${SOURCE_LABELS[s.source]} — ${s.supplier}: ${brl(s.unitPriceCents)} em ${new Date(s.date).toLocaleDateString('pt-BR')}` +
          (s.status === 'valido' ? '' : ` [DESCONSIDERADO: ${s.reason}]`),
      );
    }
    lines.push(
      `   Média ${brl(a.meanCents)} · Mediana ${brl(a.medianCents)} · Menor ${brl(a.minCents)} · CV ${a.cv === null ? '—' : `${(a.cv * 100).toFixed(1)}%`}`,
    );
    lines.push(
      `   Valor unitário estimado (${a.method ?? '—'}): ${brl(a.estimatedUnitCents)} · Total do item: ${brl(a.estimatedTotalCents)}`,
    );
    a.warnings.forEach((w) => lines.push(`   ⚠ ${w}`));
    lines.push('');
  });
  lines.push(`VALOR TOTAL ESTIMADO: ${brl(totalCents)}`);
  return { items, totalCents, complete, text: lines.join('\n') };
}
