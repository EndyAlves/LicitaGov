import type {
  BalanceSheet,
  Certificate,
  ComplianceReport,
  DocKind,
  Occurrence,
  PriceSample,
  Process,
  Risk,
  User,
} from '../../../server/src/domain/types';

export type * from '../../../server/src/domain/types';

export interface Clause {
  id: string;
  category: string;
  doc: string;
  section: string;
  title: string;
  text: string;
  basis: string;
  source: string;
}

export interface Requirement {
  key: string;
  label: string;
  basis: string;
  mandatory: boolean;
  hint: string;
}

export interface Catalog {
  categories: Record<Process['category'], string>;
  requirements: Record<DocKind, Requirement[]>;
}

export interface AdjustResult {
  text: string;
  engine: 'regras' | 'claude';
  changes: string[];
  before: number;
  after: number;
  report: ComplianceReport;
}

export interface SampleAnalysis extends PriceSample {
  status: 'valido' | 'inexequivel' | 'excessivo' | 'desatualizado';
  reason?: string;
}

export interface PriceReport {
  items: {
    item: Process['prices']['items'][number];
    samples: SampleAnalysis[];
    valid: number;
    meanCents: number | null;
    medianCents: number | null;
    minCents: number | null;
    cv: number | null;
    method: 'media' | 'mediana' | null;
    estimatedUnitCents: number | null;
    estimatedTotalCents: number | null;
    warnings: string[];
  }[];
  totalCents: number;
  complete: boolean;
  text: string;
}

export interface Dashboard {
  total: number;
  byPhase: Record<Process['phase'], number>;
  inReview: number;
  avgScore: number | null;
  estimatedTotalCents: number;
  blocking: { processId: string; number: string; title: string; doc: DocKind; message: string }[];
  topIssues: { message: string; count: number }[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

let currentUser: string | null = null;
export const setApiUser = (id: string | null) => {
  currentUser = id;
};

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (currentUser) headers['x-user-id'] = currentUser;
  const res = await fetch(`/api${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.code ?? 'HTTP', body.message ?? res.statusText, body.details);
  return body as T;
}

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) => call<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => call<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const P = (id: string) => `/processes/${encodeURIComponent(id)}`;

export const api = {
  health: () => call<{ ok: boolean; adjuster: 'regras' | 'claude' }>('/health'),
  users: () => call<User[]>('/users'),
  catalog: () => call<Catalog>('/catalog'),
  clauses: (q: { category?: string; doc?: string; section?: string; q?: string }) =>
    call<Clause[]>(`/clauses?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}`),
  dashboard: () => call<Dashboard>('/dashboard'),
  processes: () => call<Process[]>('/processes'),
  process: (id: string) => call<Process>(P(id)),
  create: (body: Record<string, unknown>) => post<Process>('/processes', body),

  saveDoc: (id: string, kind: DocKind, text: string) => put<Process>(`${P(id)}/documents/${kind}`, { text }),
  adjust: (id: string, kind: DocKind) => post<AdjustResult>(`${P(id)}/documents/${kind}/adjust`),
  submit: (id: string, kind: DocKind) => post<Process>(`${P(id)}/documents/${kind}/submit`),
  review: (id: string, kind: DocKind, decision: 'approve' | 'return', note?: string) =>
    post<Process>(`${P(id)}/documents/${kind}/review`, { decision, note }),

  setItems: (id: string, items: { description: string; unit: string; quantity: number; catalogCode?: string }[]) =>
    put<Process>(`${P(id)}/prices/items`, { items }),
  addSample: (id: string, itemId: string, s: Omit<PriceSample, 'id'>) => post<Process>(`${P(id)}/prices/items/${itemId}/samples`, s),
  removeSample: (id: string, itemId: string, sampleId: string) =>
    call<Process>(`${P(id)}/prices/items/${itemId}/samples/${sampleId}`, { method: 'DELETE' }),
  autoPrices: (id: string) => post<{ process: Process; imported: number; errors: string[] }>(`${P(id)}/prices/auto`),
  priceReport: (id: string) => call<PriceReport>(`${P(id)}/prices/report`),

  suggestRisks: (id: string) => post<{ process: Process; mandatory: boolean; basis: string }>(`${P(id)}/risks/suggest`),
  updateRisk: (id: string, riskId: string, body: Partial<Risk>) => patch<Process>(`${P(id)}/risks/${riskId}`, body),
  edital: (id: string) => post<Process>(`${P(id)}/edital`),

  addBid: (
    id: string,
    body: { supplierName: string; cnpj: string; items: { itemId: string; unitPriceCents: number; brand?: string }[]; certificates: Certificate[]; balance?: BalanceSheet; technicalCertificates: number },
  ) => post<Process>(`${P(id)}/bids`, body),
  qualify: (id: string, bidId: string) => post<Process>(`${P(id)}/bids/${bidId}/qualify`),
  award: (id: string, bidId: string) => post<Process>(`${P(id)}/bids/${bidId}/award`),

  contract: (id: string, fiscalId: string, months: number) => post<Process>(`${P(id)}/contract`, { fiscalId, months }),
  occurrence: (id: string, body: Omit<Occurrence, 'id' | 'at' | 'authorId'>) => post<Process>(`${P(id)}/contract/occurrences`, body),
  receipt: (id: string, body: { type: 'provisorio' | 'definitivo'; periodLabel: string; measuredCents: number }) =>
    post<Process>(`${P(id)}/contract/receipts`, body),
};
