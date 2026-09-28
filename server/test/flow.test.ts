import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app.js';
import { DRAFT_ETP_MERENDA, DRAFT_TR_MERENDA } from '../src/seed.js';
import { allCerts, healthyBalance, setup } from './helpers.js';

const GOOD_ETP = `Descrição da necessidade: atender o interesse público com a alimentação escolar.
Previsão no plano de contratações anual: item 12 do PCA.
Requisitos da contratação: produtos conforme cardápio da nutricionista.
Estimativa das quantidades pela memória de calculo per capita.
Levantamento de mercado: alternativas possíveis avaliadas.
Estimativa do valor por pesquisa de preços.
Descrição da solução como um todo.
Parcelamento: adjudicação por item, pois amplia a competitividade.
Resultados pretendidos: economicidade.
Providências prévias: capacitação dos fiscais.
Contratações correlatas: chamada pública da agricultura familiar.
Impactos ambientais: logística reversa.
Posicionamento conclusivo: a contratação é viável.`;

const GOOD_TR = `Definição do objeto: gêneros alimentícios, 12 meses.
Fundamentação: Estudo Técnico Preliminar.
Descrição da solução considerando o ciclo de vida.
Requisitos da contratação: validade mínima de 2/3; garantia de substituição.
Modelo de execução: prazo de entrega de 5 dias.
Modelo de gestão: fiscal do contrato.

Critérios de medição: por unidade de medida aceita. O pagamento será feito em até 10 (dez) dias úteis após o atesto.

Seleção do fornecedor: pregão, menor preço por item.
Estimativa do valor com preços unitários.
Adequação orçamentária: dotação 3.3.90.30.
Reajuste pelo IPCA após 12 meses.
Cardápio da nutricionista.`;

describe('fluxo completo do processo', () => {
  it('goes from draft to contract with phase gates, roles and audit trail', async () => {
    const { service } = setup();
    const app = createApp(service);
    const as = (user: string) => ({ 'x-user-id': user });

    // Abertura com rascunho problemático
    const created = await request(app)
      .post('/api/processes')
      .set(as('ana'))
      .send({ title: 'Merenda', object: 'Gêneros alimentícios', unit: 'SEDUC', category: 'merenda', nature: 'compra', etp: DRAFT_ETP_MERENDA, tr: DRAFT_TR_MERENDA, features: { perishable: true } })
      .expect(201);
    const id = created.body.id;
    expect(created.body.documents.etp.report.approvable).toBe(false);

    // O fiscal não abre processos; o requisitante não aprova
    await request(app).post('/api/processes').set(as('elisa')).send({ title: 'x', object: 'y' }).expect(403);

    // Rascunho com pendência bloqueante não segue para o jurídico
    const blocked = await request(app).post(`/api/processes/${id}/documents/etp/submit`).set(as('ana')).expect(422);
    expect(blocked.body.code).toBe('BLOCKING_FINDINGS');

    // Ajuste automático devolve versão sugerida sem salvar
    const adj = await request(app).post(`/api/processes/${id}/documents/tr/adjust`).set(as('ana')).expect(200);
    expect(adj.body.engine).toBe('regras');
    expect(adj.body.after).toBeGreaterThan(adj.body.before);
    expect((await request(app).get(`/api/processes/${id}`)).body.documents.tr.text).toBe(DRAFT_TR_MERENDA);

    // Corrige, envia e o jurídico aprova (o TR depende do ETP aprovado)
    await request(app).put(`/api/processes/${id}/documents/etp`).set(as('ana')).send({ text: GOOD_ETP }).expect(200);
    await request(app).put(`/api/processes/${id}/documents/tr`).set(as('ana')).send({ text: GOOD_TR }).expect(200);
    await request(app).post(`/api/processes/${id}/documents/tr/submit`).set(as('ana')).expect(409);
    await request(app).post(`/api/processes/${id}/documents/etp/submit`).set(as('ana')).expect(200);
    await request(app).post(`/api/processes/${id}/documents/etp/review`).set(as('ana')).send({ decision: 'approve' }).expect(403);
    await request(app).post(`/api/processes/${id}/documents/etp/review`).set(as('diego')).send({ decision: 'return' }).expect(400);
    await request(app).post(`/api/processes/${id}/documents/etp/review`).set(as('diego')).send({ decision: 'approve' }).expect(200);
    await request(app).post(`/api/processes/${id}/documents/tr/submit`).set(as('ana')).expect(200);

    // Edital exige TR aprovado e valor estimado
    const early = await request(app).post(`/api/processes/${id}/edital`).set(as('carla')).expect(409);
    expect(early.body.details).toEqual(['TR aprovado pelo jurídico', 'valor estimado pela pesquisa de preços']);
    await request(app).post(`/api/processes/${id}/documents/tr/review`).set(as('diego')).send({ decision: 'approve' }).expect(200);
    await request(app).put(`/api/processes/${id}/documents/tr`).set(as('ana')).send({ text: 'x' }).expect(409);

    // Pesquisa de preços automática
    await request(app).put(`/api/processes/${id}/prices/items`).set(as('bruno')).send({ items: [{ description: 'Arroz tipo 1', unit: 'kg', quantity: 1000 }] }).expect(200);
    const auto = await request(app).post(`/api/processes/${id}/prices/auto`).set(as('bruno')).expect(200);
    expect(auto.body.imported).toBe(6);
    const report = await request(app).get(`/api/processes/${id}/prices/report`).expect(200);
    expect(report.body.complete).toBe(true);
    expect(report.body.totalCents).toBe(auto.body.process.estimatedCents);

    // Matriz de riscos e edital
    const risks = await request(app).post(`/api/processes/${id}/risks/suggest`).set(as('carla')).expect(200);
    const riskId = risks.body.process.risks[0].id;
    const patched = await request(app).patch(`/api/processes/${id}/risks/${riskId}`).set(as('carla')).send({ probability: 5, impact: 5 }).expect(200);
    expect(patched.body.risks[0].level).toBe('critico');
    const edital = await request(app).post(`/api/processes/${id}/edital`).set(as('carla')).expect(200);
    expect(edital.body.phase).toBe('externa');
    expect(edital.body.edital.text).toContain('10 (dez) dias úteis');
    expect(edital.body.edital.text).toContain('Lei nº 14.133/2021');

    // Propostas e habilitação
    const itemId = edital.body.prices.items[0].id;
    const price = Math.round(report.body.items[0].estimatedUnitCents * 0.9);
    await request(app)
      .post(`/api/processes/${id}/bids`)
      .set(as('carla'))
      .send({ supplierName: 'Impedida', cnpj: '11.444.777/0001-61', items: [{ itemId, unitPriceCents: price - 10 }], certificates: allCerts('2027-06-01'), balance: healthyBalance, technicalCertificates: 1 })
      .expect(200);
    await request(app).post(`/api/processes/${id}/bids`).set(as('carla')).send({ supplierName: 'X', cnpj: '123', items: [] }).expect(400);
    const withBids = await request(app)
      .post(`/api/processes/${id}/bids`)
      .set(as('carla'))
      .send({ supplierName: 'Regular', cnpj: '33.445.566/0001-86', items: [{ itemId, unitPriceCents: price }], certificates: allCerts('2027-06-01'), balance: healthyBalance, technicalCertificates: 1 })
      .expect(200);
    const [first, second] = withBids.body.bids;
    expect(first.supplierName).toBe('Impedida');

    await request(app).post(`/api/processes/${id}/bids/${second.id}/qualify`).set(as('carla')).expect(200);
    const order = await request(app).post(`/api/processes/${id}/bids/${second.id}/award`).set(as('carla')).expect(409);
    expect(order.body.code).toBe('ORDER');
    const q1 = await request(app).post(`/api/processes/${id}/bids/${first.id}/qualify`).set(as('carla')).expect(200);
    const impedida = q1.body.bids.find((b: { id: string }) => b.id === first.id);
    expect(impedida.status).toBe('inabilitada');
    expect(impedida.qualification.checks.find((c: { id: string }) => c.id === 'sancoes').status).toBe('falha');
    await request(app).post(`/api/processes/${id}/bids/${second.id}/award`).set(as('carla')).expect(200);

    // Contrato / ata e fiscalização
    await request(app).post(`/api/processes/${id}/contract`).set(as('fabio')).send({ fiscalId: 'bruno' }).expect(400);
    const contract = await request(app).post(`/api/processes/${id}/contract`).set(as('fabio')).send({ fiscalId: 'elisa', months: 12 }).expect(200);
    expect(contract.body.phase).toBe('contrato');
    expect(contract.body.contract.text).toContain('Regular');
    expect(contract.body.contract.text).toContain('33.445.566/0001-86');

    await request(app)
      .post(`/api/processes/${id}/contract/occurrences`)
      .set(as('elisa'))
      .send({ kind: 'nao_conformidade', description: 'Arroz com embalagem violada', glosaPercent: 5, photos: ['data:image/jpeg;base64,AAAA', 'http://x'] })
      .expect(200);
    await request(app).post(`/api/processes/${id}/contract/receipts`).set(as('elisa')).send({ type: 'definitivo', periodLabel: 'Out/2026', measuredCents: 100_000 }).expect(409);
    await request(app).post(`/api/processes/${id}/contract/receipts`).set(as('elisa')).send({ type: 'provisorio', periodLabel: 'Out/2026', measuredCents: 100_000 }).expect(200);
    const final = await request(app).post(`/api/processes/${id}/contract/receipts`).set(as('elisa')).send({ type: 'definitivo', periodLabel: 'Out/2026', measuredCents: 100_000 }).expect(200);
    const [prov, def] = final.body.contract.receipts;
    expect(final.body.contract.occurrences[0].photos).toHaveLength(1);
    expect(prov.glosaCents).toBe(5_000);
    expect(def.payableCents).toBe(95_000);
    expect(def.text).toContain('art. 140, II, "b"');

    // Uma nova medição provisória não repete a glosa já aplicada
    const next = await request(app).post(`/api/processes/${id}/contract/receipts`).set(as('elisa')).send({ type: 'provisorio', periodLabel: 'Nov/2026', measuredCents: 100_000 }).expect(200);
    expect(next.body.contract.receipts[2].glosaCents).toBe(0);

    expect(final.body.audit.length).toBeGreaterThan(15);
    const dash = await request(app).get('/api/dashboard').expect(200);
    expect(dash.body.byPhase.contrato).toBe(1);
  });

  it('serves the catalog and the clause bank', async () => {
    const { service } = setup();
    const app = createApp(service);
    const clauses = await request(app).get('/api/clauses?category=merenda&doc=tr').expect(200);
    expect(clauses.body[0].category).toBe('merenda');
    expect(clauses.body.some((c: { category: string }) => c.category === 'geral')).toBe(true);
    const cat = await request(app).get('/api/catalog').expect(200);
    expect(cat.body.requirements.etp).toHaveLength(13);
    expect(cat.body.requirements.tr).toHaveLength(10);
    await request(app).get('/api/processes/NOPE').expect(404);
    await request(app).get('/api/nope').expect(404);
  });
});
