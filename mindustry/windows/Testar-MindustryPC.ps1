# Read-only Mindustry benchmark with constraints inspired by a 2-core / 8-GB PC.
# Windows PowerShell 5.1; no admin privileges or system-wide changes.
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'MindustryAgentLab'),
    [ValidateRange(15, 600)][int]$DurationSeconds = 60,
    [ValidateRange(1, 8)][int]$CpuCores = 2,
    [ValidateRange(384, 2048)][int]$MaxHeapMb = 640,
    [string]$ReportPath = '',
    [switch]$LaunchClient
)

$ErrorActionPreference = 'Stop'
if (-not $ReportPath) { $ReportPath = Join-Path $InstallDir 'reports\pc-validation.json' }
$reportDir = Split-Path -Parent $ReportPath
if (-not (Test-Path -LiteralPath $reportDir)) {
    $null = New-Item -Path $reportDir -ItemType Directory -Force
}
$serverDir = Join-Path $InstallDir 'server'
if (-not ((Test-Path (Join-Path $serverDir 'server-release.jar')) -and
          (Test-Path (Join-Path $serverDir 'config\mods\mindustry-agent-lab-plugin.jar')))) {
    throw 'Servidor ou plugin ausente. Execute Iniciar-MindustryAgentLab.ps1 -InstallOnly -NoClient -NoObserver.'
}
if ($LaunchClient -and -not (Test-Path (Join-Path $InstallDir 'client\Mindustry.jar'))) {
    throw 'Cliente ausente: execute Iniciar-MindustryAgentLab.ps1 -InstallOnly sem -NoClient.'
}

function Find-Java {
    $choices = @()
    if ($env:JAVA_HOME) { $choices += Join-Path $env:JAVA_HOME 'bin\java.exe' }
    $cmd = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($cmd) { $choices += $cmd.Source }
    $portable = Join-Path $InstallDir 'tools\jdk'
    if (Test-Path $portable) {
        $choices += @(Get-ChildItem $portable -Directory | ForEach-Object { Join-Path $_.FullName 'bin\java.exe' })
    }
    foreach ($candidate in $choices) {
        if (Test-Path $candidate) { return $candidate }
    }
    throw 'Java nao encontrado; execute o instalador Mindustry primeiro.'
}
function First-Cim([string]$ClassName) {
    try { return Get-CimInstance -ClassName $ClassName -ErrorAction Stop | Select-Object -First 1 }
    catch { return $null }
}
$cpu = First-Cim 'Win32_Processor'
$machine = First-Cim 'Win32_ComputerSystem'
$gpu = First-Cim 'Win32_VideoController'
$os = First-Cim 'Win32_OperatingSystem'
$hardware = [ordered]@{
    cpuModel = if ($cpu) { [string]$cpu.Name } else { 'unknown' }
    logicalProcessors = [Environment]::ProcessorCount
    installedRamGb = if ($machine) { [Math]::Round([double]$machine.TotalPhysicalMemory / 1GB, 2) } else { $null }
    gpuModel = if ($gpu) { [string]$gpu.Name } else { 'unknown' }
    windows = if ($os) { [string]$os.Caption } else { 'unknown' }
}
$environment = if ($env:GITHUB_ACTIONS -eq 'true') { 'github_windows_runner' } else { 'local_windows_pc' }
$stdout = Join-Path $reportDir 'server-stdout.log'
$stderr = Join-Path $reportDir 'server-stderr.log'
$java = Find-Java
$process = $null
$client = $null
$errors = New-Object 'System.Collections.Generic.List[string]'
$samples = New-Object 'System.Collections.Generic.List[object]'
$latencies = New-Object 'System.Collections.Generic.List[double]'
$peakRamMb = 0.0
$affinityApplied = $false
$clientLaunched = $false
$failure = $null
$startedAt = [DateTimeOffset]::UtcNow

try {
    # Never reuse or terminate a pre-existing local user's game server.
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8766/v1/health' -TimeoutSec 2
        if ($health.service -eq 'mindustry-agent-lab') {
            throw 'Uma instancia Mindustry ja ocupa a porta 8766. Encerre-a antes deste teste isolado.'
        }
    } catch {
        if ($_.Exception.Message -like 'Uma instancia Mindustry*') { throw }
    }

    $javaArgs = @('-Xms128m', "-Xmx$($MaxHeapMb)m",
        "-XX:ActiveProcessorCount=$CpuCores", '-jar', 'server-release.jar', 'host')
    $process = Start-Process -FilePath $java -ArgumentList $javaArgs -WorkingDirectory $serverDir -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru
    try {
        $effective = [Math]::Min($CpuCores, [Environment]::ProcessorCount)
        $mask = [int64]([Math]::Pow(2, $effective) - 1)
        $process.ProcessorAffinity = [IntPtr]$mask
        $affinityApplied = $true
    } catch {
        $errors.Add('affinity_unavailable: ' + $_.Exception.Message)
    }

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        $process.Refresh()
        if ($process.HasExited) { throw ('Servidor encerrou no startup: ' + $process.ExitCode) }
        try {
            $health = Invoke-RestMethod 'http://127.0.0.1:8766/v1/health' -TimeoutSec 2
            $state = Invoke-RestMethod 'http://127.0.0.1:8766/v1/state' -TimeoutSec 2
            if ($health.readOnly -eq $true -and $state.schemaVersion -eq 1 -and $state.ready -eq $true -and $state.width -gt 0 -and $state.core) {
                $ready = $true
                break
            }
        } catch { }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw 'Servidor sem mapa e core validos apos 60s.' }

    if ($LaunchClient) {
        $client = Start-Process -FilePath $java -ArgumentList @('-Xmx768m', '-jar', 'Mindustry.jar') -WorkingDirectory (Join-Path $InstallDir 'client') -PassThru
        $clientLaunched = $true
        Write-Host 'Cliente aberto. Conecte em Play > Join Game > 127.0.0.1:6567.'
        Write-Host 'GPU e FPS exigem avaliacao visual real; nao sao simulados pelo CI.'
    }

    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $process.Refresh()
        if ($process.HasExited) { throw ('Servidor encerrou no benchmark: ' + $process.ExitCode) }
        $requestWatch = [Diagnostics.Stopwatch]::StartNew()
        try {
            $state = Invoke-RestMethod 'http://127.0.0.1:8766/v1/state' -TimeoutSec 3
            $requestWatch.Stop()
            if ($state.schemaVersion -ne 1 -or $state.ready -ne $true -or $state.playing -ne $true -or
                $state.gameOver -eq $true -or $null -eq $state.core -or $state.core.health -le 0) {
                throw 'Snapshot nao jogavel ou core ausente.'
            }
            $latencies.Add([Math]::Round($requestWatch.Elapsed.TotalMilliseconds, 2))
            $samples.Add([ordered]@{
                second = [Math]::Round($watch.Elapsed.TotalSeconds, 2)
                wave = [int]$state.wave
                tick = [int]$state.tick
                width = [int]$state.width
                height = [int]$state.height
            })
        } catch {
            $errors.Add('snapshot_failure: ' + $_.Exception.Message)
        }
        $process.Refresh()
        $peakRamMb = [Math]::Max($peakRamMb, [Math]::Round([double]$process.WorkingSet64 / 1MB, 2))
        Start-Sleep -Seconds 1
    }
    if ($samples.Count -lt [Math]::Floor($DurationSeconds * 0.75)) { throw 'Amostras insuficientes na maquina limitada.' }
    if ($samples.Count -lt 2) { throw 'Precisa de ao menos duas amostras reais.' }
    if ($samples[$samples.Count - 1].tick -le $samples[0].tick) { throw 'Ticks nao avancaram.' }
    if ($samples[$samples.Count - 1].width -ne $samples[0].width -or
        $samples[$samples.Count - 1].height -ne $samples[0].height) {
        throw 'Mapa mudou durante o benchmark.'
    }
    if (@($errors | Where-Object { $_ -like 'snapshot_failure:*' }).Count -gt 0) {
        throw 'Erro de leitura do estado durante o benchmark.'
    }
    if ($client) {
        $client.Refresh()
        if ($client.HasExited) { throw 'Cliente grafico encerrou durante teste.' }
    }
} catch {
    $failure = $_.Exception.Message
} finally {
    $firstTick = if ($samples.Count) { $samples[0].tick } else { $null }
    $lastTick = if ($samples.Count) { $samples[$samples.Count - 1].tick } else { $null }
    $latencyMean = $null
    $latencyP95 = $null
    if ($latencies.Count) {
        $sorted = @($latencies | Sort-Object)
        $index = [Math]::Max(0, [Math]::Ceiling($sorted.Count * 0.95) - 1)
        $latencyMean = [Math]::Round([double](($latencies | Measure-Object -Average).Average), 2)
        $latencyP95 = [Math]::Round([double]$sorted[$index], 2)
    }
    if ($client) {
        try { $client.Refresh(); if (-not $client.HasExited) { Stop-Process -Id $client.Id -Force -ErrorAction SilentlyContinue } } catch { }
    }
    if ($process) {
        try { $process.Refresh(); if (-not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue } } catch { }
    }
    $report = [ordered]@{
        schemaVersion = 1
        kind = 'mindustry_pc_profile_validation'
        status = if ($failure) { 'failed' } else { 'passed' }
        actualEnvironment = $environment
        referencePc = [ordered]@{
            cpu = 'Intel Core i5-7200U (2 cores/4 threads)'
            ramGb = 8
            gpu = 'Intel HD Graphics 620'
        }
        hostHardware = $hardware
        restrictions = [ordered]@{
            javaMaxHeapMb = $MaxHeapMb
            javaActiveProcessorCount = $CpuCores
            cpuAffinityApplied = $affinityApplied
            totalMachineRamLimitedTo8Gb = $false
            gpuEmulated = $false
        }
        results = [ordered]@{
            readOnly = $true
            commandsExecuted = 0
            realServer = $true
            requestedDurationSeconds = $DurationSeconds
            successfulSamples = $samples.Count
            errors = @($errors.ToArray())
            firstTick = $firstTick
            lastTick = $lastTick
            tickDelta = if ($null -ne $firstTick -and $null -ne $lastTick) { $lastTick - $firstTick } else { $null }
            meanHttpLatencyMs = $latencyMean
            p95HttpLatencyMs = $latencyP95
            peakServerWorkingSetMb = $peakRamMb
            clientLaunched = $clientLaunched
            gpuFpsValidated = $false
        }
        startedAt = $startedAt.ToString('o')
        endedAt = ([DateTimeOffset]::UtcNow).ToString('o')
        failure = $failure
        observations = @($samples.ToArray())
    }
    $json = $report | ConvertTo-Json -Depth 9
    [IO.File]::WriteAllText($ReportPath, $json + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ('[Mindustry PC] ' + $report.status + ' | ' + $ReportPath)
    Write-Host ('Amostras: ' + $samples.Count + '; ticks: ' + $firstTick + ' -> ' + $lastTick + '; pico RAM servidor: ' + $peakRamMb + ' MB')
}
if ($failure) { throw $failure }
