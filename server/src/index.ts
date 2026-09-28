import { fileURLToPath } from 'node:url';
import { defaultAdjuster } from './ai/adjuster.js';
import { ComprasGovPriceConnector, MockPriceConnector } from './connectors/prices.js';
import { MockSanctionsConnector, PortalTransparenciaConnector } from './connectors/sanctions.js';
import { ProcessService } from './domain/processService.js';
import { createApp } from './http/app.js';
import { demoUsers, seedDemo } from './seed.js';
import { MemoryStore } from './store/memoryStore.js';

const port = Number(process.env.PORT ?? 3334);
const live = process.env.LICITAGOV_LIVE_PRICES === 'true';
const transparencyKey = process.env.PORTAL_TRANSPARENCIA_KEY;
const adjuster = defaultAdjuster();

const service = new ProcessService({
  store: new MemoryStore({ users: demoUsers }),
  prices: live ? new ComprasGovPriceConnector() : new MockPriceConnector(),
  sanctions: transparencyKey ? new PortalTransparenciaConnector(transparencyKey) : new MockSanctionsConnector(),
  adjuster,
  org: process.env.LICITAGOV_ORG ?? 'PREFEITURA MUNICIPAL DE EXEMPLO',
});

if (process.env.DEMO_SEED !== 'false') await seedDemo(service);

const staticDir = fileURLToPath(new URL('../../web/dist', import.meta.url));
createApp(service, { staticDir, aiEngine: adjuster.engine }).listen(port, () => {
  console.log(`LicitaGov API em http://localhost:${port} (ajuste: ${adjuster.engine})`);
});
