import { isActive } from '../connectors/sanctions.js';
import type { Sanction } from '../connectors/types.js';
import type { Bid, CertificateType, Check, QualificationResult } from './types.js';

export const CERTIFICATE_LABELS: Record<CertificateType, { label: string; basis: string }> = {
  cnd_federal: { label: 'Certidão conjunta de débitos federais e dívida ativa (RFB/PGFN)', basis: 'Art. 68, III' },
  fgts: { label: 'Certificado de Regularidade do FGTS (CRF)', basis: 'Art. 68, IV' },
  cndt: { label: 'Certidão Negativa de Débitos Trabalhistas (CNDT)', basis: 'Art. 68, V' },
  estadual: { label: 'Regularidade com a Fazenda Estadual', basis: 'Art. 68, III' },
  municipal: { label: 'Regularidade com a Fazenda Municipal', basis: 'Art. 68, III' },
  falencia: { label: 'Certidão negativa de falência', basis: 'Art. 69, II' },
};

const REQUIRED: CertificateType[] = ['cnd_federal', 'fgts', 'cndt', 'estadual', 'municipal', 'falencia'];

export function isValidCnpj(value: string): boolean {
  const d = value.replace(/\D/g, '');
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(d[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export interface QualificationRules {
  /** Índices mínimos de liquidez geral, solvência geral e liquidez corrente. */
  minIndex: number;
  /** Patrimônio líquido mínimo exigido quando algum índice ficar abaixo do mínimo (até 10% do valor estimado, art. 69, §4º). */
  minEquityPercent: number;
  /** Quantidade mínima de atestados de capacidade técnica. */
  minTechnicalCertificates: number;
  estimatedCents: number | null;
}

export const DEFAULT_RULES: Omit<QualificationRules, 'estimatedCents'> = {
  minIndex: 1,
  minEquityPercent: 0.1,
  minTechnicalCertificates: 1,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Co-piloto do agente de contratação na habilitação: confere CNPJ, validade
 * das certidões na data do julgamento, índices contábeis, atestados e
 * impedimentos nos cadastros de sanções (art. 91, §4º).
 */
export function qualify(bid: Bid, sanctions: Sanction[], rules: QualificationRules, at: Date): QualificationResult {
  const checks: Check[] = [];

  checks.push({
    id: 'cnpj',
    group: 'juridica',
    label: 'CNPJ válido',
    status: isValidCnpj(bid.cnpj) ? 'ok' : 'falha',
    detail: isValidCnpj(bid.cnpj) ? bid.cnpj : `CNPJ ${bid.cnpj} com dígitos verificadores inválidos.`,
    basis: 'Art. 68, I',
  });

  for (const type of REQUIRED) {
    const { label, basis } = CERTIFICATE_LABELS[type];
    const cert = bid.certificates.find((c) => c.type === type);
    const group = type === 'falencia' ? 'economica' : 'fiscal';
    if (!cert) {
      checks.push({ id: `cert-${type}`, group, label, status: 'falha', detail: 'Não apresentada.', basis });
      continue;
    }
    const valid = new Date(`${cert.validUntil}T23:59:59`);
    const days = Math.floor((valid.getTime() - at.getTime()) / 86_400_000);
    checks.push({
      id: `cert-${type}`,
      group,
      label,
      status: days < 0 ? 'falha' : days <= 10 ? 'atencao' : 'ok',
      detail:
        days < 0
          ? `Vencida em ${valid.toLocaleDateString('pt-BR')}. Consulte o sítio oficial antes de inabilitar (diligência, art. 64).`
          : `Válida até ${valid.toLocaleDateString('pt-BR')}${days <= 10 ? ` — vence em ${days} dia(s); renove antes da assinatura` : ''}.`,
      basis,
    });
  }

  let indexes: QualificationResult['indexes'];
  const b = bid.balance;
  if (!b) {
    checks.push({ id: 'balanco', group: 'economica', label: 'Balanço patrimonial', status: 'falha', detail: 'Não apresentado.', basis: 'Art. 69, I' });
  } else {
    const debts = b.currentLiabilitiesCents + b.longTermLiabilitiesCents;
    const lg = debts ? (b.currentAssetsCents + b.longTermAssetsCents) / debts : Infinity;
    const sg = debts ? b.totalAssetsCents / debts : Infinity;
    const lc = b.currentLiabilitiesCents ? b.currentAssetsCents / b.currentLiabilitiesCents : Infinity;
    indexes = { lg: round2(lg), sg: round2(sg), lc: round2(lc) };
    const allOk = lg > rules.minIndex && sg > rules.minIndex && lc > rules.minIndex;
    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '∞');
    const detail = `LG ${fmt(lg)} · SG ${fmt(sg)} · LC ${fmt(lc)} (mínimo > ${rules.minIndex})`;
    if (allOk) {
      checks.push({ id: 'indices', group: 'economica', label: 'Índices contábeis', status: 'ok', detail, basis: 'Art. 69, §1º' });
    } else {
      const minEquity = rules.estimatedCents === null ? null : Math.round(rules.estimatedCents * rules.minEquityPercent);
      const equityOk = minEquity !== null && b.equityCents >= minEquity;
      checks.push({
        id: 'indices',
        group: 'economica',
        label: 'Índices contábeis',
        status: equityOk ? 'atencao' : 'falha',
        detail: equityOk
          ? `${detail}. Índice abaixo do mínimo, mas o patrimônio líquido supre a exigência alternativa de ${Math.round(rules.minEquityPercent * 100)}% do valor estimado.`
          : `${detail}. Índice abaixo do mínimo e patrimônio líquido insuficiente.`,
        basis: 'Art. 69, §1º e §4º',
      });
    }
    const year = at.getFullYear();
    if (b.year < year - 2) {
      checks.push({
        id: 'balanco-exercicio',
        group: 'economica',
        label: 'Exercício do balanço',
        status: 'falha',
        detail: `Balanço de ${b.year}: exigem-se os dois últimos exercícios sociais.`,
        basis: 'Art. 69, I',
      });
    }
  }

  const tech = bid.technicalCertificates ?? 0;
  checks.push({
    id: 'atestados',
    group: 'tecnica',
    label: 'Atestados de capacidade técnica',
    status: tech >= rules.minTechnicalCertificates ? 'ok' : 'falha',
    detail: `${tech} apresentado(s); exigido(s) ${rules.minTechnicalCertificates}.`,
    basis: 'Art. 67, II',
  });

  const active = sanctions.filter((s) => isActive(s, at));
  checks.push({
    id: 'sancoes',
    group: 'sancoes',
    label: 'Impedimentos (CEIS, CNEP e inidôneos TCU)',
    status: active.length ? 'falha' : 'ok',
    detail: active.length
      ? active.map((s) => `${s.registry}: ${s.sanction} — ${s.organ}, até ${s.endDate ?? 'prazo indeterminado'}`).join('; ')
      : sanctions.length
        ? `Somente sanções encerradas (${sanctions.length}).`
        : 'Nenhum registro encontrado.',
    basis: 'Art. 14; art. 91, §4º',
  });

  return {
    qualified: !checks.some((c) => c.status === 'falha'),
    checks,
    indexes,
    checkedAt: at.toISOString(),
  };
}
