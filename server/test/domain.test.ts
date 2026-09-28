import { describe, expect, it } from 'vitest';
import { analyzeItem, priceReport } from '../src/domain/pricing.js';
import { isValidCnpj, qualify, DEFAULT_RULES } from '../src/domain/qualification.js';
import { riskLevel, suggestRisks } from '../src/domain/risks.js';
import type { Bid, PriceItem } from '../src/domain/types.js';
import { allCerts, healthyBalance, NOW } from './helpers.js';

const item = (samples: [PriceItem['samples'][number]['source'], number, string][]): PriceItem => ({
  id: 'i1',
  description: 'Arroz',
  unit: 'kg',
  quantity: 100,
  samples: samples.map(([source, unitPriceCents, date], i) => ({ id: `s${i}`, source, supplier: `F${i}`, unitPriceCents, date })),
});
const criteria = { lowFactor: 0.5, highFactor: 1.5 };

describe('pesquisa de preços', () => {
  it('discards outliers and uses the mean when prices are homogeneous', () => {
    const a = analyzeItem(
      item([
        ['painel', 1000, '2026-08-01'],
        ['painel', 1100, '2026-07-01'],
        ['contratacao_similar', 1050, '2026-06-01'],
        ['painel', 300, '2026-06-01'],
        ['painel', 5000, '2026-06-01'],
      ]),
      criteria,
      NOW,
    );
    expect(a.samples.map((s) => s.status)).toEqual(['valido', 'valido', 'valido', 'inexequivel', 'excessivo']);
    expect(a.method).toBe('media');
    expect(a.estimatedUnitCents).toBe(1050);
    expect(a.estimatedTotalCents).toBe(105_000);
    expect(a.warnings).toEqual([]);
  });

  it('uses the median when dispersion exceeds 25% and flags stale quotes', () => {
    const a = analyzeItem(
      item([
        ['painel', 1000, '2026-08-01'],
        ['painel', 1400, '2026-08-01'],
        ['painel', 700, '2026-08-01'],
        ['fornecedor', 1200, '2026-01-10'], // > 6 meses
      ]),
      criteria,
      NOW,
    );
    expect(a.samples[3].status).toBe('desatualizado');
    expect(a.cv).toBeGreaterThan(0.25);
    expect(a.method).toBe('mediana');
    expect(a.estimatedUnitCents).toBe(1000);
  });

  it('warns when fewer than 3 valid prices remain', () => {
    const r = priceReport({ items: [item([['painel', 1000, '2026-08-01']])], criteria, updatedAt: '' }, { processNumber: '1/2026', object: 'x', refDate: NOW });
    expect(r.complete).toBe(false);
    expect(r.items[0].warnings[0]).toMatch(/mínimo 3/);
    expect(r.text).toContain('VALOR TOTAL ESTIMADO');
  });
});

describe('habilitação', () => {
  const bid = (over: Partial<Bid> = {}): Bid => ({
    id: 'b1',
    supplierName: 'X',
    cnpj: '33.445.566/0001-86',
    totalCents: 100_000_00,
    items: [],
    certificates: allCerts('2027-01-01'),
    balance: healthyBalance,
    technicalCertificates: 1,
    qualification: null,
    status: 'classificada',
    ...over,
  });
  const rules = { ...DEFAULT_RULES, estimatedCents: 500_000_00 };

  it('validates CNPJ check digits', () => {
    expect(isValidCnpj('11.444.777/0001-61')).toBe(true);
    expect(isValidCnpj('11.444.777/0001-62')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
  });

  it('qualifies a regular supplier and computes LG, SG and LC', () => {
    const r = qualify(bid(), [], rules, NOW);
    expect(r.qualified).toBe(true);
    expect(r.indexes).toEqual({ lg: 1.83, sg: 2.5, lc: 2 });
  });

  it('fails on expired certificate and warns on one about to expire', () => {
    const certs = allCerts('2027-01-01').map((c) =>
      c.type === 'fgts' ? { ...c, validUntil: '2026-09-20' } : c.type === 'cndt' ? { ...c, validUntil: '2026-10-02' } : c,
    );
    const r = qualify(bid({ certificates: certs }), [], rules, NOW);
    expect(r.qualified).toBe(false);
    expect(r.checks.find((c) => c.id === 'cert-fgts')!.status).toBe('falha');
    expect(r.checks.find((c) => c.id === 'cert-cndt')!.status).toBe('atencao');
  });

  it('accepts low indexes when equity covers 10% of the estimate (art. 69, §4º)', () => {
    const weak = { ...healthyBalance, currentAssetsCents: 50_000_00, longTermAssetsCents: 0 };
    expect(qualify(bid({ balance: weak }), [], rules, NOW).checks.find((c) => c.id === 'indices')!.status).toBe('atencao');
    expect(qualify(bid({ balance: { ...weak, equityCents: 1_000_00 } }), [], rules, NOW).qualified).toBe(false);
  });

  it('blocks only active sanctions', () => {
    const active = { registry: 'CEIS' as const, sanction: 'Impedimento', organ: 'X', startDate: '2026-01-01', endDate: '2027-01-01' };
    const past = { ...active, startDate: '2024-01-01', endDate: '2025-01-01' };
    expect(qualify(bid(), [active], rules, NOW).qualified).toBe(false);
    expect(qualify(bid(), [past], rules, NOW).qualified).toBe(true);
  });
});

describe('matriz de riscos', () => {
  it('maps risks by object type and marks the matrix mandatory for large-scale contracts', () => {
    const merenda = suggestRisks({ category: 'merenda', nature: 'compra', features: {}, estimatedCents: null });
    expect(merenda.risks.map((r) => r.id)).toEqual(expect.arrayContaining(['pereciveis', 'atraso-entrega', 'deserta']));
    expect(merenda.mandatory).toBe(false);
    const obra = suggestRisks({ category: 'engenharia', nature: 'obra', features: { largeScale: true }, estimatedCents: null });
    expect(obra.mandatory).toBe(true);
    expect(obra.risks[0].level).toBe('alto');
    expect(riskLevel(4, 4)).toBe('critico');
    expect(riskLevel(1, 2)).toBe('baixo');
  });
});
