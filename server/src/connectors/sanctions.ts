import type { Sanction, SanctionsConnector } from './types.js';

/**
 * Portal da Transparência (CGU): CEIS e CNEP. Requer uma chave gratuita,
 * enviada no cabeçalho `chave-api-dados`.
 * https://api.portaldatransparencia.gov.br/swagger-ui/index.html
 */
export class PortalTransparenciaConnector implements SanctionsConnector {
  readonly name = 'Portal da Transparência (CEIS/CNEP)';

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.portaldatransparencia.gov.br/api-de-dados',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async lookup(cnpj: string): Promise<Sanction[]> {
    const digits = cnpj.replace(/\D/g, '');
    const [ceis, cnep] = await Promise.all([
      this.get('ceis', { cnpjSancionado: digits, pagina: '1' }),
      this.get('cnep', { cnpjSancionado: digits, pagina: '1' }),
    ]);
    return [...ceis.map((r) => toSanction('CEIS', r)), ...cnep.map((r) => toSanction('CNEP', r))];
  }

  private async get(path: string, params: Record<string, string>): Promise<Record<string, unknown>[]> {
    const url = `${this.baseUrl}/${path}?${new URLSearchParams(params)}`;
    const res = await this.fetchImpl(url, { headers: { 'chave-api-dados': this.apiKey, accept: 'application/json' } });
    if (!res.ok) throw new Error(`${this.name}: HTTP ${res.status} em /${path}`);
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  }
}

function toSanction(registry: 'CEIS' | 'CNEP', r: Record<string, unknown>): Sanction {
  const tipo = r.tipoSancao as { descricaoResumida?: string } | undefined;
  const orgao = r.orgaoSancionador as { nome?: string } | undefined;
  return {
    registry,
    sanction: tipo?.descricaoResumida ?? 'Sanção',
    organ: orgao?.nome ?? '—',
    startDate: String(r.dataInicioSancao ?? ''),
    endDate: r.dataFimSancao ? String(r.dataFimSancao) : null,
  };
}

/** Base local para demonstração e testes; substitui a consulta real quando não há chave configurada. */
export class MockSanctionsConnector implements SanctionsConnector {
  readonly name = 'Cadastros de sanções (demonstração)';

  constructor(private readonly records: Record<string, Sanction[]> = DEMO_SANCTIONS) {}

  async lookup(cnpj: string): Promise<Sanction[]> {
    return this.records[cnpj.replace(/\D/g, '')] ?? [];
  }
}

export const DEMO_SANCTIONS: Record<string, Sanction[]> = {
  // CNPJ fictício (dígitos verificadores válidos) usado no seed como licitante impedida
  '11444777000161': [
    {
      registry: 'CEIS',
      sanction: 'Impedimento de licitar e contratar (art. 156, III, Lei 14.133)',
      organ: 'Prefeitura Municipal de Exemplo',
      startDate: '2026-02-10',
      endDate: '2027-02-10',
    },
  ],
};

/** Uma sanção só impede a contratação enquanto estiver vigente. */
export function isActive(s: Sanction, at: Date): boolean {
  const start = new Date(s.startDate);
  const end = s.endDate ? new Date(s.endDate) : null;
  return start <= at && (!end || end >= at);
}
