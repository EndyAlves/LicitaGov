import { requirementsFor } from '../legal/requirements.js';
import type { ComplianceReport, DocKind, ObjectCategory } from '../domain/types.js';

export interface AdjustInput {
  kind: DocKind;
  text: string;
  report: ComplianceReport;
  category: ObjectCategory;
  object: string;
}

export interface AdjustResult {
  text: string;
  engine: 'regras' | 'claude';
  changes: string[];
}

export interface Adjuster {
  readonly engine: AdjustResult['engine'];
  adjust(input: AdjustInput): Promise<AdjustResult>;
}

export const DOC_NAME: Record<DocKind, string> = { etp: 'Estudo Técnico Preliminar', tr: 'Termo de Referência' };

/**
 * Ajuste determinístico: acrescenta as seções ausentes com o texto do banco de
 * cláusulas e anexa as correções pontuais como notas de revisão. Não depende
 * de rede e serve de base quando a IA não está configurada.
 */
export class RuleAdjuster implements Adjuster {
  readonly engine = 'regras' as const;

  async adjust({ kind, text, report }: AdjustInput): Promise<AdjustResult> {
    const changes: string[] = [];
    const additions: string[] = [];
    const reqs = requirementsFor(kind);
    for (const f of report.findings) {
      if (!f.suggestion) continue;
      const missing = f.id.startsWith('falta-') ? reqs.find((r) => `falta-${r.key}` === f.id) : undefined;
      if (missing) {
        additions.push(`${missing.label.toUpperCase()} [SUGERIDO — ${missing.basis}]\n${f.suggestion}`);
        changes.push(`Seção incluída: ${missing.label}`);
      } else {
        additions.push(`[REVISAR — ${f.basis}] ${f.message}\nTexto sugerido: ${f.suggestion}`);
        changes.push(`Correção sugerida: ${f.message}`);
      }
    }
    if (!additions.length) return { text, engine: this.engine, changes: ['Nenhum ajuste necessário.'] };
    return {
      text: `${text.trimEnd()}\n\n${'-'.repeat(12)} AJUSTES SUGERIDOS PELO LICITAGOV ${'-'.repeat(12)}\n\n${additions.join('\n\n')}\n`,
      engine: this.engine,
      changes,
    };
  }
}
