# micropolis-agent-lab

Laboratório para agentes de IA jogarem **Micropolis** com execução visual observável.

O projeto usa o MicropolisCore como simulador e injeta um painel de agente na interface web. O motor continua sendo o C++/WebAssembly do Micropolis; o agente apenas lê o estado, escolhe uma ação válida e a aplica pela API do simulador.

## MVP

- Micropolis visual no navegador.
- Agente `Rules` executando ações passo a passo.
- Botões **Iniciar**, **Pausar**, **1 passo** e **Preparar laboratório**.
- Painel com população, caixa, imposto, demandas R/C/I, crime, poluição e energia.
- Histórico das últimas decisões e resultado de cada ação.
- Cidade inicial determinística para facilitar comparação entre agentes.
- Estrutura preparada para NanoAndy, Laya e Julia-1.

## Requisitos

- Git
- Node.js 20+
- Corepack/pnpm

O Emscripten só é necessário se você quiser recompilar o motor C++/WASM. O fluxo normal usa os artefatos WASM já versionados no MicropolisCore.

## Executar

    npm run setup
    npm run dev

Abra:

    http://127.0.0.1:5173

Na lateral direita aparecerá o painel **Agent Lab**. Ao clicar em **Iniciar agente**, o laboratório é preparado automaticamente na primeira execução e o Rules começa a construir a cidade enquanto você assiste.

## Como funciona

    MicropolisCore (WASM + Svelte)
              |
              v
       leitura do estado
              |
              v
          Rules Agent
              |
              v
       ação determinística
              |
              v
      micropolis.poke.doTool
              |
              v
       cidade atualizada

O MicropolisCore é baixado em `.vendor/MicropolisCore` e fixado no commit definido em `config/upstream.json`. Os arquivos do agente são aplicados como um overlay local; não modificamos o repositório upstream.

## Desenvolvimento

    npm test
    npm run check
    npm run overlay

`npm run overlay` reaplica o painel no checkout local do MicropolisCore.

## Próximas etapas

1. Validar o Rules visualmente e ajustar o blueprint inicial.
2. Registrar métricas por episódio em JSONL.
3. Implementar replay.
4. Adicionar adapters NanoAndy, Laya e Julia-1.
5. Benchmark pareado usando a mesma seed, orçamento e horizonte de simulação.

## Upstream

MicropolisCore: https://github.com/SimHacker/MicropolisCore

Micropolis é baseado no código aberto do SimCity Classic e o código upstream é GPL-3.0. Este laboratório mantém o upstream separado em `.vendor` e não redistribui os arquivos do motor.
