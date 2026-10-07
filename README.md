# LicitaGov — co-piloto de compras públicas (Lei 14.133/2021)

Os ERPs municipais tramitam o processo de um setor para outro. O LicitaGov cuida da **qualidade do conteúdo**: o
requisitante, o planejamento, o agente de contratação, o jurídico e o fiscal trabalham no mesmo processo, e cada
etapa tem um assistente que aponta, com o dispositivo legal, o que faz o TCE/TCU barrar a compra, gera impugnação ou
deixa a licitação deserta.

## Módulos

| Fase | Recurso | Como funciona |
| --- | --- | --- |
| Planejamento | **Análise de conformidade de ETP e TR** | Cruza o rascunho com os 13 elementos do art. 18, §1º (ETP) e os 10 do art. 6º, XXIII (TR). Faltar um dos obrigatórios do art. 18, §2º, bloqueia o documento; faltar os demais sem justificativa gera um alerta. Também aponta: parcelamento sem justificativa, **pagamento ambíguo** ("oportunamente", "conforme disponibilidade financeira"), lei revogada (8.666, 10.520, RDC), marca sem "ou equivalente" (art. 41), exigência de sede no município (art. 9º), vistoria obrigatória (art. 63), falta de reajuste (art. 25, §7º), exclusividade ME/EPP até R$ 80 mil, regras por objeto (agricultura familiar no PNAE, validade de perecíveis, conta vinculada em mão de obra exclusiva, LGPD em TI, ART/RRT em engenharia) e termos subjetivos. Cada apontamento traz o trecho do rascunho que o motivou e um texto sugerido. |
| | **Ajuste automático** | Gera uma versão corrigida do rascunho, que o servidor revisa antes de aceitar. Sem chave, usa regras e o banco de cláusulas. Com `ANTHROPIC_API_KEY`, o Claude reescreve o documento inteiro sem inventar números, valores ou dotações (os que faltam ficam `[entre colchetes]`). |
| | **Banco de cláusulas** | Blocos por categoria (merenda, expediente, limpeza, TI, engenharia, medicamentos) e seção, na estrutura dos modelos AGU/SEGES. O órgão deve cadastrar as versões aprovadas pela sua procuradoria (`legal/clauses.ts`). |
| | **Pesquisa de preços** | Importa preços do Painel de Preços (API de dados abertos do Compras.gov.br, por código CATMAT) e aceita as demais fontes do art. 23, §1º. Descarta preços desatualizados (fornecedor com mais de 6 meses; demais fontes com mais de 12), inexequíveis e excessivos (limites em relação à mediana, configuráveis). Usa a média quando o coeficiente de variação é de até 25% e a mediana acima disso, e emite o relatório do valor estimado. |
| | **Tramitação com travas** | O documento só vai ao jurídico sem pendências bloqueantes. O TR depende do ETP aprovado. Documento aprovado não pode ser editado. O jurídico aprova ou devolve com parecer. |
| Externa | **Matriz de riscos** | Mapeia os riscos pelo objeto e pelas características do processo (perecíveis, mão de obra exclusiva, poucos fornecedores, prazo curto, obra, SRP), com probabilidade × impacto, alocação e cláusula de mitigação. Marca como obrigatória nos casos do art. 22, §3º. |
| | **Minuta do edital** | Monta a minuta com os dados do TR aprovado (pagamento, entrega, reajuste), do valor estimado e da matriz de riscos, com o checklist do art. 25. Só é liberada com ETP e TR aprovados e valor estimado. |
| | **Co-piloto de habilitação** | Confere dígitos do CNPJ, validade das certidões na data do julgamento (avisa as que vencem em até 10 dias), LG/SG/LC com a alternativa de patrimônio líquido do art. 69, §4º, atestados e impedimentos no **CEIS/CNEP** (API do Portal da Transparência). Também respeita a ordem de classificação na adjudicação. |
| Contrato | **Contrato / Ata de Registro de Preços** | Preenchidos com a proposta vencedora, os preços por item, a vigência, a dotação, o fiscal designado e a matriz de riscos. |
| | **Painel do fiscal (mobile)** | Registro de ocorrências em campo com foto da câmera (reduzida no aparelho), localização e glosa pelo IMR. Emite os termos de recebimento provisório e definitivo (art. 140, inciso conforme compra ou serviço). O definitivo exige o provisório do mesmo período, e cada glosa entra uma só vez. |
| Gestão | **Painel e trilha de auditoria** | Processos por fase, pendências bloqueantes, erros mais frequentes (para orientar a capacitação dos setores) e histórico de cada ação. |

## Rodando

```bash
npm install
npm run dev        # API em :3334 e app em http://localhost:5174
# produção
npm run build && npm start   # http://localhost:3334
```

Use o seletor no topo para trocar de servidor (requisitante, planejamento, agente de contratação, jurídico, fiscal,
gestor). A prefeitura de demonstração traz três processos:

1. **Merenda escolar**: rascunhos de ETP e TR com os erros mais comuns. Experimente "Ajustar automaticamente".
2. **Material de expediente**: planejamento aprovado, edital gerado e três propostas. Uma empresa está no CEIS, outra
   tem a CNDT vencida e a terceira é habilitada.
3. **Limpeza das UBS**: contrato assinado e em fiscalização. Abra como *Elisa Prado* no celular.

### Verificador de ETP e TR (site separado)

```bash
npm run dev:checker         # http://localhost:5175
npm run build -w checker    # gera checker/dist, página estática
```

Só a análise de conformidade, para conferir um ETP ou TR antes de mandar ao jurídico: cole o texto ou envie um
`.docx`/`.txt` e veja os elementos exigidos, os apontamentos com o artigo e o texto sugerido, e copie o relatório.
Cada apontamento com sugestão tem um botão que aplica a correção no texto (seção ausente entra na posição do roteiro
legal; trecho problemático é substituído), com opção de desfazer. "Criar .docx corrigido" gera o arquivo a partir do
`.docx` enviado: parágrafos inalterados ficam idênticos, os alterados mudam só no trecho editado e os novos copiam a
formatação de um vizinho do mesmo tipo (`checker/src/docx.ts`).

**Analista jurídica (IA).** Aberto no Claude, o verificador pede ao Claude uma análise no papel da assessoria jurídica
(`checker/src/analyst.ts`): o documento vai com as linhas numeradas, junto com os elementos exigidos e os apontamentos
automáticos. A resposta traz conclusão (apto, apto com ressalvas, não apto), resumo, apontamentos automáticos que
na verdade estão atendidos e até 15 correções, cada uma com fundamento, análise do risco, texto adaptado ao documento e
o lugar exato (substituir trecho ou linha, inserir antes ou depois de uma linha). As propostas são localizadas pelo
conteúdo da linha, então continuam aplicáveis depois de outras edições. "Inserir no texto" de um apontamento automático
usa a proposta da analista quando ela existe. Usa a conta de quem abre a página; fora do Claude, o recurso fica oculto.
Usa o mesmo motor de `server/src/legal`, roda inteiro no navegador (o texto não sai do computador) e guarda o
rascunho só no navegador de quem usa.

### Versão de demonstração (sem servidor)

```bash
npm run build:demo -w web   # gera web/dist-demo
```

Gera uma página estática em que a API roda dentro do navegador, com o mesmo código de domínio e os dados de
demonstração (`web/src/lib/localBackend.ts`). Serve para hospedar em qualquer lugar estático. As alterações valem
só na aba aberta: somem ao recarregar e não chegam a outras pessoas. O ajuste com IA e as consultas reais de preços e
sanções não funcionam nesse modo.

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3334` | Porta HTTP |
| `ANTHROPIC_API_KEY` | — | Ativa o ajuste de documentos com o Claude |
| `LICITAGOV_MODEL` | `claude-opus-5-5` | Modelo usado no ajuste |
| `LICITAGOV_LIVE_PRICES` | `false` | `true` consulta a API real do Compras.gov.br |
| `PORTAL_TRANSPARENCIA_KEY` | — | Chave da API do Portal da Transparência para consultar CEIS/CNEP de verdade |
| `LICITAGOV_ORG` | `PREFEITURA MUNICIPAL DE EXEMPLO` | Nome do órgão nos documentos |
| `DEMO_SEED` | `true` | Carrega os processos de demonstração |

```bash
npm test           # regras legais, preços, habilitação, riscos e fluxo completo pela API
npm run typecheck
```

## Arquitetura

```
server/src
├── legal/
│   ├── requirements.ts   # elementos do ETP (art. 18) e do TR (art. 6º, XXIII)
│   ├── compliance.ts     # motor de conformidade determinístico e explicável
│   └── clauses.ts        # banco de cláusulas por categoria e seção
├── domain/
│   ├── pricing.ts        # tratamento estatístico da pesquisa de preços (IN 65/2021)
│   ├── risks.ts          # matriz de riscos (art. 22)
│   ├── qualification.ts  # habilitação: certidões, índices, atestados, sanções
│   ├── documents.ts      # edital, contrato/ata e termos de recebimento
│   └── processService.ts # fases, travas, papéis e auditoria
├── ai/adjuster.ts        # ajuste por regras ou com Claude
├── connectors/           # Painel de Preços (Compras.gov.br) e CEIS/CNEP (Portal da Transparência)
├── http/app.ts           # API REST
└── seed.ts               # prefeitura de demonstração
web/src                   # React: painel, editor com análise, preços, habilitação e fiscal mobile
```

### Levando para produção

- **Regras e cláusulas** ficam em código versionado e testado. Revise-as com a procuradoria e ajuste-as ao
  regulamento local (decreto municipal de licitações, IN estaduais) antes de usar em processos reais. A ferramenta
  apoia a análise; não substitui o parecer jurídico do art. 53.
- **Conectores reais:** configure `LICITAGOV_LIVE_PRICES` e `PORTAL_TRANSPARENCIA_KEY`. A consulta ao cadastro de
  inidôneos do TCU e à base de notas fiscais entram como novos `SanctionsConnector`/`PriceConnector`.
- **Persistência e autenticação:** troque o `MemoryStore` por um banco com os mesmos métodos, e o cabeçalho
  `x-user-id` por login gov.br/SSO. As fotos do fiscal devem ir para armazenamento de objetos, não para o JSON.
- **Integrações:** publicação no PNCP (art. 94) e envio ao ERP de tramitação a partir dos eventos da trilha de auditoria.
