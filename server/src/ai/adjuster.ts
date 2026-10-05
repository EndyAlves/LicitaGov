import Anthropic from '@anthropic-ai/sdk';
import { CATEGORY_LABELS } from '../legal/clauses.js';
import { DOC_NAME, RuleAdjuster, type AdjustInput, type AdjustResult, type Adjuster } from './ruleAdjuster.js';

export { RuleAdjuster, type AdjustInput, type AdjustResult, type Adjuster };

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
