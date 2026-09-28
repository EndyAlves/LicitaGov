import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { CATEGORY_LABELS, findClauses } from '../legal/clauses.js';
import { requirementsFor } from '../legal/requirements.js';
import { DomainError, type ProcessService } from '../domain/processService.js';
import type { DocKind } from '../domain/types.js';

/** A demonstração confia no cabeçalho `x-user-id`; em produção, aqui entra a validação de SSO/gov.br. */
function currentUser(service: ProcessService, req: Request): string {
  const id = req.header('x-user-id');
  if (!id || !service.store.getUser(id)) {
    throw new DomainError('UNAUTHENTICATED', 'Informe um usuário válido no cabeçalho x-user-id.', 401);
  }
  return id;
}

function docKind(value: string): DocKind {
  if (value !== 'etp' && value !== 'tr') throw new DomainError('INVALID_DOC', 'Documento deve ser "etp" ou "tr".');
  return value;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);

export function createApp(service: ProcessService, opts: { staticDir?: string; aiEngine?: string } = {}) {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, adjuster: opts.aiEngine ?? 'regras' }));

  app.get('/api/users', (_req, res) => res.json(service.store.listUsers()));

  app.get('/api/catalog', (_req, res) =>
    res.json({
      categories: CATEGORY_LABELS,
      requirements: { etp: requirementsFor('etp'), tr: requirementsFor('tr') },
    }),
  );

  app.get('/api/clauses', (req, res) =>
    res.json(
      findClauses({
        category: str(req.query.category),
        doc: str(req.query.doc),
        section: str(req.query.section),
        q: str(req.query.q),
      }),
    ),
  );

  app.get('/api/dashboard', (_req, res) => res.json(service.dashboard()));

  app.get('/api/processes', (_req, res) => res.json(service.list()));

  app.post('/api/processes', (req, res) => {
    res.status(201).json(service.create(currentUser(service, req), req.body ?? {}));
  });

  app.get('/api/processes/:id', (req, res) => res.json(service.get(req.params.id)));

  // Planejamento
  app.put('/api/processes/:id/documents/:kind', (req, res) => {
    const text = str(req.body?.text);
    if (text === undefined) throw new DomainError('INVALID_TEXT', 'Informe o texto do documento.');
    res.json(service.updateDocument(req.params.id, docKind(req.params.kind), currentUser(service, req), text));
  });

  app.post('/api/processes/:id/documents/:kind/analyze', (req, res) => {
    res.json(service.analyze(req.params.id, docKind(req.params.kind)));
  });

  app.post('/api/processes/:id/documents/:kind/adjust', async (req, res) => {
    res.json(await service.adjust(req.params.id, docKind(req.params.kind), currentUser(service, req)));
  });

  app.post('/api/processes/:id/documents/:kind/submit', (req, res) => {
    res.json(service.submit(req.params.id, docKind(req.params.kind), currentUser(service, req)));
  });

  app.post('/api/processes/:id/documents/:kind/review', (req, res) => {
    const decision = req.body?.decision;
    if (decision !== 'approve' && decision !== 'return') throw new DomainError('INVALID_DECISION', 'decision deve ser "approve" ou "return".');
    res.json(service.review(req.params.id, docKind(req.params.kind), currentUser(service, req), decision, str(req.body?.note)));
  });

  // Pesquisa de preços
  app.put('/api/processes/:id/prices/items', (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items) throw new DomainError('INVALID_ITEMS', 'Informe a lista de itens.');
    const clean = items.map((i: Record<string, unknown>) => {
      const quantity = Number(i.quantity);
      if (!str(i.description) || !(quantity > 0)) throw new DomainError('INVALID_ITEMS', 'Cada item precisa de descrição e quantidade positiva.');
      return { description: String(i.description), unit: str(i.unit) ?? 'un', quantity, catalogCode: str(i.catalogCode) };
    });
    res.json(service.setPriceItems(req.params.id, currentUser(service, req), clean));
  });

  app.post('/api/processes/:id/prices/items/:itemId/samples', (req, res) => {
    const b = req.body ?? {};
    const sources = ['painel', 'contratacao_similar', 'midia', 'fornecedor', 'nota_fiscal'];
    if (!sources.includes(b.source) || !str(b.supplier) || !str(b.date)) {
      throw new DomainError('INVALID_PRICE', 'Informe fonte, fornecedor/órgão, data e preço.');
    }
    res.json(
      service.addSample(req.params.id, req.params.itemId, currentUser(service, req), {
        source: b.source,
        supplier: b.supplier,
        date: b.date,
        unitPriceCents: int(b.unitPriceCents),
        reference: str(b.reference),
      }),
    );
  });

  app.delete('/api/processes/:id/prices/items/:itemId/samples/:sampleId', (req, res) => {
    res.json(service.removeSample(req.params.id, req.params.itemId, req.params.sampleId, currentUser(service, req)));
  });

  app.post('/api/processes/:id/prices/auto', async (req, res) => {
    res.json(await service.autoResearch(req.params.id, currentUser(service, req)));
  });

  app.get('/api/processes/:id/prices/report', (req, res) => res.json(service.priceReport(req.params.id)));

  // Matriz de riscos
  app.post('/api/processes/:id/risks/suggest', (req, res) => {
    res.json(service.suggestRisks(req.params.id, currentUser(service, req)));
  });

  app.patch('/api/processes/:id/risks/:riskId', (req, res) => {
    const b = req.body ?? {};
    res.json(
      service.updateRisk(req.params.id, req.params.riskId, currentUser(service, req), {
        probability: b.probability === undefined ? undefined : int(b.probability),
        impact: b.impact === undefined ? undefined : int(b.impact),
        allocation: ['contratante', 'contratado', 'compartilhado'].includes(b.allocation) ? b.allocation : undefined,
        mitigation: str(b.mitigation),
        clause: str(b.clause),
      }),
    );
  });

  // Fase externa
  app.post('/api/processes/:id/edital', (req, res) => {
    res.json(service.generateEdital(req.params.id, currentUser(service, req)));
  });

  app.post('/api/processes/:id/bids', (req, res) => {
    const b = req.body ?? {};
    res.json(
      service.addBid(req.params.id, currentUser(service, req), {
        supplierName: String(b.supplierName ?? ''),
        cnpj: String(b.cnpj ?? ''),
        items: Array.isArray(b.items) ? b.items : [],
        certificates: Array.isArray(b.certificates) ? b.certificates : [],
        balance: b.balance,
        technicalCertificates: typeof b.technicalCertificates === 'number' ? b.technicalCertificates : 0,
      }),
    );
  });

  app.post('/api/processes/:id/bids/:bidId/qualify', async (req, res) => {
    res.json(await service.qualifyBid(req.params.id, req.params.bidId, currentUser(service, req)));
  });

  app.post('/api/processes/:id/bids/:bidId/award', (req, res) => {
    res.json(service.award(req.params.id, req.params.bidId, currentUser(service, req)));
  });

  // Contrato e fiscalização
  app.post('/api/processes/:id/contract', (req, res) => {
    res.json(
      service.createContract(req.params.id, currentUser(service, req), {
        months: typeof req.body?.months === 'number' ? req.body.months : undefined,
        fiscalId: String(req.body?.fiscalId ?? ''),
      }),
    );
  });

  app.post('/api/processes/:id/contract/occurrences', (req, res) => {
    const b = req.body ?? {};
    const kinds = ['entrega', 'atraso', 'nao_conformidade', 'observacao'];
    if (!kinds.includes(b.kind)) throw new DomainError('INVALID_OCCURRENCE', 'Tipo de ocorrência inválido.');
    const photos = Array.isArray(b.photos) ? b.photos.filter((x: unknown) => typeof x === 'string' && x.startsWith('data:image/')) : [];
    res.json(
      service.addOccurrence(req.params.id, currentUser(service, req), {
        kind: b.kind,
        description: String(b.description ?? ''),
        glosaPercent: Number(b.glosaPercent ?? 0),
        photos,
        location: b.location && typeof b.location.lat === 'number' ? { lat: b.location.lat, lng: b.location.lng } : undefined,
      }),
    );
  });

  app.post('/api/processes/:id/contract/receipts', (req, res) => {
    const b = req.body ?? {};
    if (b.type !== 'provisorio' && b.type !== 'definitivo') throw new DomainError('INVALID_RECEIPT', 'Tipo deve ser provisório ou definitivo.');
    res.json(
      service.issueReceipt(req.params.id, currentUser(service, req), {
        type: b.type,
        periodLabel: String(b.periodLabel ?? ''),
        measuredCents: int(b.measuredCents),
      }),
    );
  });

  app.use('/api', (_req, _res, next) => next(new DomainError('NOT_FOUND', 'Rota não encontrada.', 404)));

  if (opts.staticDir && existsSync(opts.staticDir)) {
    const dir = opts.staticDir;
    app.use(express.static(dir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: dir }));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      res.status(err.status).json({ code: err.code, message: err.message, details: err.details });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ code: 'INVALID_JSON', message: 'JSON inválido.' });
      return;
    }
    console.error(err);
    res.status(500).json({ code: 'INTERNAL', message: 'Erro interno.' });
  });

  return app;
}
