// Modo demonstração: a API roda dentro do navegador, com o mesmo código de
// domínio do servidor. Permite publicar o app como página estática; os dados
// ficam na memória da aba e voltam ao estado inicial ao recarregar.
import { RuleAdjuster } from '../../../server/src/ai/ruleAdjuster';
import { MockPriceConnector } from '../../../server/src/connectors/prices';
import { MockSanctionsConnector } from '../../../server/src/connectors/sanctions';
import { DomainError, ProcessService } from '../../../server/src/domain/processService';
import type { DocKind } from '../../../server/src/domain/types';
import { CATEGORY_LABELS, findClauses } from '../../../server/src/legal/clauses';
import { requirementsFor } from '../../../server/src/legal/requirements';
import { demoUsers, seedDemo } from '../../../server/src/seed';
import { MemoryStore } from '../../../server/src/store/memoryStore';

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Ctx = { params: string[]; body: Body; query: URLSearchParams; user: () => string };
type Handler = (c: Ctx) => unknown;

const service = new ProcessService({
  store: new MemoryStore({ users: demoUsers }),
  prices: new MockPriceConnector(),
  sanctions: new MockSanctionsConnector(),
  adjuster: new RuleAdjuster(),
  org: 'PREFEITURA MUNICIPAL DE EXEMPLO',
});
const ready = seedDemo(service);

const docKind = (v: string): DocKind => {
  if (v !== 'etp' && v !== 'tr') throw new DomainError('INVALID_DOC', 'Documento deve ser "etp" ou "tr".');
  return v;
};
const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : NaN);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/health$/, () => ({ ok: true, adjuster: 'regras', ephemeral: true })],
  ['GET', /^\/users$/, () => service.store.listUsers()],
  ['GET', /^\/catalog$/, () => ({ categories: CATEGORY_LABELS, requirements: { etp: requirementsFor('etp'), tr: requirementsFor('tr') } })],
  [
    'GET',
    /^\/clauses$/,
    ({ query }) => findClauses({ category: query.get('category') ?? undefined, doc: query.get('doc') ?? undefined, section: query.get('section') ?? undefined, q: query.get('q') ?? undefined }),
  ],
  ['GET', /^\/dashboard$/, () => service.dashboard()],
  ['GET', /^\/processes$/, () => service.list()],
  ['POST', /^\/processes$/, ({ user, body }) => service.create(user(), body as never)],
  ['GET', /^\/processes\/([^/]+)$/, ({ params }) => service.get(params[0])],
  [
    'PUT',
    /^\/processes\/([^/]+)\/documents\/(\w+)$/,
    ({ params, user, body }) => {
      if (typeof body.text !== 'string') throw new DomainError('INVALID_TEXT', 'Informe o texto do documento.');
      return service.updateDocument(params[0], docKind(params[1]), user(), body.text);
    },
  ],
  ['POST', /^\/processes\/([^/]+)\/documents\/(\w+)\/analyze$/, ({ params }) => service.analyze(params[0], docKind(params[1]))],
  ['POST', /^\/processes\/([^/]+)\/documents\/(\w+)\/adjust$/, ({ params, user }) => service.adjust(params[0], docKind(params[1]), user())],
  ['POST', /^\/processes\/([^/]+)\/documents\/(\w+)\/submit$/, ({ params, user }) => service.submit(params[0], docKind(params[1]), user())],
  [
    'POST',
    /^\/processes\/([^/]+)\/documents\/(\w+)\/review$/,
    ({ params, user, body }) => {
      if (body.decision !== 'approve' && body.decision !== 'return') throw new DomainError('INVALID_DECISION', 'Decisão inválida.');
      return service.review(params[0], docKind(params[1]), user(), body.decision, str(body.note));
    },
  ],
  [
    'PUT',
    /^\/processes\/([^/]+)\/prices\/items$/,
    ({ params, user, body }) => {
      const items = (Array.isArray(body.items) ? body.items : []).map((i: Body) => {
        const quantity = Number(i.quantity);
        if (!str(i.description) || !(quantity > 0)) throw new DomainError('INVALID_ITEMS', 'Cada item precisa de descrição e quantidade positiva.');
        return { description: String(i.description), unit: str(i.unit) ?? 'un', quantity, catalogCode: str(i.catalogCode) };
      });
      return service.setPriceItems(params[0], user(), items);
    },
  ],
  [
    'POST',
    /^\/processes\/([^/]+)\/prices\/items\/([^/]+)\/samples$/,
    ({ params, user, body }) => {
      if (!str(body.supplier) || !str(body.date)) throw new DomainError('INVALID_PRICE', 'Informe fonte, fornecedor/órgão, data e preço.');
      return service.addSample(params[0], params[1], user(), {
        source: body.source,
        supplier: body.supplier,
        date: body.date,
        unitPriceCents: int(body.unitPriceCents),
        reference: str(body.reference),
      });
    },
  ],
  ['DELETE', /^\/processes\/([^/]+)\/prices\/items\/([^/]+)\/samples\/([^/]+)$/, ({ params, user }) => service.removeSample(params[0], params[1], params[2], user())],
  ['POST', /^\/processes\/([^/]+)\/prices\/auto$/, ({ params, user }) => service.autoResearch(params[0], user())],
  ['GET', /^\/processes\/([^/]+)\/prices\/report$/, ({ params }) => service.priceReport(params[0])],
  ['POST', /^\/processes\/([^/]+)\/risks\/suggest$/, ({ params, user }) => service.suggestRisks(params[0], user())],
  [
    'PATCH',
    /^\/processes\/([^/]+)\/risks\/([^/]+)$/,
    ({ params, user, body }) =>
      service.updateRisk(params[0], params[1], user(), {
        probability: body.probability === undefined ? undefined : int(body.probability),
        impact: body.impact === undefined ? undefined : int(body.impact),
        allocation: ['contratante', 'contratado', 'compartilhado'].includes(body.allocation) ? body.allocation : undefined,
      }),
  ],
  ['POST', /^\/processes\/([^/]+)\/edital$/, ({ params, user }) => service.generateEdital(params[0], user())],
  [
    'POST',
    /^\/processes\/([^/]+)\/bids$/,
    ({ params, user, body }) =>
      service.addBid(params[0], user(), {
        supplierName: String(body.supplierName ?? ''),
        cnpj: String(body.cnpj ?? ''),
        items: Array.isArray(body.items) ? body.items : [],
        certificates: Array.isArray(body.certificates) ? body.certificates : [],
        balance: body.balance,
        technicalCertificates: typeof body.technicalCertificates === 'number' ? body.technicalCertificates : 0,
      }),
  ],
  ['POST', /^\/processes\/([^/]+)\/bids\/([^/]+)\/qualify$/, ({ params, user }) => service.qualifyBid(params[0], params[1], user())],
  ['POST', /^\/processes\/([^/]+)\/bids\/([^/]+)\/award$/, ({ params, user }) => service.award(params[0], params[1], user())],
  [
    'POST',
    /^\/processes\/([^/]+)\/contract$/,
    ({ params, user, body }) => service.createContract(params[0], user(), { months: typeof body.months === 'number' ? body.months : undefined, fiscalId: String(body.fiscalId ?? '') }),
  ],
  [
    'POST',
    /^\/processes\/([^/]+)\/contract\/occurrences$/,
    ({ params, user, body }) => {
      if (!['entrega', 'atraso', 'nao_conformidade', 'observacao'].includes(body.kind)) throw new DomainError('INVALID_OCCURRENCE', 'Tipo de ocorrência inválido.');
      return service.addOccurrence(params[0], user(), {
        kind: body.kind,
        description: String(body.description ?? ''),
        glosaPercent: Number(body.glosaPercent ?? 0),
        photos: (Array.isArray(body.photos) ? body.photos : []).filter((x: unknown) => typeof x === 'string' && x.startsWith('data:image/')),
        location: body.location && typeof body.location.lat === 'number' ? { lat: body.location.lat, lng: body.location.lng } : undefined,
      });
    },
  ],
  [
    'POST',
    /^\/processes\/([^/]+)\/contract\/receipts$/,
    ({ params, user, body }) => {
      if (body.type !== 'provisorio' && body.type !== 'definitivo') throw new DomainError('INVALID_RECEIPT', 'Tipo deve ser provisório ou definitivo.');
      return service.issueReceipt(params[0], user(), { type: body.type, periodLabel: String(body.periodLabel ?? ''), measuredCents: int(body.measuredCents) });
    },
  ],
];

/** Atende uma chamada como a API HTTP faria, devolvendo status e corpo. */
export async function handle(method: string, url: string, body: unknown, userId: string | null): Promise<{ status: number; body: unknown }> {
  await ready;
  const [path, qs = ''] = url.split('?');
  try {
    for (const [m, re, fn] of routes) {
      const match = m === method ? re.exec(path) : null;
      if (!match) continue;
      const user = () => {
        if (!userId || !service.store.getUser(userId)) throw new DomainError('UNAUTHENTICATED', 'Selecione um servidor válido.', 401);
        return userId;
      };
      const result = await fn({ params: match.slice(1).map(decodeURIComponent), body: (body ?? {}) as Body, query: new URLSearchParams(qs), user });
      // Cópia profunda: a interface nunca segura referências ao estado interno.
      return { status: 200, body: structuredClone(result) };
    }
    return { status: 404, body: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } };
  } catch (e) {
    if (e instanceof DomainError) return { status: e.status, body: { code: e.code, message: e.message, details: e.details } };
    console.error(e);
    return { status: 500, body: { code: 'INTERNAL', message: 'Erro interno.' } };
  }
}
