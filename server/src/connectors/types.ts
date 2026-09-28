/** Registro de sanção encontrado em um cadastro público. */
export interface Sanction {
  registry: 'CEIS' | 'CNEP' | 'TCU' | 'CNIA';
  sanction: string;
  organ: string;
  startDate: string;
  endDate: string | null;
}

/** Consulta de impedimentos: CEIS/CNEP (CGU) e inidôneos do TCU. */
export interface SanctionsConnector {
  readonly name: string;
  lookup(cnpj: string): Promise<Sanction[]>;
}

export interface MarketPrice {
  supplier: string;
  unitPriceCents: number;
  date: string;
  reference: string;
}

/** Fonte automática de preços (Painel de Preços / dados abertos do Compras.gov.br). */
export interface PriceConnector {
  readonly name: string;
  search(query: { catalogCode?: string; description: string }): Promise<MarketPrice[]>;
}
