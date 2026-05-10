<#
.SYNOPSIS
Deploys the full Alexa skill package, including the widget Data Store package.

.DESCRIPTION
Use this script when changes under skill-package/ need to be pushed to the
Alexa development stage. Passing -SkillId uses ASK CLI SMAPI import, which is
safe for an existing Developer Console skill and does not rely on local .ask
project state.

Examples:
  .\scripts\deploy-skill-package.ps1 -SkillId amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  .\scripts\deploy-skill-package.ps1 -SkillId amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx -Profile default
  .\scripts\deploy-skill-package.ps1 -ValidateOnly
  .\scripts\deploy-skill-package.ps1 -Method Deploy
#>

[CmdletBinding()]
param(
    [string]$SkillId,

    [string]$Profile = 'default',

    [ValidateSet('Auto', 'Import', 'Deploy')]
    [string]$Method = 'Auto',

    [switch]$NoIgnoreHash,

    [switch]$SkipPolling,

    [ValidateRange(15, 900)]
    [int]$PollSeconds = 180,

    [ValidateRange(2, 60)]
    [int]$PollIntervalSeconds = 5,

    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Detail {
    param([string]$Message)
    Write-Host "    $Message" -ForegroundColor DarkGray
}

function Assert-FileExists {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required file was not found: $Path"
    }
}

function Read-JsonFile {
    param([string]$Path)

    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        throw "Invalid JSON in $Path. $($_.Exception.Message)"
    }
}

function Convert-JsonText {
    param([string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return $null
    }

    try {
        return $Text | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        return $null
    }
}

function Get-NestedValue {
    param(
        [object]$Value,
        [string]$Path
    )

    $current = $Value

    foreach ($part in $Path.Split('.')) {
        if ($null -eq $current) {
            return $null
        }

        $property = $current.PSObject.Properties[$part]
        if ($null -eq $property) {
            return $null
        }

        $current = $property.Value
    }

    return $current
}

function Get-FirstMatchingValue {
    param(
        [object]$Json,
        [string[]]$Paths
    )

    if ($null -eq $Json) {
        return $null
    }

    foreach ($path in $Paths) {
        $value = Get-NestedValue -Value $Json -Path $path

        if ($null -ne $value -and -not [string]::IsNullOrWhiteSpace([string]$value)) {
            return [string]$value
        }
    }

    return $null
}

function Invoke-AskCli {
    param([string[]]$Arguments)

    $previousErrorActionPreference = $ErrorActionPreference
    $previousNodeNoWarnings = $env:NODE_NO_WARNINGS

    try {
        $ErrorActionPreference = 'Continue'
        $env:NODE_NO_WARNINGS = '1'

        $output = & ask @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference

        if ($null -eq $previousNodeNoWarnings) {
            Remove-Item Env:\NODE_NO_WARNINGS -ErrorAction SilentlyContinue
        }
        else {
            $env:NODE_NO_WARNINGS = $previousNodeNoWarnings
        }
    }

    $text = (($output |
        ForEach-Object { $_.ToString() } |
        Where-Object { $_ -notmatch '\[DEP0066\] DeprecationWarning: OutgoingMessage\.prototype\._headers is deprecated' }) -join [Environment]::NewLine).Trim()

    if ($exitCode -ne 0) {
        throw "ASK CLI failed with exit code $exitCode.`n$text"
    }

    return $text
}

function Assert-AskCliInstalled {
    $ask = Get-Command ask -ErrorAction SilentlyContinue

    if ($null -eq $ask) {
        throw "ASK CLI was not found. Install it with: npm install -g ask-cli. Then run: ask configure --profile $Profile"
    }

    Write-Detail "ASK CLI: $($ask.Source)"
}

function Test-SkillPackage {
    param([string]$SkillPackagePath)

    Write-Step 'Validating skill package files'

    $requiredRelativePaths = @(
        'skill.json',
        'interactionModels/custom/en-US.json',
        'dataStorePackages/kids-chore-chart/manifest.json',
        'dataStorePackages/kids-chore-chart/presentations/default.tpl',
        'dataStorePackages/kids-chore-chart/documents/document.json',
        'dataStorePackages/kids-chore-chart/datasources/default.json'
    )

    foreach ($relativePath in $requiredRelativePaths) {
        Assert-FileExists -Path (Join-Path $SkillPackagePath $relativePath)
    }

    $jsonLikeFiles = Get-ChildItem -LiteralPath $SkillPackagePath -Recurse -File |
        Where-Object { $_.Extension -in @('.json', '.tpl') }

    foreach ($file in $jsonLikeFiles) {
        [void](Read-JsonFile -Path $file.FullName)
    }

    $skillManifestPath = Join-Path $SkillPackagePath 'skill.json'
    $packageManifestPath = Join-Path $SkillPackagePath 'dataStorePackages/kids-chore-chart/manifest.json'
    $skillManifest = Read-JsonFile -Path $skillManifestPath
    $packageManifest = Read-JsonFile -Path $packageManifestPath

    $widgetPackageId = [string]$packageManifest.manifest.id
    $packageManagerInterfaces = @($skillManifest.manifest.apis.custom.interfaces |
        Where-Object { $_.type -eq 'ALEXA_DATASTORE_PACKAGEMANAGER' })
    $declaredPackageIds = @($packageManagerInterfaces | ForEach-Object { $_.packages } | ForEach-Object { $_.id })

    if ([string]::IsNullOrWhiteSpace($widgetPackageId)) {
        throw "Widget package id is missing in $packageManifestPath"
    }

    if ($declaredPackageIds -notcontains $widgetPackageId) {
        throw "skill.json does not declare widget package '$widgetPackageId' in ALEXA_DATASTORE_PACKAGEMANAGER."
    }

    Write-Detail "Widget package: $widgetPackageId"
}

function New-SkillPackageZip {
    param(
        [string]$SkillPackagePath,
        [string]$ZipPath
    )

    Write-Step 'Building full skill-package import ZIP'

    $zipDirectory = Split-Path -Parent $ZipPath
    if (-not (Test-Path -LiteralPath $zipDirectory -PathType Container)) {
        New-Item -Path $zipDirectory -ItemType Directory | Out-Null
    }

    if (Test-Path -LiteralPath $ZipPath -PathType Leaf) {
        Remove-Item -LiteralPath $ZipPath -Force
    }

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = Get-ChildItem -LiteralPath $SkillPackagePath -Recurse -File

        foreach ($file in $files) {
            $relativePath = $file.FullName.Substring($SkillPackagePath.Length).TrimStart('\', '/') -replace '\\', '/'
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $file.FullName,
                $relativePath,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
        }
    }
    finally {
        $zip.Dispose()
    }

    $zipInfo = Get-Item -LiteralPath $ZipPath
    $zipReader = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $entryNames = @($zipReader.Entries | ForEach-Object { $_.FullName })

        if ($entryNames -notcontains 'skill.json') {
            throw 'The generated ZIP must contain skill.json at the ZIP root.'
        }

        if ($entryNames -contains 'skill-package/skill.json') {
            throw 'The generated ZIP should contain skill-package contents at the ZIP root, not a nested skill-package folder.'
        }
    }
    finally {
        $zipReader.Dispose()
    }

    Write-Detail "Created $ZipPath ($([Math]::Round($zipInfo.Length / 1MB, 2)) MB)"
    return $ZipPath
}

function Find-UploadUrl {
    param([string]$Text)

    $json = Convert-JsonText -Text $Text
    $uploadUrl = Get-FirstMatchingValue -Json $json -Paths @(
        'uploadUrl',
        'upload_url',
        'body.uploadUrl',
        'body.upload_url',
        'response.body.uploadUrl'
    )

    if (-not [string]::IsNullOrWhiteSpace($uploadUrl)) {
        return $uploadUrl
    }

    if ($Text -match '(https://[^\s"'']+)') {
        return $Matches[1]
    }

    return $null
}

function Find-ImportId {
    param([string]$Text)

    $json = Convert-JsonText -Text $Text
    $candidate = Get-FirstMatchingValue -Json $json -Paths @(
        'importId',
        'id',
        'body.importId',
        'body.id',
        'location',
        'Location',
        'headers.location',
        'headers.Location',
        'response.headers.location',
        'response.headers.Location'
    )

    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
        if ($candidate -match '/imports/([^/?#\s"'']+)') {
            return $Matches[1]
        }

        if ($candidate -match '^[A-Za-z0-9][A-Za-z0-9_-]+$') {
            return $candidate
        }
    }

    $patterns = @(
        '"importId"\s*:\s*"([^"]+)"',
        '"id"\s*:\s*"([^"]+)"',
        '/imports/([^/?#\s"'']+)',
        '(?i)import\s*id\s*[:=]\s*([A-Za-z0-9_-]+)'
    )

    foreach ($pattern in $patterns) {
        if ($Text -match $pattern) {
            return $Matches[1]
        }
    }

    return $null
}

function Get-ImportStatusValue {
    param([string]$Text)

    $json = Convert-JsonText -Text $Text
    $status = Get-FirstMatchingValue -Json $json -Paths @(
        'status',
        'body.status',
        'importStatus',
        'body.importStatus'
    )

    if (-not [string]::IsNullOrWhiteSpace($status)) {
        return $status
    }

    if ($Text -match '"status"\s*:\s*"([^"]+)"') {
        return $Matches[1]
    }

    return $null
}

function Wait-ForImport {
    param(
        [string]$ImportId,
        [string]$Profile,
        [int]$PollSeconds,
        [int]$PollIntervalSeconds
    )

    Write-Step "Polling import status: $ImportId"
    $deadline = (Get-Date).AddSeconds($PollSeconds)

    while ((Get-Date) -lt $deadline) {
        $statusOutput = Invoke-AskCli -Arguments @(
            'smapi', 'get-import-status',
            '--import-id', $ImportId,
            '--profile', $Profile
        )
        $status = Get-ImportStatusValue -Text $statusOutput

        if ([string]::IsNullOrWhiteSpace($status)) {
            Write-Detail 'Import status response did not include a status value.'
            Write-Host $statusOutput
        }
        else {
            Write-Detail "Status: $status"
        }

        if ($status -in @('SUCCEEDED', 'SUCCESS', 'SUCCESSFUL', 'COMPLETED')) {
            return
        }

        if ($status -in @('FAILED', 'FAILURE')) {
            throw "Skill package import failed.`n$statusOutput"
        }

        Start-Sleep -Seconds $PollIntervalSeconds
    }

    Write-Warning "Import was still running after $PollSeconds seconds. Check the Alexa Developer Console or rerun get-import-status for import id $ImportId."
}

function Import-SkillPackageWithSmapi {
    param(
        [string]$SkillId,
        [string]$Profile,
        [string]$ZipPath,
        [switch]$SkipPolling,
        [int]$PollSeconds,
        [int]$PollIntervalSeconds
    )

    if ([string]::IsNullOrWhiteSpace($SkillId)) {
        throw 'SkillId is required for SMAPI import. Pass -SkillId amzn1.ask.skill....'
    }

    Write-Step 'Creating ASK upload URL'
    $uploadOutput = Invoke-AskCli -Arguments @('smapi', 'create-upload-url', '--profile', $Profile)
    $uploadUrl = Find-UploadUrl -Text $uploadOutput

    if ([string]::IsNullOrWhiteSpace($uploadUrl)) {
        throw "Could not find uploadUrl in ASK CLI response.`n$uploadOutput"
    }

    Write-Step 'Uploading full skill package ZIP'
    $webArgs = @{
        Uri = $uploadUrl
        Method = 'Put'
        InFile = $ZipPath
        ContentType = 'application/zip'
    }

    if ($PSVersionTable.PSVersion.Major -lt 6) {
        $webArgs.UseBasicParsing = $true
    }

    [void](Invoke-WebRequest @webArgs)

    Write-Step 'Starting skill package import'
    $importArgs = @(
        'smapi', 'import-skill-package',
        '--skill-id', $SkillId,
        '--location', $uploadUrl,
        '--profile', $Profile
    )

    $importOutput = $null
    $deadline = (Get-Date).AddSeconds($PollSeconds)

    while ($null -eq $importOutput) {
        try {
            $importOutput = Invoke-AskCli -Arguments $importArgs
        }
        catch {
            $message = $_.Exception.Message

            if ($message -match 'status code 409|\b409\b') {
                if ((Get-Date) -lt $deadline) {
                    Write-Warning "Alexa reports another skill import/build is still running (409 Conflict). Waiting $PollIntervalSeconds seconds before retrying."
                    Start-Sleep -Seconds $PollIntervalSeconds
                    continue
                }

                throw "Alexa still reports another skill import/build is running (409 Conflict) after $PollSeconds seconds. Wait for the Developer Console build/import to finish, then run this script again."
            }

            throw
        }
    }

    $importId = Find-ImportId -Text $importOutput

    if ([string]::IsNullOrWhiteSpace($importId)) {
        Write-Warning 'ASK CLI accepted the import, but the script could not parse an import id from the response.'
        Write-Warning 'Open the Alexa Developer Console and check the build/import status if the widget does not appear.'
        return
    }

    Write-Detail "Import id: $importId"

    if (-not $SkipPolling) {
        Wait-ForImport -ImportId $importId -Profile $Profile -PollSeconds $PollSeconds -PollIntervalSeconds $PollIntervalSeconds
    }
}

function Test-AskProjectState {
    param([string]$ProjectRoot)

    $askStatePath = Join-Path $ProjectRoot '.ask/ask-states.json'
    if (Test-Path -LiteralPath $askStatePath -PathType Leaf) {
        return $true
    }

    $askResourcesPath = Join-Path $ProjectRoot 'ask-resources.json'
    if (Test-Path -LiteralPath $askResourcesPath -PathType Leaf) {
        $askResourcesText = Get-Content -LiteralPath $askResourcesPath -Raw
        if ($askResourcesText -match 'skillId|skill-id|skill_id') {
            return $true
        }
    }

    return $false
}

function Deploy-SkillPackageWithAskProject {
    param(
        [string]$ProjectRoot,
        [string]$Profile,
        [switch]$NoIgnoreHash
    )

    if (-not (Test-AskProjectState -ProjectRoot $ProjectRoot)) {
        throw "No local ASK project state with a skill id was found. To avoid accidentally creating a new skill, either pass -SkillId to use SMAPI import, or initialize this folder once with: ask init --hosted-skill-id YOUR_SKILL_ID --profile $Profile"
    }

    Write-Step 'Deploying skill-package with ask deploy'
    $deployArgs = @('deploy', '--target', 'skill-metadata', '--profile', $Profile)

    if (-not $NoIgnoreHash) {
        $deployArgs += '--ignore-hash'
    }

    [void](Invoke-AskCli -Arguments $deployArgs)
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$skillPackagePath = Join-Path $projectRoot 'skill-package'
$zipPath = Join-Path $projectRoot 'dist/skill-package-import.zip'

Push-Location $projectRoot
try {
    if (-not (Test-Path -LiteralPath $skillPackagePath -PathType Container)) {
        throw "skill-package directory was not found: $skillPackagePath"
    }

    Test-SkillPackage -SkillPackagePath $skillPackagePath
    $createdZipPath = New-SkillPackageZip -SkillPackagePath $skillPackagePath -ZipPath $zipPath

    if ($ValidateOnly) {
        Write-Step 'Validation complete'
        Write-Host 'No deployment was attempted because -ValidateOnly was specified.' -ForegroundColor Green
        return
    }

    Assert-AskCliInstalled

    $resolvedMethod = $Method
    if ($resolvedMethod -eq 'Auto') {
        if ([string]::IsNullOrWhiteSpace($SkillId)) {
            $resolvedMethod = 'Deploy'
        }
        else {
            $resolvedMethod = 'Import'
        }
    }

    if ($resolvedMethod -eq 'Import') {
        Import-SkillPackageWithSmapi `
            -SkillId $SkillId `
            -Profile $Profile `
            -ZipPath $createdZipPath `
            -SkipPolling:$SkipPolling `
            -PollSeconds $PollSeconds `
            -PollIntervalSeconds $PollIntervalSeconds
    }
    else {
        Deploy-SkillPackageWithAskProject -ProjectRoot $projectRoot -Profile $Profile -NoIgnoreHash:$NoIgnoreHash
    }

    Write-Step 'Done'
    Write-Host 'The full skill-package was pushed. In the Alexa Developer Console, check Build > Multimodal Responses > Widget for kids-chore-chart.' -ForegroundColor Green
}
finally {
    Pop-Location
}
