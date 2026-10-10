# Desenvolvimento — 10/10/2026

## Estado e arquitetura

Base: main `e04ce5ab8d6e55d1cf45b63e03ba8ab3026ce6dd`.
Branch: `fix/julia-sidecar-request-validation`, destinada a main via PR, sem merge.
Laboratório para comparar agentes no Micropolis, voltado a experimentação observável.
MicropolisCore C++/WASM fixado em `config/upstream.json`; interface Svelte
aplicada por overlay; Rules determinístico; Julia Python/PyTorch via HTTP local.
Sem banco de dados ou autenticação de usuários. O sidecar deve permanecer local
ou atrás de túnel confiável. Identidade HTTP externa não comprova inferência.

PRs #6 e #7 continuam em draft: os respectivos experimentos espaciais falharam
nos critérios congelados. Esta branch não importa esses experimentos nem altera
Rules, geração de candidatos, pesos, classificadores ou critérios de aceite.

## Concluído e verificado

- Validação de históricos como listas, fundos numéricos finitos e contexto JSON
  serializável, com erros recuperáveis antes de chamar o modelo.
- Rejeição de NaN/Infinity, framing ambíguo, corpo truncado e requisição excessiva.
- Prazo de 5 segundos de inatividade para ler cabeçalhos/corpo HTTP. Timeout
  no corpo retorna 408; entradas inválidas retornam 422. Não limita computação.
- Cancelamento do observer aborta HTTP ativo, suprime resultados antigos e
  impede chamadas da fila cancelada. Cancelamento do chamador não conta como
  timeout no cliente. PyTorch já iniciado pode continuar no serviço.
- Testes reproduziram as falhas antes das correções e passaram depois delas.
- `npm run check`: 24 testes JavaScript e 7 Python aprovados, incluindo sockets
  HTTP reais com runtime de teste (não inferência Julia).
- `npm run verify:reset`: passou para todas as 16 fases do motor WASM.
- `npm run verify:julia-shadow:mock`: 100 decisões/100 sugestões válidas, zero
  inferências reais; Rules final com população 3360, caixa 15358 e cityTime 244.
  Reexecutado após alteração de cancelamento. Não representa qualidade da Julia.

## Limitações e auditoria

- `npm run smoke:julia-real` executado: bloqueado por
  `unavailable / connection_error`; sem serviço/checkpoint residente neste ambiente.
  Não há nova medição de qualidade ou latência real da Julia.
- Testes do ciclo de vida do painel ainda incluem verificações estáticas; uma
  interação completa no navegador não foi validada neste ciclo.
- Falhas comprovadas: fila/retensão shadow sem limite; memória Rules avança
  mesmo após construção malsucedida; primeira execução do painel prepara/reset
  a cidade automaticamente; métricas ausentes aparecem como zero.
- Risco provável: sessões longas com inferência lenta acumulam snapshots e
  registros; callbacks copiam todos os registros. Não foi medida exaustão de RAM.
- Integrações: checkout upstream fixado, pesos Julia fixados por revisão/hash e
  CI GitHub Actions. Não há evidência de produção ou migração de dados.
- UX: falta visibilidade da fila/serviço e exportação de episódios no painel.
  Confiabilidade, segurança de entrada e isolamento foram priorizados neste ciclo.

## Backlog

| Prioridade | Problema / oportunidade | Solução e impacto | Esforço | Dependência | Aceite e validação |
| --- | --- | --- | --- | --- | --- |
| P1 | Shadow acumula fila e registros em sessões longas | Limites explícitos, métricas de pendências e backpressure; reduzir memória sem ocultar perdas | Médio | Preservar completude do benchmark e contagem de falhas | Serviço lento não bloqueia Rules; fila tem teto; toda perda é registrada; benchmark mantém 100 decisões e mesma cidade |
| P1 | Julia não seleciona construções plausíveis nas PRs #6/#7 | Próximo experimento com representação factual compacta; medir seleção sem retunar gates | Alto | Serviço Julia real e base experimental isolada | 100 inferências reais pareadas; todos os obrigatórios e pelo menos 3 melhorias passam |
| P1 | Memória Rules avança após falha de execução | Atualização baseada em ExecutionResult; evitar marcar polícia não construída | Médio | Branch separada; não mudar baseline dos experimentos existentes | Teste de construção falha seguido de nova tentativa; novo baseline WASM registrado |
| P2 | Preparação inicial substitui cidade sem clareza | Explicitar reset antes de iniciar; proteger cidade do usuário | Médio | Fluxo de preparação/pausa | Teste em navegador com cidade prévia, Iniciar/1 passo/Preparar laboratório |
| P2 | Painel não mostra fila/serviço nem exporta evidências | Estado de serviço, pendências e exportação JSONL; distinguir ausência de métrica | Médio | Política da fila | Exportação corresponde ao episódio; indisponibilidade visível; sem mistura real/mock |
| P2 | Cobertura visual/lifecycle limitada | Testes de interação com request pendente e desmontagem | Médio | Ambiente browser com upstream instalado | Reset/pausa/desmontagem sem callbacks antigos ou erros JS |

## Retomada

Executar `npm run setup`, `npm run check`, `npm run verify:reset` e
`npm run verify:julia-shadow:mock`. Para avaliar Julia: instalar com
`npm run julia:setup`, iniciar o sidecar, executar smoke e benchmark reais.
Próximo ciclo: limitar fila/retensão preservando evidência completa; depois,
retomar representação espacial numa branch experimental. Merge e produção
dependem de autorização explícita. Nenhum resultado deste ciclo autoriza Julia
a executar ações no simulador.
