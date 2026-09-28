import type {
  ComplianceReport,
  DocKind,
  Finding,
  ObjectCategory,
  ObjectNature,
  PriceResearch,
  ProcessFeatures,
  SectionCoverage,
} from '../domain/types.js';
import { bestClause } from './clauses.js';
import { requirementsFor } from './requirements.js';
import { anyMatch, excerptAt, normalize, paragraphs } from './text.js';

export interface AnalysisContext {
  category: ObjectCategory;
  nature: ObjectNature;
  estimatedCents: number | null;
  features: ProcessFeatures;
  prices?: PriceResearch;
}

/** Limite para participação exclusiva de ME/EPP por item (LC 123/2006, art. 48, I). */
export const MEEPP_EXCLUSIVE_LIMIT_CENTS = 80_000_00;

const VAGUE_TERMS: { re: RegExp; label: string }[] = [
  { re: /\bde (boa|otima|primeira) qualidade\b/, label: '"de boa qualidade"' },
  { re: /\bde primeira linha\b/, label: '"de primeira linha"' },
  { re: /\baproximadamente\b/, label: '"aproximadamente"' },
  { re: /\bentre outros\b|\betc\.?(\s|$)/, label: '"entre outros"/"etc."' },
  { re: /\bquando necessario\b|\bsempre que necessario\b/, label: '"quando necessário"' },
  { re: /\ba criterio da (administracao|contratante)\b/, label: '"a critério da Administração"' },
  { re: /\bsimilar(es)? aos? atuais\b/, label: '"similar ao atual"' },
];

const PAYMENT_VAGUE = [
  /\boportunamente\b/,
  /\bem tempo habil\b/,
  /\bconforme (a )?disponibilidade (financeira|de recursos)\b/,
  /\bapos (a )?(aprovacao|liberacao) (dos recursos|financeira)\b/,
  /\bquando (houver|da) disponibilidade\b/,
  /\ba criterio da (administracao|contratante)\b/,
];

const DAYS = /\b\d+\s*(\([^)]*\)\s*)?dias?\b/;

const JUSTIFY = /\b(porque|pois|uma vez que|em razao|tendo em vista|justifica|economia de escala|competitividade|inviavel|prejuizo|visto que|dado que)\b/;

function find(original: string, norm: string, re: RegExp): { excerpt: string } | null {
  const m = re.exec(norm);
  if (!m || m.index === undefined) return null;
  return { excerpt: excerptAt(original, m.index, m[0].length) };
}

/**
 * Cruza o rascunho com os elementos exigidos pela Lei 14.133/2021 e com
 * verificações de qualidade que costumam motivar impugnações e apontamentos
 * dos tribunais de contas. É determinístico e explicável: cada apontamento
 * traz o dispositivo legal e, quando possível, o trecho que o motivou.
 */
export function analyzeDocument(kind: DocKind, text: string, ctx: AnalysisContext, now = new Date()): ComplianceReport {
  const norm = normalize(text);
  const findings: Finding[] = [];
  const push = (f: Finding) => findings.push(f);

  // 1. Cobertura dos elementos legais
  const sections: SectionCoverage[] = requirementsFor(kind).map((r) => ({
    key: r.key,
    label: r.label,
    basis: r.basis,
    mandatory: r.mandatory,
    present: anyMatch(norm, r.patterns) !== null,
  }));

  const hasWaiver = /\bnao se aplica\b|\bdispensad[oa] (a|o) (apresentacao|elemento)\b/.test(norm);
  for (const s of sections.filter((x) => !x.present)) {
    const req = requirementsFor(kind).find((r) => r.key === s.key)!;
    const clause = bestClause(ctx.category, kind, s.key);
    if (s.mandatory) {
      push({
        id: `falta-${s.key}`,
        severity: 'bloqueante',
        basis: s.basis,
        message: `Falta ${lower(s.label)}.`,
        suggestion: clause?.text ?? req.hint,
      });
    } else if (!hasWaiver) {
      push({
        id: `falta-${s.key}`,
        severity: 'alerta',
        basis: `${s.basis}; art. 18, §2º`,
        message: `Elemento ausente sem justificativa: ${lower(s.label)}. Inclua o conteúdo ou justifique por que não se aplica.`,
        suggestion: clause?.text ?? req.hint,
      });
    }
  }

  // 2. Parcelamento mencionado mas não justificado
  if (sections.some((s) => s.key === 'parcelamento' && s.present)) {
    const paras = paragraphs(text).filter((p) => /parcel|lote unico|por item|por lote/.test(normalize(p.text)));
    if (paras.length && !paras.some((p) => JUSTIFY.test(normalize(p.text)))) {
      push({
        id: 'parcelamento-sem-justificativa',
        severity: 'alerta',
        basis: 'Art. 18, §1º, VIII; art. 40, §§2º e 3º',
        message: 'O parcelamento é mencionado, mas sem justificativa técnica ou econômica da opção adotada.',
        excerpt: excerptAt(text, paras[0].index, paras[0].text.length > 200 ? 200 : paras[0].text.length),
        suggestion: bestClause(ctx.category, 'etp', 'parcelamento')?.text,
      });
    }
  }

  // 3. Medição e pagamento ambíguos (TR)
  if (kind === 'tr') {
    const payParas = paragraphs(text).filter((p) => /pagamento|medicao/.test(normalize(p.text)));
    const vague = payParas
      .map((p) => ({ p, m: PAYMENT_VAGUE.map((re) => re.exec(normalize(p.text))).find(Boolean) }))
      .find((x) => x.m);
    if (vague?.m) {
      push({
        id: 'pagamento-ambiguo',
        severity: 'bloqueante',
        basis: 'Art. 6º, XXIII, "g"; art. 92, V e VI; art. 141',
        message:
          'O critério de medição e pagamento está ambíguo: condiciona o pagamento a evento indeterminado. Defina a unidade de medição e o prazo em dias.',
        excerpt: excerptAt(text, vague.p.index + (vague.m.index ?? 0), vague.m[0].length),
        suggestion: bestClause(ctx.category, 'tr', 'medicao')?.text,
      });
    } else if (payParas.length && !payParas.some((p) => DAYS.test(normalize(p.text)))) {
      push({
        id: 'pagamento-sem-prazo',
        severity: 'alerta',
        basis: 'Art. 6º, XXIII, "g"; art. 92, V',
        message: 'O TR trata de pagamento, mas não fixa o prazo em dias contado do recebimento/atesto.',
        suggestion: bestClause(ctx.category, 'tr', 'medicao')?.text,
      });
    }
    if (payParas.length && !/\b(medicao|imr|instrumento de medicao|unidade de medida|aferi)/.test(norm)) {
      push({
        id: 'medicao-ausente',
        severity: 'alerta',
        basis: 'Art. 6º, XXIII, "g"',
        message: 'Não há critério objetivo de medição (unidade de medida, IMR ou forma de aferição do que foi entregue).',
        suggestion: bestClause(ctx.category, 'tr', 'medicao')?.text,
      });
    }
  }

  // 4. Legislação revogada
  const revoked = find(text, norm, /\blei (n[oº.]*\s*)?(8\.?666|10\.?520|12\.?462)\b/);
  if (revoked) {
    push({
      id: 'lei-revogada',
      severity: 'bloqueante',
      basis: 'Art. 193, II, da Lei 14.133/2021',
      message: 'O texto fundamenta-se em lei revogada (Lei 8.666/93, 10.520/02 ou RDC). Atualize as referências para a Lei 14.133/2021.',
      excerpt: revoked.excerpt,
    });
  }

  // 5. Indicação de marca sem "ou equivalente"
  const brand = find(text, norm, /\bmarca\b(?![^.\n]*(equivalente|similar|melhor qualidade|referencia))/);
  if (brand && !/\bpadronizacao\b/.test(norm)) {
    push({
      id: 'marca',
      severity: 'alerta',
      basis: 'Art. 41, I',
      message:
        'Há indicação de marca sem a expressão "ou equivalente/similar" e sem justificativa de padronização — risco de direcionamento.',
      excerpt: brand.excerpt,
      suggestion: bestClause('expediente', 'tr', 'requisitos')?.text,
    });
  }

  // 6. Cláusulas restritivas à competição
  const origin = find(text, norm, /\b(sediad[ao]s?|domiciliad[ao]s?|estabelecid[ao]s?) (no|neste|em|na) (municipio|estado|cidade)/);
  if (origin) {
    push({
      id: 'restricao-sede',
      severity: 'bloqueante',
      basis: 'Art. 9º, I, "b"',
      message: 'Exigência de sede ou domicílio do licitante na localidade é vedada: restringe o caráter competitivo.',
      excerpt: origin.excerpt,
      suggestion: 'Substitua pela exigência de prazo de entrega/atendimento compatível, que pode ser cumprido por fornecedor de qualquer localidade.',
    });
  }
  const visit = find(text, norm, /\bvisita tecnica (e |sera )?obrigatoria/);
  if (visit) {
    push({
      id: 'visita-obrigatoria',
      severity: 'alerta',
      basis: 'Art. 63, §§2º e 3º',
      message: 'A vistoria obrigatória deve admitir substituição por declaração de conhecimento pleno das condições do local.',
      excerpt: visit.excerpt,
      suggestion:
        'A vistoria é facultativa; o licitante que não a realizar deverá apresentar declaração de que conhece as condições e peculiaridades do objeto.',
    });
  }

  // 7. Quantidades sem memória de cálculo (ETP)
  if (kind === 'etp' && sections.find((s) => s.key === 'quantidades')?.present) {
    if (!/\b(memoria de calculo|serie historica|consumo medio|per capita|historico de consumo)\b/.test(norm)) {
      push({
        id: 'quantidades-sem-memoria',
        severity: 'alerta',
        basis: 'Art. 18, §1º, IV',
        message: 'As quantidades não estão acompanhadas de memória de cálculo (série histórica, consumo médio, per capita).',
        suggestion: bestClause(ctx.category, 'etp', 'quantidades')?.text,
      });
    }
  }

  // 8. Pesquisa de preços com menos de 3 fontes
  if (ctx.prices?.items.length) {
    const thin = ctx.prices.items.filter((i) => i.samples.length < 3);
    if (thin.length) {
      push({
        id: 'precos-insuficientes',
        severity: 'alerta',
        basis: 'Art. 23, §1º; IN SEGES/ME 65/2021, art. 6º',
        message: `${thin.length} item(ns) da pesquisa de preços têm menos de 3 preços válidos: ${thin
          .slice(0, 3)
          .map((i) => i.description)
          .join('; ')}. Amplie a pesquisa ou justifique.`,
      });
    }
  } else if (kind === 'etp') {
    push({
      id: 'precos-ausentes',
      severity: 'sugestao',
      basis: 'Art. 23',
      message: 'Nenhuma pesquisa de preços registrada no processo. Use a pesquisa automática para gerar o relatório do valor estimado.',
    });
  }

  // 9. ME/EPP
  if (
    ctx.estimatedCents !== null &&
    ctx.estimatedCents <= MEEPP_EXCLUSIVE_LIMIT_CENTS &&
    !/\b(microempresas?|empresas? de pequeno porte|me\/epp|lc 123|complementar (n[oº.]*\s*)?123)\b/.test(norm)
  ) {
    push({
      id: 'me-epp',
      severity: 'alerta',
      basis: 'LC 123/2006, art. 48, I; art. 4º da Lei 14.133/2021',
      message: 'Valor estimado até R$ 80.000,00: a participação deve ser exclusiva para ME/EPP, salvo justificativa (art. 49 da LC 123).',
      suggestion: 'A participação neste certame é exclusiva para microempresas e empresas de pequeno porte, nos termos do art. 48, I, da LC nº 123/2006.',
    });
  }

  // 10. Garantia e reajuste (TR)
  if (kind === 'tr') {
    if (ctx.nature === 'compra' && !/\bgarantia\b/.test(norm)) {
      push({
        id: 'garantia-produto',
        severity: 'alerta',
        basis: 'Art. 40, §1º, III',
        message: 'O TR de compra deve indicar a garantia exigida e as condições de manutenção e assistência técnica, quando for o caso.',
      });
    }
    if (!/\breajust/.test(norm)) {
      push({
        id: 'reajuste',
        severity: 'alerta',
        basis: 'Art. 25, §7º; art. 92, V',
        message: 'Não há índice de reajuste. O edital deve prevê-lo obrigatoriamente, independentemente do prazo do contrato.',
        suggestion: bestClause(ctx.category, 'tr', 'reajuste')?.text,
      });
    }
  }

  // 11. Regras por tipo de objeto
  categoryChecks(kind, norm, ctx).forEach(push);

  // 12. Termos vagos
  const vagueHits = VAGUE_TERMS.map((v) => ({ v, hit: find(text, norm, v.re) })).filter((x) => x.hit);
  if (vagueHits.length) {
    push({
      id: 'termos-vagos',
      severity: 'sugestao',
      basis: 'Art. 6º, XXIII, "a" e "d"; Súmula TCU 177',
      message: `Termos subjetivos dificultam o julgamento objetivo: ${vagueHits.map((x) => x.v.label).join(', ')}. Substitua por critérios mensuráveis.`,
      excerpt: vagueHits[0].hit!.excerpt,
    });
  }

  // Pontuação: cobertura ponderada menos penalidades por severidade
  const weight = (s: SectionCoverage) => (s.mandatory ? 2 : 1);
  const coverage = sections.reduce((a, s) => a + (s.present ? weight(s) : 0), 0) / sections.reduce((a, s) => a + weight(s), 0);
  const penalty = findings.reduce((a, f) => a + (f.severity === 'bloqueante' ? 8 : f.severity === 'alerta' ? 3 : 1), 0);
  const score = Math.max(0, Math.min(100, Math.round(coverage * 100 - penalty / 2)));

  const order = { bloqueante: 0, alerta: 1, sugestao: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    kind,
    score,
    approvable: !findings.some((f) => f.severity === 'bloqueante'),
    sections,
    findings,
    analyzedAt: now.toISOString(),
  };
}

function categoryChecks(kind: DocKind, norm: string, ctx: AnalysisContext): Finding[] {
  const out: Finding[] = [];
  const clause = (section: string, doc: DocKind = kind) => bestClause(ctx.category, doc, section)?.text;

  if (ctx.category === 'merenda') {
    if (kind === 'etp' && !/agricultura familiar/.test(norm)) {
      out.push({
        id: 'pnae-agricultura-familiar',
        severity: 'alerta',
        basis: 'Lei 11.947/2009, art. 14',
        message: 'O ETP de alimentação escolar não trata da parcela mínima destinada à agricultura familiar (chamada pública correlata).',
        suggestion: bestClause('merenda', 'etp', 'correlatas')?.text,
      });
    }
    if (!/\b(nutricionista|cardapio)\b/.test(norm)) {
      out.push({
        id: 'pnae-nutricionista',
        severity: 'sugestao',
        basis: 'Resolução CD/FNDE nº 06/2020',
        message: 'Vincule as especificações e quantidades aos cardápios elaborados pela nutricionista responsável técnica.',
      });
    }
  }
  if ((ctx.category === 'merenda' || ctx.category === 'medicamentos' || ctx.features.perishable) && kind === 'tr') {
    if (!/\bvalidade\b/.test(norm)) {
      out.push({
        id: 'validade',
        severity: 'alerta',
        basis: 'Art. 6º, XXIII, "d"',
        message: 'Para bens perecíveis, o TR deve fixar o prazo de validade mínimo no ato da entrega.',
        suggestion: clause('requisitos', 'tr'),
      });
    }
  }
  if ((ctx.category === 'limpeza' || ctx.features.dedicatedLabor) && kind === 'tr') {
    if (!/\b(conta[- ](deposito )?vinculada|fato gerador)\b/.test(norm)) {
      out.push({
        id: 'mao-de-obra-garantias',
        severity: 'alerta',
        basis: 'Art. 121, §3º',
        message:
          'Serviço com dedicação exclusiva de mão de obra sem mecanismo de proteção trabalhista (conta vinculada ou pagamento pelo fato gerador): risco de responsabilização subsidiária.',
        suggestion: bestClause('limpeza', 'tr', 'medicao')?.text,
      });
    }
  }
  if (ctx.category === 'ti' && kind === 'tr' && !/\b(lgpd|13\.?709|dados pessoais)\b/.test(norm)) {
    out.push({
      id: 'lgpd',
      severity: 'sugestao',
      basis: 'Lei 13.709/2018',
      message: 'Inclua obrigações de proteção de dados pessoais e comunicação de incidentes.',
      suggestion: bestClause('ti', 'tr', 'requisitos')?.text,
    });
  }
  if (ctx.category === 'engenharia' && kind === 'tr' && !/\b(art|rrt|responsavel tecnico)\b/.test(norm)) {
    out.push({
      id: 'engenharia-rt',
      severity: 'alerta',
      basis: 'Art. 67',
      message: 'Serviço de engenharia sem exigência de responsável técnico e ART/RRT.',
      suggestion: bestClause('engenharia', 'tr', 'requisitos')?.text,
    });
  }
  return out;
}

function lower(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}
