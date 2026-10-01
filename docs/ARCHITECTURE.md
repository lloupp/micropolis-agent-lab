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

Julia-1 usa o runtime nativo `SupersonicLabs/Julia-1` (144M parâmetros, escolha
finita), não uma API de chat. Modelo/revisão/SHA-256 ficam em
`overlay/agent/julia-model.json`. O sidecar verifica os pesos ao iniciar e cada
resposta carrega a identidade e um contador de inferência. O cliente rejeita
respostas sem essa identidade. Isso confirma o runtime local controlado; um
endpoint externo precisa ser operado por alguém confiável, pois a identidade
HTTP não constitui prova criptográfica de execução remota.

O observer recebe cópias de snapshot/candidatos/resultado Rules, sem referência
ao engine. Rules executa imediatamente; a fila de inferência não bloqueia o
simulador. Reset cancela respostas da execução anterior. Falhas de preparação,
rede, contexto e modelo produzem registros recuperáveis. Nenhuma sugestão Julia
é executada. O headless usa o mesmo observer do painel.

Veja [JULIA.md](JULIA.md) para instalação e benchmark real. O mock é exclusivo
de testes, opt-in por `--mock`, com diretório separado e agregação que rejeita
fontes misturadas.
