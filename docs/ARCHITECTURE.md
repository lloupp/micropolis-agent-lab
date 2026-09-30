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

Cada modelo deverá implementar semanticamente:

    decide(snapshot, availableActions, memory) -> action

A validação e a execução continuam fora do modelo.

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
