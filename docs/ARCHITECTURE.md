# Arquitetura

## Objetivo

Permitir que diferentes agentes tomem decisões sobre a mesma simulação de Micropolis enquanto o usuário acompanha visualmente cada ação.

## Componentes

### MicropolisCore

Responsável por:

- simulação C++/WASM;
- mapa;
- economia;
- população;
- ferramentas de construção;
- renderização Svelte/WebGL.

O laboratório fixa uma revisão upstream para manter os experimentos reproduzíveis.

### Agent Panel

`AgentPanel.svelte` é somente a camada de observação e controle:

- inicia/pausa o agente;
- permite avançar uma decisão;
- mostra estado e histórico;
- ajusta o intervalo entre decisões.

### Runtime

`runtime.ts` é a fronteira entre agente e jogo.

Ele transforma o estado do Micropolis em um snapshot pequeno e aplica apenas ações autorizadas:

- construir;
- alterar imposto;
- esperar.

Modelos futuros não devem acessar o WASM diretamente.

### Rules

`rules.js` é o baseline determinístico. Primeiro executa um blueprint observável e depois reage a orçamento, crime e demanda.

A comparação futura deve manter:

- mesma cidade inicial;
- mesmo orçamento;
- mesma velocidade;
- mesmo número máximo de decisões;
- mesmos critérios de encerramento.

## Interface futura de modelos

O contrato comum é:

    decide(snapshot, availableActions, memory) -> decision

`overlay/agent/agents.js` valida a resposta por ID exato em `availableActions`.
O candidato inclui a ação estruturada já criada pelo laboratório; respostas não
podem inventar comandos nem coordenadas. No modo shadow, Rules executa primeiro
e continua sendo o único executor. Falha, timeout ou indisponibilidade do serviço
é registrada com fallback para a decisão Rules, sem pausar o simulador.

Julia-1 conecta pelo sidecar local (`npm run julia:sidecar`) configurado por
`JULIA_1_BASE_URL`, `JULIA_1_MODEL` e opcionalmente `JULIA_1_API_KEY`. O cliente
do navegador só envia snapshot, candidatos e memória; credenciais ficam no
sidecar. Sem endpoint configurado, o laboratório continua em Rules e registra
Julia como indisponível. `npm run verify:julia-shadow` executa 100 decisões
WASM reproduzíveis com mock determinístico, produzindo `artifacts/julia-shadow.jsonl`
e um resumo JSON. O mock não é apresentado como inferência real de Julia-1.

O snapshot enviado ao modelo inclui população R/C/I, caixa, imposto, tempo,
demanda, condições da cidade, zonas energizadas, cash flow, últimas ações,
resultado recente e falhas recentes. Registros anotam validação, concordância,
latência, loops e resultado real da ação Rules.

## Métricas planejadas

- população final;
- crescimento;
- caixa final;
- fluxo de caixa;
- city score;
- crime;
- poluição;
- trânsito;
- zonas energizadas;
- ações inválidas;
- falhas de construção;
- tempo por decisão;
- quantidade de decisões;
- loops/fallbacks.
