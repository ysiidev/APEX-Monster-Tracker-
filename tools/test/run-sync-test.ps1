<#
    run-sync-test.ps1 — proves the PowerShell sync actually works, without touching Supabase.

    Checks, in order:
      1. both scripts parse (real PowerShell parser, not a guess)
      2. the sync runs against a mock REST server and pushes every record
      3. a second push merges a new sale instead of duplicating the old ones
      4. -Verify reports a match afterwards
      5. a missing key fails loudly instead of silently doing nothing

    Needs Node.js for the mock server (present on GitHub runners and most dev PCs).
    Run from the repo root:  powershell -ExecutionPolicy Bypass -File tools/test/run-sync-test.ps1
#>
[CmdletBinding()]
param([int]$Port = 8099)

$ErrorActionPreference = 'Stop'
$root   = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$sync   = Join-Path $root 'tools\sync-to-supabase.ps1'
$mockJs = Join-Path $PSScriptRoot 'mock-supabase.mjs'
$snap   = Join-Path $root 'APEX-Tracker-Continuation\desktop\app\snapshot.json'
$work   = Join-Path ([IO.Path]::GetTempPath()) ('apex-sync-test-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$base   = "http://127.0.0.1:$Port"
$failures = 0

function Step($name) { Write-Host ''; Write-Host "== $name" -ForegroundColor Cyan }
function Ok($msg)     { Write-Host "   PASS  $msg" -ForegroundColor Green }
function Bad($msg)    { Write-Host "   FAIL  $msg" -ForegroundColor Red; $script:failures++ }
function Check($cond, $msg) { if ($cond) { Ok $msg } else { Bad $msg } }

# ---------------------------------------------------------------- 1. parse check
Step 'Parsing the scripts'
foreach ($file in @($sync, (Join-Path $root 'tools\install-sync-task.ps1'))) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($file, [ref]$tokens, [ref]$errors)
    if ($errors -and $errors.Count -gt 0) {
        foreach ($e in $errors) { Write-Host "::error file=$file::$($e.Message) (line $($e.Extent.StartLineNumber))" }
        Bad "$(Split-Path -Leaf $file) does not parse"
    } else {
        Ok "$(Split-Path -Leaf $file) parses ($($tokens.Count) tokens)"
    }
}
if ($failures -gt 0) { Write-Host 'Syntax errors — stopping before running anything.' -ForegroundColor Red; exit 1 }

# ---------------------------------------------------------------- fixtures
New-Item -ItemType Directory -Path $work -Force | Out-Null
$dataFile = Join-Path $work 'data.json'
Copy-Item $snap $dataFile
$data = Get-Content $dataFile -Raw | ConvertFrom-Json
$expectedSales = @($data.sales).Count
Write-Host "   fixture: $expectedSales sales from the packaged snapshot" -ForegroundColor Gray

# ---------------------------------------------------------------- 2. start the mock
Step 'Starting the mock Supabase'
$mock = Start-Process -FilePath 'node' -ArgumentList @($mockJs, $Port) -PassThru -NoNewWindow `
        -RedirectStandardOutput (Join-Path $work 'mock.out.log') -RedirectStandardError (Join-Path $work 'mock.err.log')
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
    try { Invoke-RestMethod -Uri "$base/health" -TimeoutSec 2 | Out-Null; $ready = $true; break } catch { Start-Sleep -Milliseconds 250 }
}
if (-not $ready) {
    Write-Host '::error title=Mock server::did not start' 
    Get-Content (Join-Path $work 'mock.err.log') -ErrorAction SilentlyContinue | Write-Host
    Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
    exit 1
}
Ok "mock listening on $base"

$env:APEX_SUPABASE_KEY = 'test-key-not-a-real-secret'
$env:LOCALAPPDATA = $work          # keep the key file, log and state out of the real profile

function Invoke-Sync([string[]]$Extra) {
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $sync, '-DataFile', $dataFile, '-SupabaseUrl', $base) + $Extra
    $out = & powershell @argv 2>&1
    return [pscustomobject]@{ code = $LASTEXITCODE; out = ($out -join "`n") }
}

function Get-MockCount([string]$Table) {
    $headers = @{ apikey = 'test-key'; Authorization = 'Bearer test-key' }
    $key = if ($Table -eq 'app_documents') { 'path' } else { 'id' }
    $r = Invoke-RestMethod -Uri ($base + "/rest/v1/" + $Table + "?select=" + $key) -Headers $headers
    if ($null -eq $r) { return 0 }
    return @($r).Count
}

try {
    # ------------------------------------------------------------ 3. first push
    Step 'First push'
    $result = Invoke-Sync @()
    Write-Host $result.out -ForegroundColor DarkGray
    Check ($result.code -eq 0) "exit code 0 (got $($result.code))"
    Check ($result.out -match 'Sync complete') 'reports "Sync complete"'
    Check ((Get-MockCount 'sales') -eq $expectedSales) "cloud has $expectedSales sales"
    Check ((Get-MockCount 'restocks') -eq @($data.restocks).Count) "cloud has $(@($data.restocks).Count) restocks"
    Check ((Get-MockCount 'app_documents') -eq 2) 'cloud has both documents (path-keyed)'

    # ------------------------------------------------------------ 4. merge, not duplicate
    Step 'Second push with one extra sale'
    $newSale = [pscustomobject]@{
        id = 'test-sale-1'; buyer = 'Sync Test'; flavor = 'Ultra White (White)'; qty = 1
        price = 95; cost = 54.17; method = 'Cash'; paid = $true; ts = 1793800000000
    }
    $data.sales = @($data.sales) + $newSale
    ConvertTo-Json -InputObject $data -Depth 20 | Set-Content -Path $dataFile -Encoding UTF8
    $result = Invoke-Sync @()
    Write-Host $result.out -ForegroundColor DarkGray
    $expectedSales++
    Check ($result.code -eq 0) "exit code 0 (got $($result.code))"
    Check ((Get-MockCount 'sales') -eq $expectedSales) "cloud still has exactly $expectedSales sales (upsert, not duplicate)"

    # ------------------------------------------------------------ 5. verify mode
    Step 'Verify mode'
    $result = Invoke-Sync @('-Verify')
    Write-Host $result.out -ForegroundColor DarkGray
    Check ($result.code -eq 0) "verify exits 0 when local and cloud agree (got $($result.code))"
    Check ($result.out -match 'Local and cloud agree') 'says "Local and cloud agree"'

    # ------------------------------------------------------------ 6. missing key fails loudly
    Step 'No key'
    $saved = $env:APEX_SUPABASE_KEY
    $env:APEX_SUPABASE_KEY = ''
    $result = Invoke-Sync @()
    $env:APEX_SUPABASE_KEY = $saved
    Check ($result.code -ne 0) "fails when no key is stored (exit $($result.code))"
    Check ($result.out -match 'No key stored yet') 'explains that no key is stored'
} finally {
    Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
    Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
if ($failures -gt 0) {
    Write-Host "::error title=Sync tests::$failures check(s) failed"
    Write-Host "$failures check(s) failed" -ForegroundColor Red
    exit 1
}
Write-Host 'All sync checks passed.' -ForegroundColor Green
exit 0
