# Le estados do plugin Mindustry; nao envia comandos para o jogo.
[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $env:LOCALAPPDATA 'MindustryAgentLab\episodes\mindustry-observations.jsonl'),
    [ValidateRange(1, 60)][int]$IntervalSeconds = 2
)

$ErrorActionPreference = 'Stop'
$uri = 'http://127.0.0.1:8766/v1/state'
$parent = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $parent)) { $null = New-Item -Path $parent -ItemType Directory -Force }
$encoding = New-Object System.Text.UTF8Encoding($false)
$offline = $false
Write-Host ('[AgentLab] Observando ' + $uri) -ForegroundColor Cyan
Write-Host ('[AgentLab] Gravando: ' + $OutputPath) -ForegroundColor Cyan
Write-Host '[AgentLab] Ctrl+C encerra apenas o observador.'

while ($true) {
    try {
        $state = Invoke-RestMethod -Uri $uri -TimeoutSec 3
        if ($state.schemaVersion -ne 1 -or $state.ready -isnot [bool]) {
            throw 'Schema inesperado da API local.'
        }
        $json = $state | ConvertTo-Json -Depth 8 -Compress
        $timestamp = [DateTimeOffset]::UtcNow.ToString('o')
        $line = '{"kind":"passive_observation","capturedAt":"' + $timestamp + '","state":' + $json + '}'
        [System.IO.File]::AppendAllText($OutputPath, $line + [Environment]::NewLine, $encoding)
        if ($state.ready) {
            $coreText = if ($null -eq $state.core) { 'sem core' } else { 'cobre=' + $state.core.copper + ' chumbo=' + $state.core.lead }
            Write-Host ('wave=' + $state.wave + ' tick=' + $state.tick + ' ' + $coreText)
        } else {
            Write-Host 'Mapa ainda nao esta pronto.'
        }
        $offline = $false
    } catch {
        if (-not $offline) {
            Write-Host ('[AgentLab] API indisponivel: ' + $_.Exception.Message) -ForegroundColor Yellow
            $offline = $true
        }
    }
    Start-Sleep -Seconds $IntervalSeconds
}
