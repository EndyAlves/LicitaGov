import { describe, expect, it } from 'vitest';
import { analyzeDocument, type AnalysisContext } from '../src/legal/compliance.js';
import { ETP_REQUIREMENTS } from '../src/legal/requirements.js';
import { DRAFT_ETP_MERENDA, DRAFT_TR_MERENDA } from '../src/seed.js';

const ctx: AnalysisContext = { category: 'merenda', nature: 'compra', estimatedCents: null, features: { perishable: true } };
const ids = (r: ReturnType<typeof analyzeDocument>) => r.findings.map((f) => f.id);

describe('analyzeDocument — ETP', () => {
  it('blocks when the mandatory elements of art. 18, §2º are missing and points out the parcelamento gap', () => {
    const r = analyzeDocument('etp', DRAFT_ETP_MERENDA, ctx);
    expect(r.approvable).toBe(false);
    expect(ids(r)).toEqual(expect.arrayContaining(['falta-parcelamento', 'falta-conclusao', 'lei-revogada']));
    const parc = r.findings.find((f) => f.id === 'falta-parcelamento')!;
    expect(parc.severity).toBe('bloqueante');
    expect(parc.basis).toContain('Art. 18, §1º, VIII');
    expect(parc.suggestion).toMatch(/art\. 40/);
  });

  it('flags the revoked law with the excerpt that cites it', () => {
    const r = analyzeDocument('etp', DRAFT_ETP_MERENDA, ctx);
    expect(r.findings.find((f) => f.id === 'lei-revogada')!.excerpt).toContain('Lei 8.666/93');
  });

  it('warns about optional elements missing without justification, but only blocks on the mandatory ones', () => {
    const mandatory = ETP_REQUIREMENTS.filter((x) => x.mandatory).map((x) => x.key);
    expect(mandatory).toEqual(['necessidade', 'quantidades', 'valor', 'parcelamento', 'conclusao']);
    const text = [
      'Descrição da necessidade: atender o interesse público.',
      'Estimativa das quantidades com memória de cálculo pela série histórica.',
      'Estimativa do valor por pesquisa de preços.',
      'Parcelamento: adjudicação por item, pois amplia a competitividade.',
      'Posicionamento conclusivo: a contratação é viável.',
    ].join('\n\n');
    const r = analyzeDocument('etp', text, { ...ctx, category: 'outros', features: {} });
    expect(r.approvable).toBe(true);
    expect(r.findings.filter((f) => f.id.startsWith('falta-')).every((f) => f.severity === 'alerta')).toBe(true);
  });

  it('detects a parcelamento mentioned without a justification', () => {
    const r = analyzeDocument('etp', 'Parcelamento\nO objeto não será parcelado.', { ...ctx, category: 'outros' });
    expect(ids(r)).toContain('parcelamento-sem-justificativa');
  });

  it('requires ME/EPP exclusivity up to R$ 80 mil unless the text addresses it', () => {
    expect(ids(analyzeDocument('etp', 'texto', { ...ctx, estimatedCents: 50_000_00 }))).toContain('me-epp');
    expect(ids(analyzeDocument('etp', 'texto', { ...ctx, estimatedCents: 90_000_00 }))).not.toContain('me-epp');
    expect(ids(analyzeDocument('etp', 'Exclusiva para microempresas.', { ...ctx, estimatedCents: 50_000_00 }))).not.toContain('me-epp');
  });
});

describe('analyzeDocument — TR', () => {
  it('flags ambiguous payment, forbidden location requirement and brand without "equivalente"', () => {
    const r = analyzeDocument('tr', DRAFT_TR_MERENDA, ctx);
    const pay = r.findings.find((f) => f.id === 'pagamento-ambiguo')!;
    expect(pay.severity).toBe('bloqueante');
    expect(pay.message).toMatch(/medição e pagamento está ambíguo/);
    expect(pay.excerpt).toContain('oportunamente');
    expect(ids(r)).toEqual(expect.arrayContaining(['restricao-sede', 'marca', 'reajuste', 'validade', 'garantia-produto']));
  });

  it('accepts brand as reference when "ou equivalente" is present, and a payment term in days', () => {
    const r = analyzeDocument(
      'tr',
      'Marca de referência X, ou equivalente.\n\nCritérios de medição: por unidade entregue. O pagamento será feito em até 10 (dez) dias úteis.',
      { ...ctx, category: 'outros', features: {} },
    );
    expect(ids(r)).not.toContain('marca');
    expect(ids(r)).not.toContain('pagamento-ambiguo');
    expect(ids(r)).not.toContain('pagamento-sem-prazo');
  });

  it('requires labor safeguards for dedicated-labor services', () => {
    const r = analyzeDocument('tr', 'Serviço de limpeza.', { category: 'limpeza', nature: 'servico_continuo', estimatedCents: null, features: {} });
    expect(ids(r)).toContain('mao-de-obra-garantias');
  });

  it('sorts findings by severity and gives a lower score to worse drafts', () => {
    const bad = analyzeDocument('tr', DRAFT_TR_MERENDA, ctx);
    const order = bad.findings.map((f) => f.severity);
    expect(order.indexOf('sugestao')).toBeGreaterThan(order.lastIndexOf('bloqueante'));
    const good = analyzeDocument('tr', DRAFT_TR_MERENDA + '\nFundamentação: ETP. Descrição da solução como um todo. Requisitos da contratação.', ctx);
    expect(good.score).toBeGreaterThan(bad.score);
  });
});
