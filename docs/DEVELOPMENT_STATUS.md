# Desenvolvimento — 10/10/2026

## Estado e arquitetura

Base deste ciclo: PR #8 `cce789b0db65d070419964215e575fd50d08e9b4`.
Main permanece em `e04ce5ab8d6e55d1cf45b63e03ba8ab3026ce6dd`.
Branch: `feat/bounded-shadow-observer`, PR dependente da #8, sem merge.
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
- Fila explícita com admissão antes da cópia do snapshot. Limites padrão:
  128 solicitações pendentes (inclui ativa), 512 registros retidos. Painel:
  32 pendentes/200 registros. Rejeição por lotação não bloqueia Rules.
- Contadores de solicitações submetidas/aceitas/concluídas/descartadas/canceladas,
  retenção e remoções. Callback `onDrop` entrega cada decisão rejeitada, sem
  manter uma segunda fila ilimitada. Cancelar libera imediatamente a fila.
- Painel distingue métricas da janela de totais de sessão; mostra pendências,
  descartes e último número de decisão descartada. p95 ausente aparece como —.
- Contagem de repetição consecutiva permanece correta após remoção de registros;
  callbacks e leitores recebem cópias que não podem corromper evidências internas.
- Adaptador customizado malformado produz erro recuperável e a fila continua.
- `npm run check`: 31 testes JavaScript e 7 Python aprovados, incluindo sockets
  HTTP reais com runtime de teste (não inferência Julia).
- `npm run verify:reset`: passou para todas as 16 fases do motor WASM.
- `npm run verify:julia-shadow:mock`: 100 decisões/100 sugestões válidas, zero
  inferências reais; Rules final com população 3360, caixa 15358 e cityTime 244.
  Sem descarte/remoção/cancelamento; capacidade incluída no resumo e verificada
  pelo runner antes de aceitar o benchmark. Não representa qualidade da Julia.
- `npm run verify:shadow-capacity`: dois episódios WASM reais com 100 decisões
  cada; cenário lento admite 2, descarta 98 e retém 1 após remover 1 registro.
  Rules termina antes de qualquer resposta lenta. As 100 ações, snapshot final
  e SHA-256 do mapa são idênticos ao cenário rápido. Nenhuma inferência real.
  Evidência: `docs/evidence/shadow-capacity-2026-10-10.json`.
- Svelte: zero erros, três avisos em arquivos upstream/configuração.
- Testes de saturação e retenção: 1.000 rejeições contabilizadas e 1.000
  avaliações mantendo apenas dois registros, sem interromper memória do modelo.

## Limitações e auditoria

- `npm run smoke:julia-real` executado no ciclo anterior: bloqueado por
  `unavailable / connection_error`; sem serviço/checkpoint residente neste ambiente.
  Não há nova medição de qualidade ou latência real da Julia.
- Interação visual: implementada e verificada por Svelte; navegador não validado.
  Playwright não encontrou Chromium e a tentativa de instalação falhou com
  download inválido (`End of central directory record signature not found`).
  Servidor Vite inicializou, mas isso não comprova o fluxo visual.
- Falhas comprovadas ainda pendentes: memória Rules avança
  mesmo após construção malsucedida; primeira execução do painel prepara/reset
  a cidade automaticamente.
- Limites de quantidade foram testados; não houve profiling de consumo de RAM.
- Integrações: checkout upstream fixado, pesos Julia fixados por revisão/hash e
  CI GitHub Actions. Não há evidência de produção ou migração de dados.
- UX: exportação de episódios e diagnóstico detalhado do serviço seguem pendentes.
  Confiabilidade, segurança de entrada e isolamento foram priorizados neste ciclo.

## Backlog

| Prioridade | Problema / oportunidade | Solução e impacto | Esforço | Dependência | Aceite e validação |
| --- | --- | --- | --- | --- | --- |
| Concluído | Shadow acumula fila e registros em sessões longas | Limites explícitos, pendências, contadores e eventos de descarte | Médio | PR #8 | Testes unitários e comparação WASM passaram; benchmark padrão completo |
| P1 | Julia não seleciona construções plausíveis nas PRs #6/#7 | Próximo experimento com representação factual compacta; medir seleção sem retunar gates | Alto | Serviço Julia real e base experimental isolada | 100 inferências reais pareadas; todos os obrigatórios e pelo menos 3 melhorias passam |
| P1 | Memória Rules avança após falha de execução | Atualização baseada em ExecutionResult; evitar marcar polícia não construída | Médio | Branch separada; não mudar baseline dos experimentos existentes | Teste de construção falha seguido de nova tentativa; novo baseline WASM registrado |
| P2 | Preparação inicial substitui cidade sem clareza | Explicitar reset antes de iniciar; proteger cidade do usuário | Médio | Fluxo de preparação/pausa | Teste em navegador com cidade prévia, Iniciar/1 passo/Preparar laboratório |
| P2 | Exportação e diagnóstico detalhado do serviço incompletos | Exportação JSONL e estados do serviço; fila/janela já implementadas | Médio | Definir exportação completa versus janela | Exportação identifica descartes/remoções e limites; sem mistura real/mock |
| P2 | Cobertura visual/lifecycle limitada | Testes de interação com request pendente e desmontagem | Médio | Ambiente browser com upstream instalado | Reset/pausa/desmontagem sem callbacks antigos ou erros JS |

## Retomada

Executar `npm run setup`, `npm run check`, `npm run verify:reset` e
`npm run verify:julia-shadow:mock` e `npm run verify:shadow-capacity`. Para avaliar Julia: instalar com
`npm run julia:setup`, iniciar o sidecar, executar smoke e benchmark reais.
Próximo ciclo: corrigir atualização de memória Rules após falha em branch
separada, com novo baseline explícito; retomar representação espacial quando
o serviço Julia real estiver disponível. Merge e produção
dependem de autorização explícita. Nenhum resultado deste ciclo autoriza Julia
a executar ações no simulador.
