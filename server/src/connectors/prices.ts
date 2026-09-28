import type { MarketPrice, PriceConnector } from './types.js';

/**
 * API de dados abertos do Compras.gov.br — módulo de pesquisa de preços
 * (a mesma base do Painel de Preços). Consulta por código CATMAT.
 * https://dadosabertos.compras.gov.br/swagger-ui/index.html
 */
export class ComprasGovPriceConnector implements PriceConnector {
  readonly name = 'Painel de Preços (Compras.gov.br)';

  constructor(
    private readonly baseUrl = 'https://dadosabertos.compras.gov.br',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async search(query: { catalogCode?: string; description: string }): Promise<MarketPrice[]> {
    if (!query.catalogCode) return [];
    const params = new URLSearchParams({ pagina: '1', tamanhoPagina: '20', codigoItemCatalogo: query.catalogCode });
    const res = await this.fetchImpl(`${this.baseUrl}/modulo-pesquisa-preco/1_consultarMaterial?${params}`, {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${this.name}: HTTP ${res.status}`);
    const body = (await res.json()) as { resultado?: Record<string, unknown>[] };
    return (body.resultado ?? [])
      .map((r) => ({
        supplier: String(r.nomeFornecedor ?? r.nomeUasg ?? 'Órgão público'),
        unitPriceCents: Math.round(Number(r.precoUnitario ?? 0) * 100),
        date: String(r.dataResultado ?? r.dataCompra ?? ''),
        reference: `UASG ${r.codigoUasg ?? '?'} · compra ${r.idCompra ?? '?'}`,
      }))
      .filter((p) => p.unitPriceCents > 0 && p.date);
  }
}

/**
 * Fonte de demonstração: gera preços determinísticos em torno de um valor de
 * referência por descrição, incluindo um valor inexequível e um excessivo para
 * exercitar o tratamento estatístico.
 */
export class MockPriceConnector implements PriceConnector {
  readonly name = 'Painel de Preços (demonstração)';

  constructor(
    private readonly references: Record<string, number> = DEMO_REFERENCES,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async search(query: { catalogCode?: string; description: string }): Promise<MarketPrice[]> {
    const key = Object.keys(this.references).find((k) => query.description.toLowerCase().includes(k));
    const base = key ? this.references[key] : 1000;
    const factors = [0.94, 1.02, 1.07, 0.98, 0.35, 2.1];
    const organs = ['Pref. Mun. de Campinas', 'Governo do Estado de MG', 'Pref. Mun. de Recife', 'IFSP', 'Pref. Mun. de Sobral', 'Pref. Mun. de Canoas'];
    return factors.map((f, i) => {
      const d = new Date(this.now());
      d.setMonth(d.getMonth() - (i + 1));
      return {
        supplier: organs[i],
        unitPriceCents: Math.round(base * f),
        date: d.toISOString().slice(0, 10),
        reference: `Ata/contrato de referência nº ${100 + i}/2026`,
      };
    });
  }
}

const DEMO_REFERENCES: Record<string, number> = {
  arroz: 2890,
  feijao: 849,
  leite: 529,
  banana: 599,
  frango: 1690,
  papel: 2450,
  caneta: 129,
  toner: 18900,
};
