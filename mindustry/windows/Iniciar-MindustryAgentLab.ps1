# Mindustry Agent Lab - instalador e launcher Windows (sem privilegios de administrador)
# Origem: https://github.com/lloupp/micropolis-agent-lab
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'MindustryAgentLab'),
    [switch]$InstallOnly,
    [switch]$NoClient,
    [switch]$NoObserver,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'lloupp/micropolis-agent-lab'
$Branch = $RepositoryRef
$MindustryVersion = 'v160.7'
$VersionAssets = @{
    'server-release.jar' = 'f7b899a4038b95b14a824d5f8993984f79d73baa3254c385b6538327f9c0befd'
    'Mindustry.jar'      = '36d94941a1639478ad1d9be25a9d802c6f77552f400c6da0338b7b019f63a0d1'
}

function Info([string]$Message) { Write-Host ('[Mindustry Lab] ' + $Message) -ForegroundColor Cyan }
function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $Path -Force
    }
}
function Download-File([string]$Uri, [string]$Destination) {
    Ensure-Directory (Split-Path -Parent $Destination)
    $partial = $Destination + '.part'
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    Info ('Baixando: ' + $Uri)
    try {
        Invoke-WebRequest -Uri $Uri -OutFile $partial -UseBasicParsing -MaximumRedirection 10
        Move-Item -LiteralPath $partial -Destination $Destination -Force
    } catch {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
        throw
    }
}
function Download-Verified([string]$Uri, [string]$Destination, [string]$Sha256) {
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
        if ($actual -ieq $Sha256) {
            Info ('Cache verificado: ' + (Split-Path -Leaf $Destination))
            return
        }
        Remove-Item -LiteralPath $Destination -Force
    }
    Download-File -Uri $Uri -Destination $Destination
    $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($actual -ine $Sha256) {
        Remove-Item -LiteralPath $Destination -Force
        throw ('SHA-256 invalido para ' + $Destination + '. Download rejeitado.')
    }
    Info ('SHA-256 OK: ' + (Split-Path -Leaf $Destination))
}
function Find-JavaBin {
    # Temurin portatil de uma execucao anterior.
    $portable = Join-Path $InstallDir 'tools\jdk'
    $folders = @()
    if (Test-Path -LiteralPath $portable) {
        $folders = @(Get-ChildItem -LiteralPath $portable -Directory)
    }
    foreach ($folder in $folders) {
        $candidate = Join-Path $folder.FullName 'bin\javac.exe'
        if (Test-Path -LiteralPath $candidate) { return (Join-Path $folder.FullName 'bin') }
    }

    $locations = @()
    if ($env:JAVA_HOME) { $locations += (Join-Path $env:JAVA_HOME 'bin') }
    $cmd = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($cmd) { $locations += (Split-Path -Parent $cmd.Source) }
    foreach ($folder in $locations) {
        $javac = Join-Path $folder 'javac.exe'
        $java = Join-Path $folder 'java.exe'
        $jar = Join-Path $folder 'jar.exe'
        if (-not ((Test-Path $javac) -and (Test-Path $java) -and (Test-Path $jar))) { continue }
        $versionOutput = (& $javac -version 2>&1 | Out-String).Trim()
        $match = [regex]::Match($versionOutput, 'javac\s+(\d+)')
        if ($match.Success -and [int]$match.Groups[1].Value -ge 17) {
            Info ('JDK existente: ' + $versionOutput)
            return $folder
        }
    }
    return $null
}
function Install-PortableJdk {
    Info 'JDK 17+ nao encontrado. Instalando Eclipse Temurin 17 portatil (sem admin)...'
    $api = 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
    $metadata = Invoke-RestMethod -Uri $api -UseBasicParsing
    $release = @($metadata | Where-Object { $_.binary.package.link -and $_.binary.package.checksum } | Select-Object -First 1)
    if (-not $release -or -not $release[0]) { throw 'API do Adoptium nao retornou um JDK Windows x64 verificavel.' }
    $package = $release[0].binary.package
    $zip = Join-Path $InstallDir 'downloads\temurin-17-x64.zip'
    Download-Verified -Uri ([string]$package.link) -Destination $zip -Sha256 ([string]$package.checksum)
    $jdkRoot = Join-Path $InstallDir 'tools\jdk'
    Ensure-Directory $jdkRoot
    Expand-Archive -LiteralPath $zip -DestinationPath $jdkRoot -Force
    $folder = Get-ChildItem -LiteralPath $jdkRoot -Directory | Where-Object {
        (Test-Path (Join-Path $_.FullName 'bin\javac.exe')) -and
        (Test-Path (Join-Path $_.FullName 'bin\java.exe'))
    } | Select-Object -First 1
    if (-not $folder) { throw 'JDK foi extraido, mas java.exe/javac.exe nao foram encontrados.' }
    Info ('JDK portatil pronto: ' + $folder.FullName)
    return (Join-Path $folder.FullName 'bin')
}
function Download-Project {
    $archive = Join-Path $InstallDir 'downloads\agent-lab-repository.zip'
    $uri = 'https://github.com/' + $Repo + '/archive/refs/heads/' + $Branch + '.zip'
    Download-File -Uri $uri -Destination $archive
    $unzip = Join-Path $InstallDir '_source_tmp'
    if (Test-Path -LiteralPath $unzip) { Remove-Item -LiteralPath $unzip -Force -Recurse }
    Ensure-Directory $unzip
    try {
        Expand-Archive -LiteralPath $archive -DestinationPath $unzip
        $source = Get-ChildItem -LiteralPath $unzip -Directory | Where-Object {
            Test-Path (Join-Path $_.FullName 'mindustry\plugin\plugin.json')
        } | Select-Object -First 1
        if (-not $source) { throw 'O ZIP nao contem a estrutura mindustry/plugin esperada.' }
        $dest = Join-Path $InstallDir 'source\mindustry'
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
        Ensure-Directory (Split-Path -Parent $dest)
        Copy-Item -LiteralPath (Join-Path $source.FullName 'mindustry') -Destination $dest -Recurse -Force
        return $dest
    } finally {
        if (Test-Path -LiteralPath $unzip) { Remove-Item -LiteralPath $unzip -Recurse -Force }
    }
}
function Compile-Plugin([string]$JdkBin, [string]$SourceRoot, [string]$DependencyJar) {
    $pluginRoot = Join-Path $SourceRoot 'plugin'
    $javaDir = Join-Path $pluginRoot 'src\main\java'
    $buildRoot = Join-Path $InstallDir 'build'
    $classes = Join-Path $buildRoot 'classes'
    if (Test-Path -LiteralPath $classes) { Remove-Item -LiteralPath $classes -Recurse -Force }
    Ensure-Directory $classes
    $javaSources = @(Get-ChildItem -LiteralPath $javaDir -Filter '*.java' -File -Recurse | ForEach-Object { $_.FullName })
    if ($javaSources.Count -eq 0) { throw 'Nenhum arquivo .java localizado no plugin.' }
    Info 'Compilando plugin com as classes do servidor Mindustry v160.7...'
    & (Join-Path $JdkBin 'javac.exe') --release 17 -encoding UTF-8 -cp $DependencyJar -d $classes @javaSources
    if ($LASTEXITCODE -ne 0) { throw ('javac falhou: codigo ' + $LASTEXITCODE) }
    $resultJar = Join-Path $buildRoot 'mindustry-agent-lab-plugin.jar'
    if (Test-Path -LiteralPath $resultJar) { Remove-Item -LiteralPath $resultJar -Force }
    & (Join-Path $JdkBin 'jar.exe') --create --file $resultJar -C $classes . -C $pluginRoot plugin.json
    if ($LASTEXITCODE -ne 0) { throw ('jar falhou: codigo ' + $LASTEXITCODE) }
    if (-not (Test-Path -LiteralPath $resultJar)) { throw 'Plugin compilado nao encontrado.' }
    return $resultJar
}

try {
    Ensure-Directory $InstallDir
    foreach ($path in @('downloads', 'server\config\mods', 'client', 'episodes', 'tools', 'build')) {
        Ensure-Directory (Join-Path $InstallDir $path)
    }
    Info ('Pasta: ' + $InstallDir)

    $jdkBin = Find-JavaBin
    if (-not $jdkBin) { $jdkBin = Install-PortableJdk }
    $java = Join-Path $jdkBin 'java.exe'
    $javaw = Join-Path $jdkBin 'javaw.exe'
    $sourceRoot = Download-Project

    $assetBase = 'https://github.com/Anuken/Mindustry/releases/download/' + $MindustryVersion
    $downloads = Join-Path $InstallDir 'downloads'
    foreach ($name in @('server-release.jar')) {
        Download-Verified -Uri ($assetBase + '/' + $name) -Destination (Join-Path $downloads $name) -Sha256 $VersionAssets[$name]
    }
    $pluginJar = Compile-Plugin -JdkBin $jdkBin -SourceRoot $sourceRoot -DependencyJar (Join-Path $downloads 'server-release.jar')
    $serverDir = Join-Path $InstallDir 'server'
    $serverJar = Join-Path $serverDir 'server-release.jar'
    Copy-Item -LiteralPath (Join-Path $downloads 'server-release.jar') -Destination $serverJar -Force
    Copy-Item -LiteralPath $pluginJar -Destination (Join-Path $serverDir 'config\mods\mindustry-agent-lab-plugin.jar') -Force
    Info 'Plugin compilado e instalado na pasta config/mods do servidor.'

    if (-not $NoClient) {
        $clientJar = Join-Path $downloads 'Mindustry.jar'
        Download-Verified -Uri ($assetBase + '/Mindustry.jar') -Destination $clientJar -Sha256 $VersionAssets['Mindustry.jar']
        Copy-Item -LiteralPath $clientJar -Destination (Join-Path $InstallDir 'client\Mindustry.jar') -Force
    }

    if ($InstallOnly) {
        Info 'Instalacao concluida. Execute este mesmo script novamente para iniciar.'
        Info ('Servidor instalado em: ' + $serverDir)
        return
    }

    if (-not $NoObserver) {
        $observer = Join-Path $sourceRoot 'windows\Observar-Mindustry.ps1'
        if (-not (Test-Path -LiteralPath $observer)) { throw 'Arquivo do observador PowerShell nao encontrado.' }
        $output = Join-Path $InstallDir 'episodes\mindustry-observations.jsonl'
        $args = '-NoProfile -NoExit -ExecutionPolicy Bypass -File "{0}" -OutputPath "{1}"' -f $observer, $output
        Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $serverDir | Out-Null
        Info ('Observador iniciado em outra janela. JSONL: ' + $output)
    }

    if (-not $NoClient) {
        $client = Join-Path $InstallDir 'client\Mindustry.jar'
        Info 'Iniciando cliente grafico Mindustry...'
        if (Test-Path -LiteralPath $javaw) {
            Start-Process -FilePath $javaw -ArgumentList ('-Xmx768m -jar "{0}"' -f $client) -WorkingDirectory (Join-Path $InstallDir 'client') | Out-Null
        } else {
            Start-Process -FilePath $java -ArgumentList ('-Xmx768m -jar "{0}"' -f $client) -WorkingDirectory (Join-Path $InstallDir 'client') | Out-Null
        }
    }

    Write-Host ''
    Write-Host 'Servidor Mindustry + Agent Lab iniciando automaticamente com um mapa Survival.' -ForegroundColor Green
    Write-Host 'No jogo, selecione Play > Join Game e conecte em 127.0.0.1:6567.' -ForegroundColor Green
    Write-Host 'API: http://127.0.0.1:8766/v1/state (somente leitura).' -ForegroundColor Green
    Write-Host 'Para parar o servidor, digite exit no console ou pressione Ctrl+C.' -ForegroundColor Yellow
    Write-Host ''
    Push-Location $serverDir
    try {
        & $java -Xms256m -Xmx1024m -jar $serverJar host
        if ($LASTEXITCODE -ne 0) { throw ('O servidor terminou com codigo ' + $LASTEXITCODE) }
    } finally {
        Pop-Location
    }
} catch {
    Write-Host ('[ERRO] ' + $_.Exception.Message) -ForegroundColor Red
    throw
}
)][string]$RepositoryRef = 'main'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'lloupp/micropolis-agent-lab'
$Branch = 'feat/mindustry-agent-lab-bootstrap-20261017'
$MindustryVersion = 'v160.7'
$VersionAssets = @{
    'server-release.jar' = 'f7b899a4038b95b14a824d5f8993984f79d73baa3254c385b6538327f9c0befd'
    'Mindustry.jar'      = '36d94941a1639478ad1d9be25a9d802c6f77552f400c6da0338b7b019f63a0d1'
}

function Info([string]$Message) { Write-Host ('[Mindustry Lab] ' + $Message) -ForegroundColor Cyan }
function Ensure-Directory([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $Path -Force
    }
}
function Download-File([string]$Uri, [string]$Destination) {
    Ensure-Directory (Split-Path -Parent $Destination)
    $partial = $Destination + '.part'
    if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    Info ('Baixando: ' + $Uri)
    try {
        Invoke-WebRequest -Uri $Uri -OutFile $partial -UseBasicParsing -MaximumRedirection 10
        Move-Item -LiteralPath $partial -Destination $Destination -Force
    } catch {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
        throw
    }
}
function Download-Verified([string]$Uri, [string]$Destination, [string]$Sha256) {
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
        if ($actual -ieq $Sha256) {
            Info ('Cache verificado: ' + (Split-Path -Leaf $Destination))
            return
        }
        Remove-Item -LiteralPath $Destination -Force
    }
    Download-File -Uri $Uri -Destination $Destination
    $actual = (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash
    if ($actual -ine $Sha256) {
        Remove-Item -LiteralPath $Destination -Force
        throw ('SHA-256 invalido para ' + $Destination + '. Download rejeitado.')
    }
    Info ('SHA-256 OK: ' + (Split-Path -Leaf $Destination))
}
function Find-JavaBin {
    # Temurin portatil de uma execucao anterior.
    $portable = Join-Path $InstallDir 'tools\jdk'
    $folders = @()
    if (Test-Path -LiteralPath $portable) {
        $folders = @(Get-ChildItem -LiteralPath $portable -Directory)
    }
    foreach ($folder in $folders) {
        $candidate = Join-Path $folder.FullName 'bin\javac.exe'
        if (Test-Path -LiteralPath $candidate) { return (Join-Path $folder.FullName 'bin') }
    }

    $locations = @()
    if ($env:JAVA_HOME) { $locations += (Join-Path $env:JAVA_HOME 'bin') }
    $cmd = Get-Command javac.exe -ErrorAction SilentlyContinue
    if ($cmd) { $locations += (Split-Path -Parent $cmd.Source) }
    foreach ($folder in $locations) {
        $javac = Join-Path $folder 'javac.exe'
        $java = Join-Path $folder 'java.exe'
        $jar = Join-Path $folder 'jar.exe'
        if (-not ((Test-Path $javac) -and (Test-Path $java) -and (Test-Path $jar))) { continue }
        $versionOutput = (& $javac -version 2>&1 | Out-String).Trim()
        $match = [regex]::Match($versionOutput, 'javac\s+(\d+)')
        if ($match.Success -and [int]$match.Groups[1].Value -ge 17) {
            Info ('JDK existente: ' + $versionOutput)
            return $folder
        }
    }
    return $null
}
function Install-PortableJdk {
    Info 'JDK 17+ nao encontrado. Instalando Eclipse Temurin 17 portatil (sem admin)...'
    $api = 'https://api.adoptium.net/v3/assets/latest/17/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
    $metadata = Invoke-RestMethod -Uri $api -UseBasicParsing
    $release = @($metadata | Where-Object { $_.binary.package.link -and $_.binary.package.checksum } | Select-Object -First 1)
    if (-not $release -or -not $release[0]) { throw 'API do Adoptium nao retornou um JDK Windows x64 verificavel.' }
    $package = $release[0].binary.package
    $zip = Join-Path $InstallDir 'downloads\temurin-17-x64.zip'
    Download-Verified -Uri ([string]$package.link) -Destination $zip -Sha256 ([string]$package.checksum)
    $jdkRoot = Join-Path $InstallDir 'tools\jdk'
    Ensure-Directory $jdkRoot
    Expand-Archive -LiteralPath $zip -DestinationPath $jdkRoot -Force
    $folder = Get-ChildItem -LiteralPath $jdkRoot -Directory | Where-Object {
        (Test-Path (Join-Path $_.FullName 'bin\javac.exe')) -and
        (Test-Path (Join-Path $_.FullName 'bin\java.exe'))
    } | Select-Object -First 1
    if (-not $folder) { throw 'JDK foi extraido, mas java.exe/javac.exe nao foram encontrados.' }
    Info ('JDK portatil pronto: ' + $folder.FullName)
    return (Join-Path $folder.FullName 'bin')
}
function Download-Project {
    $archive = Join-Path $InstallDir 'downloads\agent-lab-repository.zip'
    $uri = 'https://github.com/' + $Repo + '/archive/refs/heads/' + $Branch + '.zip'
    Download-File -Uri $uri -Destination $archive
    $unzip = Join-Path $InstallDir '_source_tmp'
    if (Test-Path -LiteralPath $unzip) { Remove-Item -LiteralPath $unzip -Force -Recurse }
    Ensure-Directory $unzip
    try {
        Expand-Archive -LiteralPath $archive -DestinationPath $unzip
        $source = Get-ChildItem -LiteralPath $unzip -Directory | Where-Object {
            Test-Path (Join-Path $_.FullName 'mindustry\plugin\plugin.json')
        } | Select-Object -First 1
        if (-not $source) { throw 'O ZIP nao contem a estrutura mindustry/plugin esperada.' }
        $dest = Join-Path $InstallDir 'source\mindustry'
        if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
        Ensure-Directory (Split-Path -Parent $dest)
        Copy-Item -LiteralPath (Join-Path $source.FullName 'mindustry') -Destination $dest -Recurse -Force
        return $dest
    } finally {
        if (Test-Path -LiteralPath $unzip) { Remove-Item -LiteralPath $unzip -Recurse -Force }
    }
}
function Compile-Plugin([string]$JdkBin, [string]$SourceRoot, [string]$DependencyJar) {
    $pluginRoot = Join-Path $SourceRoot 'plugin'
    $javaDir = Join-Path $pluginRoot 'src\main\java'
    $buildRoot = Join-Path $InstallDir 'build'
    $classes = Join-Path $buildRoot 'classes'
    if (Test-Path -LiteralPath $classes) { Remove-Item -LiteralPath $classes -Recurse -Force }
    Ensure-Directory $classes
    $javaSources = @(Get-ChildItem -LiteralPath $javaDir -Filter '*.java' -File -Recurse | ForEach-Object { $_.FullName })
    if ($javaSources.Count -eq 0) { throw 'Nenhum arquivo .java localizado no plugin.' }
    Info 'Compilando plugin com as classes do servidor Mindustry v160.7...'
    & (Join-Path $JdkBin 'javac.exe') --release 17 -encoding UTF-8 -cp $DependencyJar -d $classes @javaSources
    if ($LASTEXITCODE -ne 0) { throw ('javac falhou: codigo ' + $LASTEXITCODE) }
    $resultJar = Join-Path $buildRoot 'mindustry-agent-lab-plugin.jar'
    if (Test-Path -LiteralPath $resultJar) { Remove-Item -LiteralPath $resultJar -Force }
    & (Join-Path $JdkBin 'jar.exe') --create --file $resultJar -C $classes . -C $pluginRoot plugin.json
    if ($LASTEXITCODE -ne 0) { throw ('jar falhou: codigo ' + $LASTEXITCODE) }
    if (-not (Test-Path -LiteralPath $resultJar)) { throw 'Plugin compilado nao encontrado.' }
    return $resultJar
}

try {
    Ensure-Directory $InstallDir
    foreach ($path in @('downloads', 'server\config\mods', 'client', 'episodes', 'tools', 'build')) {
        Ensure-Directory (Join-Path $InstallDir $path)
    }
    Info ('Pasta: ' + $InstallDir)

    $jdkBin = Find-JavaBin
    if (-not $jdkBin) { $jdkBin = Install-PortableJdk }
    $java = Join-Path $jdkBin 'java.exe'
    $javaw = Join-Path $jdkBin 'javaw.exe'
    $sourceRoot = Download-Project

    $assetBase = 'https://github.com/Anuken/Mindustry/releases/download/' + $MindustryVersion
    $downloads = Join-Path $InstallDir 'downloads'
    foreach ($name in @('server-release.jar')) {
        Download-Verified -Uri ($assetBase + '/' + $name) -Destination (Join-Path $downloads $name) -Sha256 $VersionAssets[$name]
    }
    $pluginJar = Compile-Plugin -JdkBin $jdkBin -SourceRoot $sourceRoot -DependencyJar (Join-Path $downloads 'server-release.jar')
    $serverDir = Join-Path $InstallDir 'server'
    $serverJar = Join-Path $serverDir 'server-release.jar'
    Copy-Item -LiteralPath (Join-Path $downloads 'server-release.jar') -Destination $serverJar -Force
    Copy-Item -LiteralPath $pluginJar -Destination (Join-Path $serverDir 'config\mods\mindustry-agent-lab-plugin.jar') -Force
    Info 'Plugin compilado e instalado na pasta config/mods do servidor.'

    if (-not $NoClient) {
        $clientJar = Join-Path $downloads 'Mindustry.jar'
        Download-Verified -Uri ($assetBase + '/Mindustry.jar') -Destination $clientJar -Sha256 $VersionAssets['Mindustry.jar']
        Copy-Item -LiteralPath $clientJar -Destination (Join-Path $InstallDir 'client\Mindustry.jar') -Force
    }

    if ($InstallOnly) {
        Info 'Instalacao concluida. Execute este mesmo script novamente para iniciar.'
        Info ('Servidor instalado em: ' + $serverDir)
        return
    }

    if (-not $NoObserver) {
        $observer = Join-Path $sourceRoot 'windows\Observar-Mindustry.ps1'
        if (-not (Test-Path -LiteralPath $observer)) { throw 'Arquivo do observador PowerShell nao encontrado.' }
        $output = Join-Path $InstallDir 'episodes\mindustry-observations.jsonl'
        $args = '-NoProfile -NoExit -ExecutionPolicy Bypass -File "{0}" -OutputPath "{1}"' -f $observer, $output
        Start-Process -FilePath 'powershell.exe' -ArgumentList $args -WorkingDirectory $serverDir | Out-Null
        Info ('Observador iniciado em outra janela. JSONL: ' + $output)
    }

    if (-not $NoClient) {
        $client = Join-Path $InstallDir 'client\Mindustry.jar'
        Info 'Iniciando cliente grafico Mindustry...'
        if (Test-Path -LiteralPath $javaw) {
            Start-Process -FilePath $javaw -ArgumentList ('-Xmx768m -jar "{0}"' -f $client) -WorkingDirectory (Join-Path $InstallDir 'client') | Out-Null
        } else {
            Start-Process -FilePath $java -ArgumentList ('-Xmx768m -jar "{0}"' -f $client) -WorkingDirectory (Join-Path $InstallDir 'client') | Out-Null
        }
    }

    Write-Host ''
    Write-Host 'Servidor Mindustry + Agent Lab iniciando automaticamente com um mapa Survival.' -ForegroundColor Green
    Write-Host 'No jogo, selecione Play > Join Game e conecte em 127.0.0.1:6567.' -ForegroundColor Green
    Write-Host 'API: http://127.0.0.1:8766/v1/state (somente leitura).' -ForegroundColor Green
    Write-Host 'Para parar o servidor, digite exit no console ou pressione Ctrl+C.' -ForegroundColor Yellow
    Write-Host ''
    Push-Location $serverDir
    try {
        & $java -Xms256m -Xmx1024m -jar $serverJar host
        if ($LASTEXITCODE -ne 0) { throw ('O servidor terminou com codigo ' + $LASTEXITCODE) }
    } finally {
        Pop-Location
    }
} catch {
    Write-Host ('[ERRO] ' + $_.Exception.Message) -ForegroundColor Red
    throw
}
