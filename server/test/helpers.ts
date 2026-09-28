import { RuleAdjuster } from '../src/ai/adjuster.js';
import { MockPriceConnector } from '../src/connectors/prices.js';
import { MockSanctionsConnector } from '../src/connectors/sanctions.js';
import { ProcessService } from '../src/domain/processService.js';
import { demoUsers } from '../src/seed.js';
import { MemoryStore } from '../src/store/memoryStore.js';

export const NOW = new Date('2026-09-28T12:00:00Z');

export function setup() {
  const clock = { now: new Date(NOW) };
  const service = new ProcessService({
    store: new MemoryStore({ users: demoUsers }),
    prices: new MockPriceConnector(undefined, () => clock.now),
    sanctions: new MockSanctionsConnector(),
    adjuster: new RuleAdjuster(),
    now: () => clock.now,
  });
  return { service, clock };
}

export const allCerts = (validUntil: string) =>
  (['cnd_federal', 'fgts', 'cndt', 'estadual', 'municipal', 'falencia'] as const).map((type) => ({ type, validUntil }));

export const healthyBalance = {
  year: 2025,
  currentAssetsCents: 200_000_00,
  longTermAssetsCents: 20_000_00,
  totalAssetsCents: 300_000_00,
  currentLiabilitiesCents: 100_000_00,
  longTermLiabilitiesCents: 20_000_00,
  equityCents: 180_000_00,
};
