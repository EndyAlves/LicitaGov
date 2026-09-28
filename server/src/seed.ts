import type { ProcessService } from './domain/processService.js';
import type { User } from './domain/types.js';

export const demoUsers: User[] = [
  { id: 'ana', name: 'Ana Ribeiro', roles: ['requisitante'], unit: 'Secretaria de Educação' },
  { id: 'bruno', name: 'Bruno Tavares', roles: ['planejamento'], unit: 'Departamento de Compras' },
  { id: 'carla', name: 'Carla Menezes', roles: ['agente'], unit: 'Agente de Contratação / Pregoeira' },
  { id: 'diego', name: 'Dr. Diego Farias', roles: ['juridico'], unit: 'Procuradoria-Geral do Município' },
  { id: 'elisa', name: 'Elisa Prado', roles: ['fiscal'], unit: 'Secretaria de Administração' },
  { id: 'fabio', name: 'Fábio Nunes', roles: ['gestor'], unit: 'Secretaria de Administração' },
];

/** Rascunho típico do setor requisitante: incompleto, com pagamento vago e lei revogada. */
export const DRAFT_ETP_MERENDA = `ESTUDO TÉCNICO PRELIMINAR

1. Descrição da necessidade
A Secretaria de Educação precisa adquirir gêneros alimentícios para a merenda escolar das 42 escolas da rede, atendendo 12.800 alunos, conforme a Lei 8.666/93.

2. Estimativa das quantidades
Arroz: 38.000 kg; feijão: 14.500 kg; leite: 60.000 litros; frango: 22.000 kg, aproximadamente o mesmo do ano passado.

3. Estimativa do valor
O valor será definido após pesquisa de preços.

4. Requisitos da contratação
Produtos de boa qualidade, entregues nas escolas quando necessário.
`;

export const DRAFT_TR_MERENDA = `TERMO DE REFERÊNCIA

1. Do objeto
Aquisição de gêneros alimentícios para a merenda escolar, marca Tio João para o arroz.

2. Da entrega
Os produtos serão entregues nas escolas pela empresa, que deverá ser sediada no município.

3. Do pagamento
O pagamento será efetuado oportunamente, conforme disponibilidade financeira.
`;

const ETP_EXPEDIENTE = `ESTUDO TÉCNICO PRELIMINAR — MATERIAL DE EXPEDIENTE

1. Descrição da necessidade
As unidades administrativas precisam de material de expediente para manter a continuidade dos serviços ao cidadão; a falta de insumos paralisa o atendimento, o que contraria o interesse público.

2. Previsão no Plano de Contratações Anual
A demanda consta do item 37 do PCA 2026.

3. Requisitos da contratação
Produtos novos, com certificação do INMETRO quando exigível, embalagens recicláveis.

4. Estimativa das quantidades
Memória de cálculo baseada na série histórica de consumo dos últimos 24 meses (Anexo I), acrescida de 5% para novas unidades.

5. Levantamento de mercado
Foram avaliadas a aquisição direta, o almoxarifado virtual e a ata de outro órgão; a aquisição por registro de preços mostrou-se mais vantajosa pela flexibilidade de pedidos.

6. Estimativa do valor
Valor estimado apurado em pesquisa de preços no Painel de Preços e contratações similares, com preços unitários de referência no Anexo II.

7. Descrição da solução como um todo
Fornecimento parcelado conforme demanda, com entrega no almoxarifado central.

8. Justificativa do parcelamento
A contratação será parcelada por item, pois o objeto é divisível e a adjudicação por item amplia a competitividade sem perda de economia de escala.

9. Resultados pretendidos
Economicidade pela compra sob demanda e redução de estoques parados.

10. Providências prévias
Designação e capacitação dos fiscais do contrato.

11. Contratações correlatas
Não há contratações correlatas ou interdependentes.

12. Impactos ambientais
Critérios de sustentabilidade: papel reciclado ou certificado e logística reversa de cartuchos.

13. Posicionamento conclusivo
A equipe de planejamento declara que a contratação é viável e adequada à necessidade.
`;

const TR_EXPEDIENTE = `TERMO DE REFERÊNCIA — MATERIAL DE EXPEDIENTE

1. Definição do objeto
Registro de preços para aquisição de material de expediente, vigência de 12 meses, prorrogável por igual período.

2. Fundamentação da contratação
Conforme o Estudo Técnico Preliminar do processo.

3. Descrição da solução como um todo
Fornecimento sob demanda considerando todo o ciclo de vida, incluindo logística reversa de embalagens.

4. Requisitos da contratação
Especificações técnicas do Anexo I. Garantia mínima de 90 dias contra defeitos de fabricação.

5. Modelo de execução
Prazo de entrega de 10 dias corridos após a ordem de fornecimento, no almoxarifado central.

6. Modelo de gestão do contrato
Fiscal do contrato designado acompanhará as entregas e registrará as ocorrências.

7. Critérios de medição e de pagamento
A medição será feita por unidade de medida entregue e aceita. O pagamento será efetuado em até 10 (dez) dias úteis após o recebimento definitivo e o atesto da nota fiscal.

8. Forma e critérios de seleção do fornecedor
Pregão eletrônico, critério de julgamento menor preço por item.

9. Estimativa do valor
Valor estimado conforme preços unitários do relatório de pesquisa de preços.

10. Adequação orçamentária
Dotação orçamentária 02.01.04.122.0002.2003 — elemento de despesa 3.3.90.30.

11. Reajuste
Preços fixos por 12 meses; após, reajuste pelo IPCA.
`;

/** Monta a prefeitura de demonstração com processos em fases diferentes. */
export async function seedDemo(service: ProcessService) {
  // 1. Merenda escolar: rascunho problemático, na fase de planejamento
  const merenda = service.create('ana', {
    title: 'Merenda escolar 2027',
    object: 'Aquisição de gêneros alimentícios para a alimentação escolar da rede municipal',
    unit: 'Secretaria de Educação',
    category: 'merenda',
    nature: 'compra',
    features: { perishable: true, partialDeliveries: true, priceRegistration: true },
    etp: DRAFT_ETP_MERENDA,
    tr: DRAFT_TR_MERENDA,
  });
  service.setPriceItems(merenda.id, 'bruno', [
    { description: 'Arroz tipo 1, pacote 5 kg', unit: 'pct', quantity: 7600 },
    { description: 'Feijão carioca tipo 1, 1 kg', unit: 'kg', quantity: 14500 },
    { description: 'Leite UHT integral 1 L', unit: 'L', quantity: 60000 },
  ]);

  // 2. Material de expediente: planejamento aprovado, licitação em andamento
  const exp = service.create('bruno', {
    title: 'Material de expediente — SRP',
    object: 'Registro de preços para aquisição de material de expediente',
    unit: 'Secretaria de Administração',
    category: 'expediente',
    nature: 'compra',
    budgetLine: '02.01.04.122.0002.2003 — 3.3.90.30',
    features: { priceRegistration: true },
    etp: ETP_EXPEDIENTE,
    tr: TR_EXPEDIENTE,
  });
  service.setPriceItems(exp.id, 'bruno', [
    { description: 'Papel A4 75 g/m², resma 500 folhas', unit: 'resma', quantity: 3000 },
    { description: 'Caneta esferográfica azul', unit: 'un', quantity: 8000 },
    { description: 'Toner para impressora laser', unit: 'un', quantity: 120 },
  ]);
  await service.autoResearch(exp.id, 'bruno');
  service.submit(exp.id, 'etp', 'bruno');
  service.review(exp.id, 'etp', 'diego', 'approve');
  service.submit(exp.id, 'tr', 'bruno');
  service.review(exp.id, 'tr', 'diego', 'approve');
  service.suggestRisks(exp.id, 'carla');
  service.generateEdital(exp.id, 'carla');

  const items = service.get(exp.id).prices.items;
  const unitPrices = (factor: number) =>
    items.map((i) => {
      const r = service.priceReport(exp.id).items.find((a) => a.item.id === i.id)!;
      return { itemId: i.id, unitPriceCents: Math.round((r.estimatedUnitCents ?? 100) * factor) };
    });
  const inAYear = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
  const lastWeek = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const allCerts = (validUntil: string) =>
    (['cnd_federal', 'fgts', 'cndt', 'estadual', 'municipal', 'falencia'] as const).map((type) => ({ type, validUntil }));
  const year = new Date().getFullYear() - 1;

  service.addBid(exp.id, 'carla', {
    supplierName: 'Papelaria Horizonte Ltda',
    cnpj: '11.444.777/0001-61',
    items: unitPrices(0.86),
    certificates: allCerts(inAYear),
    balance: { year, currentAssetsCents: 90_000_00, longTermAssetsCents: 10_000_00, totalAssetsCents: 150_000_00, currentLiabilitiesCents: 40_000_00, longTermLiabilitiesCents: 10_000_00, equityCents: 100_000_00 },
    technicalCertificates: 2,
  });
  service.addBid(exp.id, 'carla', {
    supplierName: 'Distribuidora Central de Suprimentos S.A.',
    cnpj: '12.345.678/0001-95',
    items: unitPrices(0.9),
    certificates: [...allCerts(inAYear).filter((c) => c.type !== 'cndt'), { type: 'cndt', validUntil: lastWeek }],
    balance: { year, currentAssetsCents: 400_000_00, longTermAssetsCents: 50_000_00, totalAssetsCents: 800_000_00, currentLiabilitiesCents: 300_000_00, longTermLiabilitiesCents: 100_000_00, equityCents: 400_000_00 },
    technicalCertificates: 3,
  });
  service.addBid(exp.id, 'carla', {
    supplierName: 'Comercial Ipê Material de Escritório ME',
    cnpj: '33.445.566/0001-86',
    items: unitPrices(0.93),
    certificates: allCerts(inAYear),
    balance: { year, currentAssetsCents: 180_000_00, longTermAssetsCents: 20_000_00, totalAssetsCents: 260_000_00, currentLiabilitiesCents: 90_000_00, longTermLiabilitiesCents: 30_000_00, equityCents: 140_000_00 },
    technicalCertificates: 1,
  });

  // 3. Limpeza: contrato assinado e em fiscalização
  const limp = service.create('bruno', {
    title: 'Limpeza das unidades de saúde',
    object: 'Serviço contínuo de limpeza e conservação com dedicação exclusiva de mão de obra nas unidades básicas de saúde',
    unit: 'Secretaria de Saúde',
    category: 'limpeza',
    nature: 'servico_continuo',
    budgetLine: '02.05.10.301.0010.2040 — 3.3.90.37',
    features: { dedicatedLabor: true },
    etp: ETP_EXPEDIENTE.replace(/MATERIAL DE EXPEDIENTE/g, 'LIMPEZA').replace('material de expediente', 'serviço de limpeza'),
    tr:
      TR_EXPEDIENTE.replace(/MATERIAL DE EXPEDIENTE/g, 'LIMPEZA') +
      '\n12. Garantias trabalhistas\nSerá adotada conta-depósito vinculada para provisões de férias, 13º e rescisões. A medição mensal usará o IMR do Anexo III.\n',
  });
  service.setPriceItems(limp.id, 'bruno', [{ description: 'Posto de servente 44h semanais', unit: 'posto/mês', quantity: 24 * 12 }]);
  for (const [supplier, value] of [
    ['Pref. Mun. de Londrina', 5_410_00],
    ['Pref. Mun. de Maringá', 5_290_00],
    ['Consórcio Saúde Oeste', 5_560_00],
  ] as const) {
    service.addSample(limp.id, service.get(limp.id).prices.items[0].id, 'bruno', {
      source: 'contratacao_similar',
      supplier,
      unitPriceCents: value,
      date: new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10),
    });
  }
  service.submit(limp.id, 'etp', 'bruno');
  service.review(limp.id, 'etp', 'diego', 'approve');
  service.submit(limp.id, 'tr', 'bruno');
  service.review(limp.id, 'tr', 'diego', 'approve');
  service.suggestRisks(limp.id, 'carla');
  service.generateEdital(limp.id, 'carla');
  const posto = service.get(limp.id).prices.items[0].id;
  service.addBid(limp.id, 'carla', {
    supplierName: 'Brilho Serviços Gerais Ltda',
    cnpj: '98.765.432/0001-98',
    items: [{ itemId: posto, unitPriceCents: 5_150_00 }],
    certificates: allCerts(inAYear),
    balance: { year, currentAssetsCents: 2_000_000_00, longTermAssetsCents: 200_000_00, totalAssetsCents: 3_500_000_00, currentLiabilitiesCents: 900_000_00, longTermLiabilitiesCents: 300_000_00, equityCents: 2_300_000_00 },
    technicalCertificates: 4,
  });
  const bid = service.get(limp.id).bids[0];
  await service.qualifyBid(limp.id, bid.id, 'carla');
  service.award(limp.id, bid.id, 'carla');
  service.createContract(limp.id, 'fabio', { months: 12, fiscalId: 'elisa' });
  service.addOccurrence(limp.id, 'elisa', {
    kind: 'nao_conformidade',
    description: 'UBS Jardim América: banheiros sem reposição de insumos às 14h.',
    glosaPercent: 2,
    photos: [],
  });
}
