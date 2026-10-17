# Mindustry Agent Lab (fase M0)

Nova integracao **separada** dentro do mesmo repositorio do Micropolis. O codigo antigo permanece intacto.

## Objetivo

Conectar um servidor dedicado real do Mindustry a um controlador de agentes, registrar estados por episodio, e depois introduzir acoes de construcao verificaveis e treinamento. **M0 e somente leitura:** nao joga, nao constroi e nao treina modelos.

## Alvo fixado

- Mindustry **v160.7** (server e dependencies.jar da mesma release).
- Plugin Java 17+, iniciado no servidor dedicado.
- Node.js 20+ para observador (sem pacotes npm extras).
- API HTTP somente leitura em **127.0.0.1:8766**.

## Inicializacao

1. Baixe server-release.jar da release v160.7 em https://github.com/Anuken/Mindustry/releases/tag/v160.7
2. Entre em mindustry/plugin e execute **gradle jar** (Gradle instalado localmente; o projeto nao inclui wrapper).
3. Copie **mindustry/plugin/build/libs/mindustry-agent-lab-plugin.jar** para a pasta **config/mods/** usada pelo servidor.
4. Inicie o servidor: **java -Xms256m -Xmx1024m -jar server-release.jar**. No console, use **host** para carregar um mapa.
5. Verifique o servidor do observador: **curl http://127.0.0.1:8766/v1/health**.
6. Entre em **mindustry/controller** e execute **node observe.mjs --once** ou **node observe.mjs > episodes.jsonl**.
7. Execute **node --test** para os testes do contrato.

O comando **agentlab** no console do servidor mostra o ultimo snapshot capturado. A opcao JVM **-Dmindustry.agentlab.port=8766** muda a porta; nao publique a porta em uma rede externa.

## Contrato M0

- GET /v1/health: identificacao do plugin; nao confirma carregamento do mapa.
- GET /v1/state: JSON com schemaVersion=1, ready, mapa, wave, ticks, status do jogo e recursos basicos do nucleo.
- Dados do jogo sao coletados na thread do simulador e servidos como copia imutavel.
- Nenhum POST, nenhum comando de construcao e nenhuma invocacao do agente.
- O observador registra estados reais em JSONL, mas nao produz benchmark de qualidade ou recompensas.

## Proximos marcos (ainda nao feitos)

- **M1:** acoes legais tipadas, autenticadas, em fila, executadas no game thread por unidades construtoras; retorno de resultado e idempotencia.
- **M2:** Rules real no ambiente de jogo, mapa inicial reproduzivel e baseline.
- **M3:** Bonsai local e Julia em modo shadow; mesmo estado, candidatos e metrica.
- **M4:** episodios, rewards auditaveis, validacao de melhora e treinamento fora do processo do jogo.

Nao misturar snapshots passivos M0 com evidencia de agentes que jogaram. Nenhum resultado do Micropolis deve ser rotulado como resultado Mindustry.
