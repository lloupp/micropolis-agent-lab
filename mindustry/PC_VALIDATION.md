# Perfil de validação semelhante ao PC local

Objetivo: aproximar o teste GitHub Actions do computador de referência usado no laboratório, sem alegar que uma VM da Microsoft reproduz seu hardware.

| Recurso | Referência local | GitHub Actions com este perfil |
| --- | --- | --- |
| CPU | Intel Core i5-7200U, 2 núcleos / 4 threads | JVM ActiveProcessorCount=2 e tentativa de afinidade a 2 processadores lógicos |
| Memória | 8 GB físicos compartilhados com GPU | heap do servidor limitado a 640 MB; **RAM total do runner não é limitada a 8 GB** |
| GPU | Intel HD Graphics 620 | **não é emulada**, não há validação de OpenGL/FPS no runner |
| Sistema | Windows ou Linux Mint no PC | Windows Server hospedado no CI; não substitui Windows desktop nem Linux Mint |
| Mindustry | v160.7 | servidor e plugin v160.7 instalados e verificados por SHA-256 |
| Jogo | sobrevivência com mapa e core | servidor de jogo real headless, sem agente construtor |
| Evidências | coletadas no PC | JSON com hardware do host, 35 amostras aproximadas, tick, latência HTTP, RAM e falhas |

Os limites de CPU restringem o **processo Java**, não toda a VM. O uso de
memória registrado é o conjunto de trabalho do servidor; não é uso total do
sistema ou da GPU. Não simulamos potência da Intel HD 620, temperatura, disco
nem desempenho de FPS. A execução continua M0 / preflight M1 **somente leitura**.

## Executar no Windows real

Abra o **Windows PowerShell 5.1** comum, sem administrador, com Java 17+
(opcional: o instalador provisiona Temurin portátil):

1. Instale o servidor e o cliente numa pasta isolada. Se já estiver instalado,
   o mesmo instalador verifica e reutiliza downloads com SHA-256.

   Execute os comandos:

    $instalador = Join-Path $env:TEMP 'Iniciar-MindustryAgentLab.ps1'
    Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/lloupp/micropolis-agent-lab/main/mindustry/windows/Iniciar-MindustryAgentLab.ps1' -OutFile $instalador
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $instalador -InstallOnly -NoObserver

2. Use o script de benchmark instalado junto ao projeto:

    $teste = Join-Path $env:LOCALAPPDATA 'MindustryAgentLab\source\mindustry\windows\Testar-MindustryPC.ps1'
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $teste -DurationSeconds 60 -CpuCores 2 -MaxHeapMb 640

3. Para incluir **abertura do cliente gráfico real** (apenas teste local,
   sem medição automática de FPS), execute:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File $teste -DurationSeconds 120 -CpuCores 2 -MaxHeapMb 640 -LaunchClient

   Conecte manualmente a Play > Join Game > 127.0.0.1:6567. O processo de
   cliente iniciado pelo script será encerrado ao concluir; feche qualquer
   servidor Mindustry antigo **antes** do teste. Nenhum processo anterior é
   encerrado intencionalmente. Apenas os processos iniciados pelo teste são
   finalizados. O runner CI nunca abre o cliente gráfico.

## Relatório e aceitação

- Arquivo local: %LOCALAPPDATA%\MindustryAgentLab\reports\pc-validation.json
- Saídas para diagnóstico no mesmo diretório: server-stdout.log e server-stderr.log
- GitHub Actions: artifact "mindustry-windows-pc-profile", com apenas o JSON.
- Critérios: servidor real inicia; core e mapa presentes; a partida segue
  ativa; no mínimo 75% das observações de 1 segundo são válidas; nenhuma
  falha de observação; tick aumenta; dimensões do mapa são estáveis.
- O benchmark registra latência média/p95 do endpoint e pico de RAM do
  servidor para **comparação**, sem inventar limites de aceitabilidade para
  o PC real. Indicador cpuAffinityApplied demonstra se a tentativa de
  afinidade funcionou. Se falso, a aproximação é parcial.
- Campos realServer=true e commandsExecuted=0 são propriedades do **teste
  read-only**; não comprovam gameplay do agente.

Não rode este script apontando para a pasta de configuração de um jogo pessoal:
o instalador opera em MindustryAgentLab; mapas e configurações do seu
Mindustry cotidiano devem permanecer fora dela. O relatório contém modelos de
CPU/GPU e versão de Windows; revise os dados antes de publicá-los.

## Próximo teste de hardware genuíno

No próprio PC, medir FPS, estabilidade do cliente Java com Intel HD 620,
temperatura/uso da memória compartilhada, desempenho do servidor com cliente
aberto e recuperação após alguns minutos de gameplay. Esses aspectos não são
comprováveis apenas no runner GitHub.

## Executar no Linux Mint com seu hardware real

O runner Linux do GitHub utiliza Ubuntu, **não** reproduz a versão gráfica do
Linux Mint. Para validar realmente os drivers Intel, RAM compartilhada, CPU,
compositor e FPS, rode o benchmark **no PC físico**.

Requisitos: Python 3.10+, Java JDK 17+, Git e internet na primeira execução.
Por exemplo, se precisar instalar as dependências no Mint:

    sudo apt update
    sudo apt install -y openjdk-17-jdk python3 git pciutils

Clone o projeto ou atualize uma cópia existente:

    git clone https://github.com/lloupp/micropolis-agent-lab.git
    cd micropolis-agent-lab
    python3 mindustry/linux/test_pc_profile.py --duration 60 --cores 2 --heap-mb 640

O script compila o plugin com o JDK local, verifica SHA-256 do JAR oficial,
inicia um servidor Mindustry v160.7 real, aplica afinidade de CPU em dois
processadores permitidos por Linux, coleta snapshots/ticks, latência e pico
de RSS, e encerra somente seus próprios processos. Dados são gravados em
~/.local/share/mindustry-agent-lab. Sem sudo ou alterações globais durante o
teste (após preparar o JDK).

Para abrir o cliente gráfico no Mint durante o mesmo teste:

    python3 mindustry/linux/test_pc_profile.py --duration 120 --cores 2 --heap-mb 640 --with-client

Selecione Play > Join Game > 127.0.0.1:6567 enquanto o teste roda. Isso
apenas inicia o cliente: **não mede FPS**, nem garante que o jogo e sua
configuração tenham sido isolados do diretório padrão da aplicação. O script
encerra o cliente que iniciou ao final. Não utilize essa opção quando tiver
um jogo pessoal não salvo.

Relatório: ~/.local/share/mindustry-agent-lab/reports/pc-validation-linux.json.
O workflow Mindustry Linux PC profile publica um artifact JSON análogo, mas
executa com GPU e RAM reais do runner, não os do seu computador. Os campos
gpuEmulated=false e totalMachineRamLimitedTo8Gb=false explicitam isso.
