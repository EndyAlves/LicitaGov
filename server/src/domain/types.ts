/** Papéis de quem atua no processo dentro do órgão. */
export type Role =
  | 'requisitante' // setor que demanda a contratação
  | 'planejamento' // equipe de planejamento da contratação
  | 'agente' // agente de contratação / pregoeiro
  | 'juridico' // assessoria jurídica (art. 53)
  | 'fiscal' // fiscal do contrato (art. 117)
  | 'gestor'; // autoridade competente / gestor do contrato

export interface User {
  id: string;
  name: string;
  roles: Role[];
  unit: string;
}

export type Phase = 'planejamento' | 'externa' | 'contrato' | 'encerrado';

export type DocKind = 'etp' | 'tr';
export type DocStatus = 'rascunho' | 'em_analise_juridica' | 'aprovado' | 'devolvido';

export type Severity = 'bloqueante' | 'alerta' | 'sugestao';

export interface Finding {
  id: string;
  severity: Severity;
  /** Dispositivo legal ou normativo que embasa o apontamento. */
  basis: string;
  message: string;
  /** Sugestão de texto ou providência para sanar o ponto. */
  suggestion?: string;
  /** Trecho do rascunho que motivou o apontamento. */
  excerpt?: string;
}

export interface SectionCoverage {
  key: string;
  label: string;
  basis: string;
  mandatory: boolean;
  present: boolean;
}

export interface ComplianceReport {
  kind: DocKind;
  score: number;
  approvable: boolean;
  sections: SectionCoverage[];
  findings: Finding[];
  analyzedAt: string;
}

export interface ProcessDocument {
  kind: DocKind;
  text: string;
  status: DocStatus;
  version: number;
  updatedAt: string;
  updatedBy: string;
  report: ComplianceReport | null;
  reviewNote?: string;
}

export type ObjectCategory =
  | 'merenda'
  | 'expediente'
  | 'limpeza'
  | 'ti'
  | 'engenharia'
  | 'medicamentos'
  | 'outros';

export type ObjectNature = 'compra' | 'servico' | 'servico_continuo' | 'obra';

export type Modality = 'pregao' | 'concorrencia' | 'dispensa' | 'inexigibilidade';
export type Criterion = 'menor_preco' | 'maior_desconto' | 'tecnica_preco' | 'melhor_tecnica';

/** Características que alimentam a matriz de riscos e os modelos. */
export interface ProcessFeatures {
  perishable?: boolean;
  dedicatedLabor?: boolean;
  partialDeliveries?: boolean;
  fewSuppliers?: boolean;
  tightSchedule?: boolean;
  priceRegistration?: boolean;
  integratedContracting?: boolean;
  largeScale?: boolean;
}

export type PriceSource = 'painel' | 'contratacao_similar' | 'midia' | 'fornecedor' | 'nota_fiscal';

export interface PriceSample {
  id: string;
  source: PriceSource;
  supplier: string;
  unitPriceCents: number;
  date: string;
  reference?: string;
}

export interface PriceItem {
  id: string;
  description: string;
  unit: string;
  quantity: number;
  catalogCode?: string;
  samples: PriceSample[];
}

export interface PriceResearch {
  items: PriceItem[];
  criteria: { lowFactor: number; highFactor: number };
  updatedAt: string;
}

export interface Risk {
  id: string;
  title: string;
  description: string;
  probability: number;
  impact: number;
  level: 'baixo' | 'medio' | 'alto' | 'critico';
  allocation: 'contratante' | 'contratado' | 'compartilhado';
  mitigation: string;
  clause: string;
}

export interface Certificate {
  type: CertificateType;
  number?: string;
  validUntil: string;
}

export type CertificateType =
  | 'cnd_federal'
  | 'fgts'
  | 'cndt'
  | 'estadual'
  | 'municipal'
  | 'falencia';

export interface BalanceSheet {
  year: number;
  currentAssetsCents: number;
  longTermAssetsCents: number;
  totalAssetsCents: number;
  currentLiabilitiesCents: number;
  longTermLiabilitiesCents: number;
  equityCents: number;
}

export interface Bid {
  id: string;
  supplierName: string;
  cnpj: string;
  totalCents: number;
  items: { itemId: string; unitPriceCents: number; brand?: string }[];
  certificates: Certificate[];
  balance?: BalanceSheet;
  technicalCertificates?: number;
  qualification: QualificationResult | null;
  status: 'classificada' | 'habilitada' | 'inabilitada' | 'vencedora';
}

export interface Check {
  id: string;
  group: 'juridica' | 'fiscal' | 'economica' | 'tecnica' | 'sancoes' | 'proposta';
  label: string;
  status: 'ok' | 'falha' | 'atencao';
  detail: string;
  basis: string;
}

export interface QualificationResult {
  qualified: boolean;
  checks: Check[];
  indexes?: { lg: number; sg: number; lc: number };
  checkedAt: string;
}

export interface Occurrence {
  id: string;
  at: string;
  authorId: string;
  kind: 'entrega' | 'atraso' | 'nao_conformidade' | 'observacao';
  description: string;
  /** Percentual de glosa sobre a medição (instrumento de medição de resultado). */
  glosaPercent: number;
  photos: string[];
  location?: { lat: number; lng: number };
}

export interface ReceiptTerm {
  id: string;
  type: 'provisorio' | 'definitivo';
  at: string;
  authorId: string;
  periodLabel: string;
  measuredCents: number;
  glosaCents: number;
  payableCents: number;
  occurrenceIds: string[];
  text: string;
}

export interface Contract {
  number: string;
  kind: 'contrato' | 'ata';
  supplierName: string;
  cnpj: string;
  totalCents: number;
  signedAt: string;
  validUntil: string;
  fiscalId: string;
  text: string;
  occurrences: Occurrence[];
  receipts: ReceiptTerm[];
}

export interface AuditEntry {
  at: string;
  actorId: string | null;
  action: string;
  note?: string;
}

export interface Process {
  id: string;
  number: string;
  title: string;
  object: string;
  unit: string;
  category: ObjectCategory;
  nature: ObjectNature;
  modality: Modality;
  criterion: Criterion;
  estimatedCents: number | null;
  budgetLine: string;
  features: ProcessFeatures;
  phase: Phase;
  createdAt: string;
  documents: Record<DocKind, ProcessDocument>;
  prices: PriceResearch;
  risks: Risk[];
  edital: { text: string; generatedAt: string; checklist: { item: string; basis: string; ok: boolean }[] } | null;
  bids: Bid[];
  contract: Contract | null;
  audit: AuditEntry[];
}
