# Mindustry Agent Lab (M0 observação + M1 construção autenticada)

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

## Windows - instalar, abrir e observar com PowerShell

O instalador oficial da branch principal [Iniciar-MindustryAgentLab.ps1](windows/Iniciar-MindustryAgentLab.ps1) baixa
os JARs do Mindustry v160.7, confere seus SHA-256 oficiais, compila o plugin,
instala o servidor numa pasta isolada, abre o cliente grafico e inicia
o observador PowerShell que grava JSONL. Se nao houver JDK 17+, baixa uma
distribuicao portatil do Eclipse Temurin e valida o checksum informado pela API.

Abra **Windows PowerShell** (usuario comum, sem admin) e execute:

```powershell
$arquivo = Join-Path $env:TEMP 'Iniciar-MindustryAgentLab.ps1'
Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/lloupp/micropolis-agent-lab/main/mindustry/windows/Iniciar-MindustryAgentLab.ps1' -OutFile $arquivo
powershell.exe -NoProfile -ExecutionPolicy Bypass -File $arquivo
```

O servidor inicia automaticamente com o comando `host` (mapa Survival aleatorio),
sem necessidade de digita-lo. No cliente, abra **Play > Join Game** e conecte
a `127.0.0.1:6567`. A API do plugin responde em
`http://127.0.0.1:8766/v1/state`.

Pasta de instalacao: `%LOCALAPPDATA%\MindustryAgentLab`.
Observacoes: `%LOCALAPPDATA%\MindustryAgentLab\episodes\mindustry-observations.jsonl`.

Opcional: adicione `-NoClient`, `-NoObserver` ou `-InstallOnly` para
nao abrir a interface, nao abrir o monitor, ou somente instalar, respectivamente.
`-InstallDir 'D:\MindustryAgentLab'` muda o destino.
Para parar o servidor, use o comando `exit` em seu console. Fecha-lo nao
remove a instalacao; execute o mesmo script para reiniciar.

**Limitacao M0:** a API e apenas leitura e nao constitui um agente jogando.
Somente o servidor e o cliente reais podem validar a comunicacao ao vivo.

## Preflight verificavel para a fase M1 (ainda somente leitura)

Com o servidor iniciado, execute no repositorio:

```powershell
node mindustry/controller/readiness-check.mjs
```

O comando consulta 3 snapshots reais de `127.0.0.1:8766/v1/state`, verifica
partida Survival ativa, core existente, mapa estável, waves não regressivas e
avanço de tick. Falha com código não zero quando o jogo está indisponível,
parado ou inconsistente. **Não envia comandos ao jogo e não é evidência de
agente jogando**. O workflow de Windows valida o mesmo preflight contra o
servidor real iniciado na CI, além do build Java e dos testes Node.

A opção `-RepositoryRef` no instalador serve para validar branches de PR na
CI; por padrão o código é obtido da `main`. No PC do usuário não é necessário
informar essa opção. O ambiente Windows físico ainda requer validação própria.

A implementação M1 (futura) precisa de: identificadores de ação idempotentes,
autorização local explícita, fila limitada, execução apenas na thread do jogo
com uma unidade construtora legal, resultados por ID, rejeição de replay, e
rollback seguro em caso de reset/partida nova. Nenhum endpoint de escrita deve
ser exposto sem esses controles e testes de integração reais.

## Validação próxima do PC local (Windows, 2 núcleos, heap limitado)

Consulte [PC_VALIDATION.md](PC_VALIDATION.md) para validar o servidor real
em **Windows PowerShell 5.1 ou Linux Mint**, com CPU/JVM limitadas,
benchmark de ticks/latência/memória, opção de abrir o cliente gráfico no PC
e relatórios JSON. Os workflows GitHub Actions executam testes headless
independentes em Windows e Ubuntu, sem reproduzir os 8 GB físicos nem a GPU Intel HD 620.


## M1 — ordens autenticadas de construção (operador explícito)

No M1, o plugin aceita ordens para conveyor/router/junction somente com token
MINDUSTRY_AGENT_TOKEN com 32–128 caracteres base64url. Sem token, o servidor
permanece somente leitura e rejeita POST. O plugin escuta apenas 127.0.0.1.
Nunca grave o segredo no Git ou logs. Defina-o antes de iniciar o servidor:

Linux Mint:

    export MINDUSTRY_AGENT_TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"

Windows PowerShell:

    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $env:MINDUSTRY_AGENT_TOKEN = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
    $rng.Dispose()

Em outro terminal, informe o MESMO token de forma privada e execute
(com Node 20+, servidor rodando e uma unidade construtora BuilderAI ociosa):

    node mindustry/controller/build.mjs conveyor 20 25 0 --execute

Sem --execute, o cliente não envia nenhuma ordem. A API exige token Bearer
tanto em POST /v1/build quanto em GET /v1/commands/ID.

Contrato: ID de 1–48 caracteres alfanuméricos, underscore ou hífen;
blocos permitidos conveyor/router/junction; coordenadas inteiras e rotação
0–3. HTTP 202 significa enfileirado, nunca construído; HTTP 200 com o
mesmo ID e conteúdo retorna o status anterior; HTTP 409 se o mesmo ID tiver
parâmetros diferentes; outras rejeições HTTP são explícitas.

O motor valida posição e recursos na game thread, seleciona uma unidade
da própria equipe com BuilderAI e envia um BuildPlan normal. GET retorna
queued, assigned, completed, rejected, canceled ou failed.
Somente completed significa bloco realmente observado no mapa, construído
por uma unidade real. Sem construtora, recursos ou local válido: rejected.
A fila admite 16 ordens e retém até 128 IDs por episódio. Após o limite,
rejeita novas ordens em vez de perder idempotência ou evidências.
Novo mapa cancela ordens pendentes e um build sem conclusão pode expirar.

O CI real (mindustry/integration/m1_live.py) usa um cenário de teste
EXCLUSIVO do GitHub Actions, ativado pela propriedade
mindustry.agentlab.ciFixture=true, que cria uma Poly genuína com BuilderAI
e coloca cobre/chumbo no núcleo. Isso prepara o cenário, mas não instala
o bloco diretamente: o teste exige que a Poly conclua uma construção pelo
motor original do Mindustry. Esse teste não comprova automação autônoma,
jogabilidade em GPU Intel HD 620 ou qualidade da estratégia.

Próximo marco M2: implementar escolha autônoma de construções e avaliação
reproduzível no Mindustry, sem transferir métricas de Micropolis.
