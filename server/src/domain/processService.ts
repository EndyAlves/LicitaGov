import type { Adjuster } from '../ai/adjuster.js';
import type { PriceConnector, SanctionsConnector } from '../connectors/types.js';
import { analyzeDocument } from '../legal/compliance.js';
import type { MemoryStore } from '../store/memoryStore.js';
import { buildReceipt, generateContract, generateEdital } from './documents.js';
import { priceReport, type PriceReport } from './pricing.js';
import { DEFAULT_RULES, isValidCnpj, qualify } from './qualification.js';
import { riskLevel, suggestRisks } from './risks.js';
import type {
  Bid,
  Certificate,
  BalanceSheet,
  DocKind,
  Occurrence,
  PriceItem,
  PriceSample,
  Process,
  ProcessFeatures,
  ReceiptTerm,
  Risk,
  Role,
  User,
} from './types.js';

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Quem pode fazer o quê. O jurídico só aprova; quem redige não aprova o próprio documento. */
const PERMISSIONS = {
  create: ['requisitante', 'planejamento', 'agente'],
  editDocs: ['requisitante', 'planejamento'],
  submit: ['requisitante', 'planejamento'],
  review: ['juridico'],
  prices: ['planejamento', 'agente'],
  risks: ['planejamento', 'agente'],
  edital: ['agente'],
  bids: ['agente'],
  contract: ['gestor', 'agente'],
  fiscal: ['fiscal'],
} satisfies Record<string, Role[]>;

type Action = keyof typeof PERMISSIONS;

export interface CreateProcessInput {
  title: string;
  object: string;
  unit: string;
  category: Process['category'];
  nature: Process['nature'];
  modality?: Process['modality'];
  criterion?: Process['criterion'];
  budgetLine?: string;
  features?: ProcessFeatures;
  etp?: string;
  tr?: string;
}

export interface ServiceDeps {
  store: MemoryStore;
  prices: PriceConnector;
  sanctions: SanctionsConnector;
  adjuster: Adjuster;
  org?: string;
  now?: () => Date;
}

export class ProcessService {
  readonly store: MemoryStore;
  readonly org: string;
  private readonly now: () => Date;

  constructor(private readonly deps: ServiceDeps) {
    this.store = deps.store;
    this.org = deps.org ?? 'PREFEITURA MUNICIPAL';
    this.now = deps.now ?? (() => new Date());
  }

  // ---------- helpers ----------

  user(id: string): User {
    const u = this.store.getUser(id);
    if (!u) throw new DomainError('UNAUTHENTICATED', 'Usuário inválido.', 401);
    return u;
  }

  private authorize(userId: string, action: Action): User {
    const u = this.user(userId);
    const allowed: Role[] = PERMISSIONS[action];
    if (!u.roles.some((r) => allowed.includes(r))) {
      throw new DomainError('FORBIDDEN', `Ação restrita a: ${allowed.join(', ')}.`, 403);
    }
    return u;
  }

  get(id: string): Process {
    const p = this.store.getProcess(id);
    if (!p) throw new DomainError('NOT_FOUND', 'Processo não encontrado.', 404);
    return p;
  }

  private log(p: Process, actorId: string | null, action: string, note?: string) {
    p.audit.push({ at: this.now().toISOString(), actorId, action, note });
    this.store.saveProcess(p);
  }

  private ctx(p: Process) {
    return { category: p.category, nature: p.nature, estimatedCents: p.estimatedCents, features: p.features, prices: p.prices };
  }

  private requirePhase(p: Process, ...phases: Process['phase'][]) {
    if (!phases.includes(p.phase)) {
      throw new DomainError('INVALID_PHASE', `Operação indisponível na fase "${p.phase}".`, 409);
    }
  }

  list(): Process[] {
    return this.store.listProcesses().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ---------- fase preparatória ----------

  create(userId: string, input: CreateProcessInput): Process {
    this.authorize(userId, 'create');
    if (!input.title?.trim() || !input.object?.trim()) {
      throw new DomainError('INVALID_PROCESS', 'Informe título e objeto.');
    }
    const at = this.now().toISOString();
    const id = this.store.nextId('PROC');
    const doc = (kind: DocKind, text = '') => ({ kind, text, status: 'rascunho' as const, version: 1, updatedAt: at, updatedBy: userId, report: null });
    const p: Process = {
      id,
      number: `${id.split('-')[1]}/${this.now().getFullYear()}`,
      title: input.title.trim(),
      object: input.object.trim(),
      unit: input.unit,
      category: input.category,
      nature: input.nature,
      modality: input.modality ?? 'pregao',
      criterion: input.criterion ?? 'menor_preco',
      estimatedCents: null,
      budgetLine: input.budgetLine ?? '',
      features: input.features ?? {},
      phase: 'planejamento',
      createdAt: at,
      documents: { etp: doc('etp', input.etp), tr: doc('tr', input.tr) },
      prices: { items: [], criteria: { lowFactor: 0.5, highFactor: 1.5 }, updatedAt: at },
      risks: [],
      edital: null,
      bids: [],
      contract: null,
      audit: [],
    };
    for (const kind of ['etp', 'tr'] as const) {
      if (p.documents[kind].text) p.documents[kind].report = analyzeDocument(kind, p.documents[kind].text, this.ctx(p), this.now());
    }
    this.log(p, userId, 'Processo aberto');
    return p;
  }

  updateDocument(id: string, kind: DocKind, userId: string, text: string): Process {
    this.authorize(userId, 'editDocs');
    const p = this.get(id);
    this.requirePhase(p, 'planejamento');
    const d = p.documents[kind];
    if (d.status === 'aprovado') throw new DomainError('LOCKED', 'Documento aprovado não pode ser alterado.', 409);
    Object.assign(d, {
      text,
      version: d.version + 1,
      updatedAt: this.now().toISOString(),
      updatedBy: userId,
      status: 'rascunho',
      report: analyzeDocument(kind, text, this.ctx(p), this.now()),
    });
    this.log(p, userId, `${kind.toUpperCase()} atualizado (v${d.version})`, `Conformidade ${d.report!.score}/100`);
    return p;
  }

  analyze(id: string, kind: DocKind) {
    const p = this.get(id);
    const d = p.documents[kind];
    d.report = analyzeDocument(kind, d.text, this.ctx(p), this.now());
    this.store.saveProcess(p);
    return d.report;
  }

  /** Devolve uma versão ajustada do rascunho sem salvá-la; o servidor revisa e decide. */
  async adjust(id: string, kind: DocKind, userId: string) {
    this.authorize(userId, 'editDocs');
    const p = this.get(id);
    const report = this.analyze(id, kind);
    let result;
    try {
      result = await this.deps.adjuster.adjust({ kind, text: p.documents[kind].text, report, category: p.category, object: p.object });
    } catch (e) {
      throw new DomainError('ADJUST_FAILED', `Falha no ajuste automático: ${(e as Error).message}`, 502);
    }
    const after = analyzeDocument(kind, result.text, this.ctx(p), this.now());
    return { ...result, before: report.score, after: after.score, report: after };
  }

  submit(id: string, kind: DocKind, userId: string): Process {
    this.authorize(userId, 'submit');
    const p = this.get(id);
    this.requirePhase(p, 'planejamento');
    const report = this.analyze(id, kind);
    if (!report.approvable) {
      throw new DomainError(
        'BLOCKING_FINDINGS',
        `O ${kind.toUpperCase()} tem ${report.findings.filter((f) => f.severity === 'bloqueante').length} pendência(s) bloqueante(s).`,
        422,
        report,
      );
    }
    if (kind === 'tr' && p.documents.etp.status !== 'aprovado') {
      throw new DomainError('ETP_REQUIRED', 'O TR só segue para o jurídico depois do ETP aprovado.', 409);
    }
    p.documents[kind].status = 'em_analise_juridica';
    this.log(p, userId, `${kind.toUpperCase()} enviado ao jurídico`);
    return p;
  }

  review(id: string, kind: DocKind, userId: string, decision: 'approve' | 'return', note?: string): Process {
    this.authorize(userId, 'review');
    const p = this.get(id);
    const d = p.documents[kind];
    if (d.status !== 'em_analise_juridica') throw new DomainError('NOT_IN_REVIEW', 'Documento não está em análise jurídica.', 409);
    if (decision === 'return' && !note?.trim()) throw new DomainError('NOTE_REQUIRED', 'Informe o motivo da devolução.');
    d.status = decision === 'approve' ? 'aprovado' : 'devolvido';
    d.reviewNote = note;
    this.log(p, userId, `${kind.toUpperCase()} ${decision === 'approve' ? 'aprovado' : 'devolvido'} pelo jurídico`, note);
    return p;
  }

  // ---------- pesquisa de preços ----------

  setPriceItems(id: string, userId: string, items: Omit<PriceItem, 'samples' | 'id'>[]): Process {
    this.authorize(userId, 'prices');
    const p = this.get(id);
    this.requirePhase(p, 'planejamento');
    p.prices.items = items.map((i) => {
      const existing = p.prices.items.find((x) => x.description === i.description);
      return { id: existing?.id ?? this.store.nextId('ITEM'), samples: existing?.samples ?? [], ...i };
    });
    this.refreshEstimate(p);
    this.log(p, userId, 'Itens da pesquisa de preços atualizados', `${items.length} item(ns)`);
    return p;
  }

  addSample(id: string, itemId: string, userId: string, sample: Omit<PriceSample, 'id'>): Process {
    this.authorize(userId, 'prices');
    const p = this.get(id);
    const item = p.prices.items.find((i) => i.id === itemId);
    if (!item) throw new DomainError('NOT_FOUND', 'Item não encontrado.', 404);
    if (!(sample.unitPriceCents > 0)) throw new DomainError('INVALID_PRICE', 'Preço unitário deve ser positivo.');
    item.samples.push({ id: this.store.nextId('PR'), ...sample });
    this.refreshEstimate(p);
    this.log(p, userId, `Preço incluído: ${item.description}`, sample.supplier);
    return p;
  }

  removeSample(id: string, itemId: string, sampleId: string, userId: string): Process {
    this.authorize(userId, 'prices');
    const p = this.get(id);
    const item = p.prices.items.find((i) => i.id === itemId);
    if (!item) throw new DomainError('NOT_FOUND', 'Item não encontrado.', 404);
    item.samples = item.samples.filter((s) => s.id !== sampleId);
    this.refreshEstimate(p);
    this.store.saveProcess(p);
    return p;
  }

  /** Busca preços nas fontes automáticas para cada item e recalcula o valor estimado. */
  async autoResearch(id: string, userId: string): Promise<{ process: Process; imported: number; errors: string[] }> {
    this.authorize(userId, 'prices');
    const p = this.get(id);
    let imported = 0;
    const errors: string[] = [];
    for (const item of p.prices.items) {
      try {
        const found = await this.deps.prices.search({ catalogCode: item.catalogCode, description: item.description });
        for (const f of found) {
          if (item.samples.some((s) => s.source === 'painel' && s.reference === f.reference && s.unitPriceCents === f.unitPriceCents)) continue;
          item.samples.push({ id: this.store.nextId('PR'), source: 'painel', supplier: f.supplier, unitPriceCents: f.unitPriceCents, date: f.date, reference: f.reference });
          imported += 1;
        }
      } catch (e) {
        errors.push(`${item.description}: ${(e as Error).message}`);
      }
    }
    this.refreshEstimate(p);
    this.log(p, userId, `Pesquisa automática (${this.deps.prices.name})`, `${imported} preço(s) importado(s)`);
    return { process: p, imported, errors };
  }

  priceReport(id: string): PriceReport {
    const p = this.get(id);
    return priceReport(p.prices, { processNumber: p.number, object: p.object, refDate: this.now() });
  }

  private refreshEstimate(p: Process) {
    p.prices.updatedAt = this.now().toISOString();
    const r = priceReport(p.prices, { processNumber: p.number, object: p.object, refDate: this.now() });
    p.estimatedCents = r.totalCents || null;
  }

  // ---------- matriz de riscos ----------

  suggestRisks(id: string, userId: string) {
    this.authorize(userId, 'risks');
    const p = this.get(id);
    const result = suggestRisks(p);
    p.risks = result.risks;
    this.log(p, userId, 'Matriz de riscos gerada', `${result.risks.length} risco(s)`);
    return { process: p, mandatory: result.mandatory, basis: result.basis };
  }

  updateRisk(id: string, riskId: string, userId: string, patch: Partial<Pick<Risk, 'probability' | 'impact' | 'allocation' | 'mitigation' | 'clause'>>): Process {
    this.authorize(userId, 'risks');
    const p = this.get(id);
    const r = p.risks.find((x) => x.id === riskId);
    if (!r) throw new DomainError('NOT_FOUND', 'Risco não encontrado.', 404);
    for (const k of ['probability', 'impact'] as const) {
      if (patch[k] !== undefined && (!Number.isInteger(patch[k]) || patch[k]! < 1 || patch[k]! > 5)) {
        throw new DomainError('INVALID_RISK', 'Probabilidade e impacto vão de 1 a 5.');
      }
    }
    Object.assign(r, patch);
    r.level = riskLevel(r.probability, r.impact);
    this.store.saveProcess(p);
    return p;
  }

  // ---------- fase externa ----------

  generateEdital(id: string, userId: string): Process {
    this.authorize(userId, 'edital');
    const p = this.get(id);
    this.requirePhase(p, 'planejamento', 'externa');
    const missing: string[] = [];
    if (p.documents.etp.status !== 'aprovado') missing.push('ETP aprovado pelo jurídico');
    if (p.documents.tr.status !== 'aprovado') missing.push('TR aprovado pelo jurídico');
    if (!p.estimatedCents) missing.push('valor estimado pela pesquisa de preços');
    if ((p.features.largeScale || p.features.integratedContracting) && !p.risks.length) missing.push('matriz de riscos (obrigatória)');
    if (missing.length) {
      throw new DomainError('PREREQUISITES', `Para gerar o edital falta: ${missing.join('; ')}.`, 409, missing);
    }
    p.edital = generateEdital(p, p.estimatedCents!, this.org);
    p.phase = 'externa';
    this.log(p, userId, 'Minuta do edital gerada; processo na fase externa');
    return p;
  }

  addBid(
    id: string,
    userId: string,
    input: { supplierName: string; cnpj: string; items: Bid['items']; certificates: Certificate[]; balance?: BalanceSheet; technicalCertificates?: number },
  ): Process {
    this.authorize(userId, 'bids');
    const p = this.get(id);
    this.requirePhase(p, 'externa');
    if (!input.supplierName?.trim()) throw new DomainError('INVALID_BID', 'Informe o fornecedor.');
    if (!isValidCnpj(input.cnpj)) throw new DomainError('INVALID_CNPJ', 'CNPJ inválido.');
    const totalCents = input.items.reduce((a, it) => a + it.unitPriceCents * (p.prices.items.find((i) => i.id === it.itemId)?.quantity ?? 0), 0);
    p.bids.push({ id: this.store.nextId('BID'), ...input, totalCents, qualification: null, status: 'classificada' });
    p.bids.sort((a, b) => a.totalCents - b.totalCents);
    this.log(p, userId, `Proposta registrada: ${input.supplierName}`);
    return p;
  }

  async qualifyBid(id: string, bidId: string, userId: string): Promise<Process> {
    this.authorize(userId, 'bids');
    const p = this.get(id);
    const bid = p.bids.find((b) => b.id === bidId);
    if (!bid) throw new DomainError('NOT_FOUND', 'Proposta não encontrada.', 404);
    let sanctions;
    try {
      sanctions = await this.deps.sanctions.lookup(bid.cnpj);
    } catch (e) {
      throw new DomainError('SANCTIONS_UNAVAILABLE', `Não foi possível consultar os cadastros de sanções: ${(e as Error).message}`, 502);
    }
    bid.qualification = qualify(bid, sanctions, { ...DEFAULT_RULES, estimatedCents: p.estimatedCents }, this.now());
    const exceeds = p.estimatedCents !== null && bid.totalCents > p.estimatedCents;
    if (exceeds) {
      bid.qualification.checks.unshift({
        id: 'preco',
        group: 'proposta',
        label: 'Proposta dentro do valor estimado',
        status: 'falha',
        detail: 'Valor acima do orçamento estimado: negocie antes de aceitar (art. 61).',
        basis: 'Art. 59, III; art. 61',
      });
      bid.qualification.qualified = false;
    }
    bid.status = bid.qualification.qualified ? 'habilitada' : 'inabilitada';
    this.log(p, userId, `Habilitação analisada: ${bid.supplierName}`, bid.qualification.qualified ? 'habilitada' : 'inabilitada');
    return p;
  }

  award(id: string, bidId: string, userId: string): Process {
    this.authorize(userId, 'bids');
    const p = this.get(id);
    this.requirePhase(p, 'externa');
    const bid = p.bids.find((b) => b.id === bidId);
    if (!bid) throw new DomainError('NOT_FOUND', 'Proposta não encontrada.', 404);
    if (bid.status !== 'habilitada') throw new DomainError('NOT_QUALIFIED', 'Só é possível adjudicar a proposta habilitada.', 409);
    const better = p.bids.find((b) => b.totalCents < bid.totalCents && b.status !== 'inabilitada');
    if (better) {
      throw new DomainError('ORDER', `Analise antes a proposta mais bem classificada (${better.supplierName}).`, 409);
    }
    p.bids.forEach((b) => b.status === 'vencedora' && (b.status = 'habilitada'));
    bid.status = 'vencedora';
    this.log(p, userId, `Objeto adjudicado a ${bid.supplierName}`);
    return p;
  }

  // ---------- contrato ----------

  createContract(id: string, userId: string, input: { months?: number; fiscalId: string }): Process {
    this.authorize(userId, 'contract');
    const p = this.get(id);
    this.requirePhase(p, 'externa');
    const bid = p.bids.find((b) => b.status === 'vencedora');
    if (!bid) throw new DomainError('NO_WINNER', 'Adjudique uma proposta antes de gerar o contrato.', 409);
    const fiscal = this.store.getUser(input.fiscalId);
    if (!fiscal?.roles.includes('fiscal')) throw new DomainError('INVALID_FISCAL', 'Designe um servidor com papel de fiscal.');
    const months = input.months ?? 12;
    const signedAt = this.now().toISOString();
    const number = `${this.store.nextId(p.features.priceRegistration ? 'ARP' : 'CT').split('-')[1]}/${this.now().getFullYear()}`;
    const until = new Date(signedAt);
    until.setMonth(until.getMonth() + months);
    p.contract = {
      number,
      kind: p.features.priceRegistration ? 'ata' : 'contrato',
      supplierName: bid.supplierName,
      cnpj: bid.cnpj,
      totalCents: bid.totalCents,
      signedAt,
      validUntil: until.toISOString(),
      fiscalId: fiscal.id,
      text: generateContract(p, bid, { org: this.org, number, signedAt, months, fiscalName: fiscal.name }),
      occurrences: [],
      receipts: [],
    };
    p.phase = 'contrato';
    this.log(p, userId, `${p.contract.kind === 'ata' ? 'Ata de registro de preços' : 'Contrato'} ${number} gerado`, `Fiscal: ${fiscal.name}`);
    return p;
  }

  addOccurrence(id: string, userId: string, input: Omit<Occurrence, 'id' | 'at' | 'authorId'>): Process {
    this.authorize(userId, 'fiscal');
    const p = this.get(id);
    this.requirePhase(p, 'contrato');
    const c = p.contract!;
    if (c.fiscalId !== userId) throw new DomainError('FORBIDDEN', 'Somente o fiscal designado registra ocorrências.', 403);
    if (!input.description?.trim()) throw new DomainError('INVALID_OCCURRENCE', 'Descreva a ocorrência.');
    if (!(input.glosaPercent >= 0 && input.glosaPercent <= 100)) throw new DomainError('INVALID_OCCURRENCE', 'Glosa entre 0% e 100%.');
    if (input.photos.length > 6) throw new DomainError('INVALID_OCCURRENCE', 'Máximo de 6 fotos por ocorrência.');
    c.occurrences.push({ id: this.store.nextId('OC'), at: this.now().toISOString(), authorId: userId, ...input });
    this.log(p, userId, `Ocorrência registrada (${input.kind})`, input.description);
    return p;
  }

  issueReceipt(id: string, userId: string, input: { type: ReceiptTerm['type']; periodLabel: string; measuredCents: number }): Process {
    const u = this.authorize(userId, 'fiscal');
    const p = this.get(id);
    this.requirePhase(p, 'contrato');
    const c = p.contract!;
    if (c.fiscalId !== userId) throw new DomainError('FORBIDDEN', 'Somente o fiscal designado emite termos de recebimento.', 403);
    if (!(input.measuredCents > 0)) throw new DomainError('INVALID_RECEIPT', 'Informe o valor medido.');
    if (input.type === 'definitivo' && !c.receipts.some((r) => r.type === 'provisorio' && r.periodLabel === input.periodLabel)) {
      throw new DomainError('PROVISIONAL_REQUIRED', 'Emita antes o termo de recebimento provisório deste período.', 409);
    }
    // Cada ocorrência entra uma única vez em cada tipo de termo.
    const used = new Set(c.receipts.filter((r) => r.type === input.type).flatMap((r) => r.occurrenceIds));
    const occurrences = c.occurrences.filter((o) => !used.has(o.id));
    const receipt = buildReceipt(c, input.type, {
      id: this.store.nextId('TR'),
      at: this.now().toISOString(),
      authorId: userId,
      authorName: u.name,
      nature: p.nature,
      periodLabel: input.periodLabel,
      measuredCents: input.measuredCents,
      occurrences,
    });
    c.receipts.push(receipt);
    this.log(p, userId, `Termo de recebimento ${input.type} emitido`, input.periodLabel);
    return p;
  }

  // ---------- painel ----------

  dashboard() {
    const all = this.store.listProcesses();
    const byPhase = { planejamento: 0, externa: 0, contrato: 0, encerrado: 0 };
    all.forEach((p) => (byPhase[p.phase] += 1));
    const reports = all.flatMap((p) => (['etp', 'tr'] as const).map((k) => p.documents[k].report).filter((r) => r !== null));
    const blocking = all
      .flatMap((p) =>
        (['etp', 'tr'] as const).flatMap((k) =>
          (p.documents[k].report?.findings ?? [])
            .filter((f) => f.severity === 'bloqueante' && p.phase === 'planejamento')
            .map((f) => ({ processId: p.id, number: p.number, title: p.title, doc: k, message: f.message })),
        ),
      )
      .slice(0, 12);
    const topIssues = new Map<string, number>();
    reports.forEach((r) => r!.findings.forEach((f) => topIssues.set(f.message, (topIssues.get(f.message) ?? 0) + 1)));
    return {
      total: all.length,
      byPhase,
      inReview: all.filter((p) => Object.values(p.documents).some((d) => d.status === 'em_analise_juridica')).length,
      avgScore: reports.length ? Math.round(reports.reduce((a, r) => a + r!.score, 0) / reports.length) : null,
      estimatedTotalCents: all.reduce((a, p) => a + (p.estimatedCents ?? 0), 0),
      blocking,
      topIssues: [...topIssues.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([message, count]) => ({ message, count })),
    };
  }
}
