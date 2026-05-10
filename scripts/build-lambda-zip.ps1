<#
Creates a ZIP archive for Alexa-hosted skill Code > Import Code.

Alexa's import requirements this script enforces:
- ZIP has a root-level lambda/ directory entry.
- ZIP contains skill code under lambda/ only.
- ZIP excludes node_modules; Alexa-hosted deploy installs dependencies from lambda/package.json.
- ZIP has no more than 100 files.
- ZIP is less than 50 MB.
- No imported file is larger than 6 MB.
#>

[CmdletBinding()]
param(
    [string]$OutputPath = 'dist/lambda-import.zip'
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$lambdaPath = Join-Path $repoRoot 'lambda'
$zipPath = Join-Path $repoRoot $OutputPath
$distPath = Split-Path $zipPath -Parent
$stagingPath = Join-Path $repoRoot 'dist/lambda-import-staging'
$stagedLambdaPath = Join-Path $stagingPath 'lambda'

function Get-ZipRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath,

        [Parameter(Mandatory = $true)]
        [string]$ChildPath
    )

    $root = (Resolve-Path $RootPath).Path.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $child = (Resolve-Path $ChildPath).Path
    $rootUri = [System.Uri]::new($root)
    $childUri = [System.Uri]::new($child)

    return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($childUri).ToString()).Replace('\', '/')
}

function Add-ZipDirectoryEntry {
    param(
        [Parameter(Mandatory = $true)]
        [System.IO.Compression.ZipArchive]$Archive,

        [System.Collections.Generic.HashSet[string]]$CreatedEntries,

        [Parameter(Mandatory = $true)]
        [string]$EntryName
    )

    $normalizedEntryName = $EntryName.TrimEnd('/') + '/'

    if ($CreatedEntries.Add($normalizedEntryName)) {
        $null = $Archive.CreateEntry($normalizedEntryName)
    }
}

if (-not (Test-Path $lambdaPath)) {
    throw "Lambda folder not found: $lambdaPath"
}

if (-not (Test-Path (Join-Path $lambdaPath 'index.js'))) {
    throw "Required Node.js entry point not found: $(Join-Path $lambdaPath 'index.js')"
}

if (-not (Test-Path (Join-Path $lambdaPath 'package.json'))) {
    throw "Required Node.js package file not found: $(Join-Path $lambdaPath 'package.json')"
}

New-Item -ItemType Directory -Force -Path $distPath | Out-Null
Remove-Item -Recurse -Force -Path $stagingPath -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $stagedLambdaPath | Out-Null

Get-ChildItem -Path $lambdaPath -Force |
    Where-Object { $_.Name -notin @('node_modules', 'package-lock.json') } |
    Copy-Item -Recurse -Force -Destination $stagedLambdaPath

$stagedFiles = @(Get-ChildItem -Path $stagedLambdaPath -Recurse -File -Force)

if ($stagedFiles.Count -gt 100) {
    throw "Alexa import supports up to 100 files. This package has $($stagedFiles.Count) files."
}

$oversizedFiles = @($stagedFiles | Where-Object { $_.Length -gt 6MB })
if ($oversizedFiles.Count -gt 0) {
    $fileList = ($oversizedFiles | ForEach-Object { $_.FullName }) -join ', '
    throw "Alexa import supports files up to 6 MB. Oversized files: $fileList"
}

Remove-Item -Force -Path $zipPath -ErrorAction SilentlyContinue

$zipStream = [System.IO.File]::Open($zipPath, [System.IO.FileMode]::CreateNew)
$zipArchive = [System.IO.Compression.ZipArchive]::new($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
$createdEntries = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

try {
    Add-ZipDirectoryEntry -Archive $zipArchive -CreatedEntries $createdEntries -EntryName 'lambda/'

    Get-ChildItem -Path $stagingPath -Recurse -Directory -Force |
        Sort-Object FullName |
        ForEach-Object {
            $entryName = Get-ZipRelativePath -RootPath $stagingPath -ChildPath $_.FullName
            Add-ZipDirectoryEntry -Archive $zipArchive -CreatedEntries $createdEntries -EntryName $entryName
        }

    $stagedFiles |
        Sort-Object FullName |
        ForEach-Object {
            $entryName = Get-ZipRelativePath -RootPath $stagingPath -ChildPath $_.FullName
            $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zipArchive,
                $_.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal)
        }
}
finally {
    $zipArchive.Dispose()
    $zipStream.Dispose()
}

Remove-Item -Recurse -Force -Path $stagingPath

$zipInfo = Get-Item $zipPath
if ($zipInfo.Length -gt 50MB) {
    throw "Alexa import supports ZIP archives up to 50 MB. Created archive is $([Math]::Round($zipInfo.Length / 1MB, 2)) MB."
}

$validationArchive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entryNames = @($validationArchive.Entries | ForEach-Object { $_.FullName })

    if ($entryNames -notcontains 'lambda/') {
        throw 'Created ZIP does not contain an explicit root-level lambda/ directory entry.'
    }

    if ($entryNames -notcontains 'lambda/index.js') {
        throw 'Created ZIP does not contain lambda/index.js.'
    }

    if ($entryNames -notcontains 'lambda/package.json') {
        throw 'Created ZIP does not contain lambda/package.json.'
    }

    $fileEntryCount = @($validationArchive.Entries | Where-Object { -not $_.FullName.EndsWith('/') }).Count
    Write-Host "Created $zipPath"
    Write-Host "ZIP entries: $($validationArchive.Entries.Count) total, $fileEntryCount files"
    Write-Host 'Root entries:'
    $entryNames | Where-Object { $_ -like 'lambda/*' } | Sort-Object | ForEach-Object { Write-Host "  $_" }
}
finally {
    $validationArchive.Dispose()
}
