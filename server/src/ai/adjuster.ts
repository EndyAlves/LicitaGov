import Anthropic from '@anthropic-ai/sdk';
import { CATEGORY_LABELS } from '../legal/clauses.js';
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

const DOC_NAME: Record<DocKind, string> = { etp: 'Estudo Técnico Preliminar', tr: 'Termo de Referência' };

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

const SYSTEM = `Você é um especialista em contratações públicas brasileiras que revisa documentos da fase preparatória segundo a Lei nº 14.133/2021, a IN SEGES/ME nº 65/2021 e a jurisprudência do TCU.

Você recebe um rascunho de ETP ou Termo de Referência e o relatório de conformidade gerado pelo sistema. Reescreva o documento completo:
- mantenha as informações e decisões do setor requisitante; não invente números, quantidades, valores, datas, marcas ou dotações — onde faltar dado, use um marcador entre colchetes, como [informar quantidade];
- inclua todas as seções obrigatórias ausentes, na ordem da lei, usando os textos sugeridos do relatório como base;
- corrija cada apontamento do relatório (ambiguidades, legislação revogada, cláusulas restritivas, termos subjetivos);
- use linguagem técnica e objetiva, com títulos numerados.

Responda somente com o texto final do documento, sem comentários antes ou depois.`;

/** Ajuste com Claude: reescreve o rascunho inteiro, preservando os fatos do requisitante. */
export class ClaudeAdjuster implements Adjuster {
  readonly engine = 'claude' as const;

  constructor(
    private readonly client: Anthropic = new Anthropic(),
    private readonly model = process.env.LICITAGOV_MODEL ?? 'claude-opus-5-5',
  ) {}

  async adjust(input: AdjustInput): Promise<AdjustResult> {
    const findings = input.report.findings
      .map((f) => `- [${f.severity}] ${f.message} (${f.basis})${f.excerpt ? `\n  Trecho: "${f.excerpt}"` : ''}${f.suggestion ? `\n  Texto sugerido: ${f.suggestion}` : ''}`)
      .join('\n');
    const prompt = [
      `Documento: ${DOC_NAME[input.kind]}`,
      `Objeto: ${input.object}`,
      `Categoria: ${CATEGORY_LABELS[input.category]}`,
      '',
      '<relatorio_de_conformidade>',
      findings || 'Sem apontamentos.',
      '</relatorio_de_conformidade>',
      '',
      '<rascunho>',
      input.text,
      '</rascunho>',
    ].join('\n');

    // Recusa por salvaguarda: o servidor refaz a chamada em outro modelo (fallback padrão).
    const stream = this.client.beta.messages.stream({
      model: this.model,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      max_tokens: 32000,
      output_config: { effort: 'high' },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      throw new Error('O modelo recusou o ajuste deste documento.');
    }
    const text = message.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (!text) throw new Error('O modelo não devolveu texto.');
    return {
      text,
      engine: this.engine,
      changes: input.report.findings.map((f) => `Tratado: ${f.message}`),
    };
  }
}

/** Usa o Claude quando há credencial configurada; caso contrário, o ajuste por regras. */
export function defaultAdjuster(): Adjuster {
  return process.env.ANTHROPIC_API_KEY ? new ClaudeAdjuster() : new RuleAdjuster();
}
