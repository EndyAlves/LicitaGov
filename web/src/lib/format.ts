import type { DocStatus, Phase, Role, Severity } from './api';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : brl.format(cents / 100));

/** Converte "1.234,56" ou "1234.56" em centavos. */
export function parseMoney(input: string): number {
  const clean = input.replace(/[^\d,.-]/g, '');
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  return Math.round(Number(normalized) * 100);
}

export const dateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
export const date = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

export const PHASE_LABEL: Record<Phase, string> = {
  planejamento: 'Planejamento',
  externa: 'Fase externa',
  contrato: 'Gestão do contrato',
  encerrado: 'Encerrado',
};

export const STATUS_LABEL: Record<DocStatus, string> = {
  rascunho: 'Rascunho',
  em_analise_juridica: 'No jurídico',
  aprovado: 'Aprovado',
  devolvido: 'Devolvido',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  bloqueante: 'Bloqueante',
  alerta: 'Alerta',
  sugestao: 'Sugestão',
};

export const ROLE_LABEL: Record<Role, string> = {
  requisitante: 'Requisitante',
  planejamento: 'Planejamento',
  agente: 'Agente de contratação',
  juridico: 'Jurídico',
  fiscal: 'Fiscal',
  gestor: 'Gestor',
};

export const initials = (name: string) =>
  name
    .replace(/^Dr\.?\s+/, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
