# Evidência semantics-v3

O braço chamado `v2` no replay é o encoding `semantics-v3`, confirmado em cada
proveniência. `v1` é o controle `distances-v1`. JSONL `.gz` é comprimido sem perdas;
use `gzip -dc arquivo.jsonl.gz` para ler. Fonte: os mesmos 100 estados e candidatos
históricos de spatial-v1; hash no report. Não misturar v2 rejeitado com v3 válido.

| Métrica | Controle distances-v1 | Compacto semantics-v3 |
|---|---:|---:|
| Inferências reais/válidas | 100/100 | 100/100 |
| Inválidas/erros/timeouts | 0/0/0 | 0/0/0 |
| Plausibilidade | 78% | 45% |
| Construções plausíveis | 3/25 | 0/55 |
| Ações neutras | 75 | 45 |
| Loops | 33 | 29 |
| Agreement exato | 3% | 0% |
| Agreement por intenção | 3% | 18% |
| Repetição consecutiva | 69% | 57% |
| Bloqueadas | 0 | 0 |
| Média / p95 | 495.75 / 830.54 ms | 567.74 / 951.95 ms |

Apenas loops e bloqueadas atingem metas (2/6). Plausibilidade <80%, média >550ms e
p95 >650ms reprovam o novo encoding. O controle também excede p95 neste ambiente;
latências não são diretamente comparáveis às do hardware histórico. Limites do
usuário permanecem congelados, sem ajuste para acomodar esta execução.

Auditoria com o tokenizer nativo: todos os 100 estados passam encoding lossless,
opções <=41 tokens (contrato <=48), sequência <=841 tokens. Isso não é inferência.

Diagnóstico: 41/100 estados tinham ao menos uma construção candidata plausível.
Julia selecionou zero delas; todas as 55 construções escolhidas foram implausíveis.
A plausibilidade de 45% vem inteiramente de tax/wait. As descrições semânticas
compactas não resolveram a escolha entre candidatos. Não ajustar classificador,
Rules ou candidatos para reinterpretar esse experimento como sucesso.

Próximo objetivo: caracterizar seleção por tipo de candidato em um conjunto de
validação separado e testar uma representação factual estruturada pré-auditada,
sem rótulo de preferência Rules, mantendo controle e critérios congelados.
Exigir recuperação de plausibilidade e seleção de construções antes de habilitar
qualquer execução Julia. Este experimento não deve ser merged.

## Verificação com motor vivo

Executada uma única vez, sem ajuste do encoding após o replay. Comparação nativa
sem contexto versus semantics-v3: 100 inferências reais por braço; 200 IDs únicos.
Os 100 estados/candidatos vivos são idênticos aos históricos (comparação JSON).
Julia reproduziu exatamente as métricas de escolha do replay. Rules completou
antes de Julia e foi o único executor: mapa/snapshot iguais após o drain;
3.360 habitantes, caixa $15.358, cityTime/simCycle 244.

Latência v3 viva: média 556.73ms / p95 878.92ms; baseline sem contexto
427.09ms / 557.78ms. Nenhuma falha, inválida ou timeout.

`live-report.json` é a saída bruta, que conserva checks como pendentes por padrão.
`verified-evaluation.json` registra avaliação com evidência real de testes/check,
CI no SHA do código de execução e isolamento. Resultado: REGRESSÃO.
A PR permanece em draft e sem merge.
