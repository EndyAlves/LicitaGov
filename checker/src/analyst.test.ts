import { describe, expect, it } from 'vitest';
import { analyzeDocument } from '../../server/src/legal/compliance';
import { DRAFT_TR_MERENDA } from '../../server/src/seed';
import { applyMany, buildPrompt, editFor, linesOf, parseResult, type Proposal } from './analyst';

const DOC = ['1. Do objeto', '', 'Aquisição de arroz.', '', '2. Da entrega', '', 'Entrega em 5 dias.', '', '3. Do pagamento', '', 'Pagamento oportunamente.'].join('\n');
const snap = linesOf(DOC).map((l) => l.text);
const prop = (over: Partial<Proposal>): Proposal => ({
  id: 'p1',
  gravidade: 'alerta',
  titulo: 't',
  fundamento: '',
  analise: '',
  relacionado: null,
  acao: 'inserir_depois',
  linha: 1,
  trecho: null,
  texto: 'NOVO',
  ...over,
});

describe('linhas e localização', () => {
  it('numera só linhas com conteúdo', () => {
    expect(snap).toEqual(['1. Do objeto', 'Aquisição de arroz.', '2. Da entrega', 'Entrega em 5 dias.', '3. Do pagamento', 'Pagamento oportunamente.']);
  });

  it('insere uma seção depois da última linha de outra seção, não no fim', () => {
    const e = editFor(DOC, snap, prop({ linha: 4, texto: '2.1 Da garantia\n\nGarantia de [informar] meses.' }))!;
    const out = DOC.slice(0, e.start) + e.text + DOC.slice(e.end);
    expect(out).toContain('Entrega em 5 dias.\n\n2.1 Da garantia\n\nGarantia de [informar] meses.\n\n3. Do pagamento');
  });

  it('insere antes do título indicado', () => {
    const e = editFor(DOC, snap, prop({ acao: 'inserir_antes', linha: 5, texto: 'X' }))!;
    expect(DOC.slice(0, e.start) + e.text + DOC.slice(e.end)).toContain('Entrega em 5 dias.\n\nX\n\n3. Do pagamento');
  });

  it('substitui só o trecho citado', () => {
    const e = editFor(DOC, snap, prop({ acao: 'substituir_trecho', linha: 6, trecho: 'oportunamente', texto: 'em até 10 dias úteis' }))!;
    expect(DOC.slice(0, e.start) + e.text + DOC.slice(e.end)).toContain('Pagamento em até 10 dias úteis.');
  });

  it('acha a linha pelo conteúdo depois que o texto mudou acima dela', () => {
    const changed = 'Preâmbulo novo.\n\n' + DOC;
    const e = editFor(changed, snap, prop({ acao: 'substituir_linha', linha: 6, texto: 'Pagamento em 10 dias.' }))!;
    expect(changed.slice(0, e.start) + e.text + changed.slice(e.end)).toMatch(/3\. Do pagamento\n\nPagamento em 10 dias\.$/);
  });

  it('devolve null quando a linha de referência sumiu', () => {
    expect(editFor(DOC.replace('Entrega em 5 dias.', 'Outra coisa.'), snap, prop({ linha: 4 }))).toBeNull();
  });

  it('desempata linhas repetidas pela ordem', () => {
    const doc = 'A\n\nNão se aplica.\n\nB\n\nNão se aplica.';
    const s = linesOf(doc).map((l) => l.text);
    const e = editFor(doc, s, prop({ acao: 'substituir_linha', linha: 4, texto: 'Z' }))!;
    expect(doc.slice(0, e.start) + e.text + doc.slice(e.end)).toBe('A\n\nNão se aplica.\n\nB\n\nZ');
  });
});

describe('várias propostas de uma vez', () => {
  it('aplica substituição e inserções na mesma região sem se atropelar', () => {
    const r = applyMany(DOC, snap, [
      prop({ id: 'a', acao: 'substituir_trecho', linha: 6, trecho: 'oportunamente', texto: 'em até 10 dias' }),
      prop({ id: 'b', acao: 'inserir_depois', linha: 6, texto: '3.1 Do reajuste\n\nIPCA.' }),
      prop({ id: 'c', acao: 'inserir_antes', linha: 1, texto: 'TERMO DE REFERÊNCIA' }),
      prop({ id: 'd', acao: 'substituir_linha', linha: 2, texto: 'Aquisição de arroz tipo 1.' }),
    ]);
    expect(r.applied.sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(r.text).toBe(
      'TERMO DE REFERÊNCIA\n\n1. Do objeto\n\nAquisição de arroz tipo 1.\n\n2. Da entrega\n\nEntrega em 5 dias.\n\n3. Do pagamento\n\nPagamento em até 10 dias.\n\n3.1 Do reajuste\n\nIPCA.',
    );
  });

  it('deixa de fora a proposta que se sobrepõe a outra', () => {
    const r = applyMany(DOC, snap, [
      prop({ id: 'a', acao: 'substituir_linha', linha: 6, texto: 'X' }),
      prop({ id: 'b', acao: 'substituir_trecho', linha: 6, trecho: 'oportunamente', texto: 'Y' }),
    ]);
    expect(r.applied).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
  });
});

describe('prompt e resposta', () => {
  it('manda o documento com linhas numeradas, os elementos exigidos e os apontamentos', () => {
    const report = analyzeDocument('tr', DRAFT_TR_MERENDA, { category: 'merenda', nature: 'compra', estimatedCents: null, features: {} });
    const { prompt, lines } = buildPrompt({ kind: 'tr', text: DRAFT_TR_MERENDA, category: 'Merenda', nature: 'Compra', estimated: '', features: [], report });
    expect(prompt).toContain('[L1] TERMO DE REFERÊNCIA');
    expect(prompt).toContain('id "pagamento-ambiguo"');
    expect(prompt).toContain('[medicao] Critérios de medição e de pagamento');
    expect(lines.length).toBe(linesOf(DRAFT_TR_MERENDA).length);
  });

  it('descarta propostas sem lugar válido e ordena por gravidade', () => {
    const r = parseResult(
      {
        conclusao: 'nao_apto',
        resumo: 'R',
        propostas: [
          { id: 'x', gravidade: 'sugestao', acao: 'inserir_depois', linha: 2, texto: 'a' },
          { id: 'y', gravidade: 'bloqueante', acao: 'substituir_trecho', linha: 2, trecho: 't', texto: 'b', relacionado: 'null' },
          { id: 'z', gravidade: 'alerta', acao: 'inserir_depois', linha: 99, texto: 'c' },
          { id: 'w', gravidade: 'alerta', acao: 'substituir_trecho', linha: 1, texto: 'sem trecho' },
          { id: 'v', gravidade: 'alerta', acao: 'apagar', linha: 1, texto: 'd' },
        ],
        falsos_positivos: [{ id: 'falta-objeto', motivo: 'Está na seção 1.' }, { id: '' }],
      },
      5,
    );
    expect(r.propostas.map((p) => p.id)).toEqual(['y', 'x']);
    expect(r.propostas[0].relacionado).toBeNull();
    expect(r.falsos_positivos).toEqual([{ id: 'falta-objeto', motivo: 'Está na seção 1.' }]);
    expect(parseResult(null, 3).conclusao).toBe('apto_com_ressalvas');
  });
});
