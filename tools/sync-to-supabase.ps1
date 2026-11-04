<#
    sync-to-supabase.ps1 - copy this PC's tracker data to Supabase.

    Nothing needs installing: this uses PowerShell, which every Windows PC has.
    The desktop app is not modified and keeps working offline; this script only reads
    its data file and pushes it to the cloud.

    FIRST RUN (stores the key once):
        powershell -ExecutionPolicy Bypass -File sync-to-supabase.ps1 -SetKey

    DAILY USE:
        powershell -ExecutionPolicy Bypass -File sync-to-supabase.ps1 -Verify    # compare, write nothing
        powershell -ExecutionPolicy Bypass -File sync-to-supabase.ps1            # push
        powershell -ExecutionPolicy Bypass -File sync-to-supabase.ps1 -Quiet     # push, say nothing (scheduled)

    The key is stored DPAPI-encrypted, so the file is usable only by this Windows user
    on this PC. It is never written to the repo.

    Conflict rule: THE PC WINS. The cloud copy is overwritten with the local file.
    Rows are never deleted unless you pass -Prune, which is deliberately not the default.
#>
[CmdletBinding()]
param(
    [switch]$SetKey,
    [switch]$Verify,
    [switch]$Quiet,
    [switch]$Prune,
    [string]$DataFile,
    [string]$SupabaseUrl = 'https://qbhigtwejckzvocrwaqb.supabase.co'
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- configuration
$SupabaseUrl = $SupabaseUrl.TrimEnd('/')
$AppDir      = Join-Path $env:LOCALAPPDATA 'ApexMonsterTracker'
$KeyFile     = Join-Path $AppDir 'supabase.key'
$StateFile   = Join-Path $AppDir 'sync-state.json'
$LogFile     = Join-Path $AppDir 'sync.log'
if (-not $DataFile) { $DataFile = Join-Path $AppDir 'data.json' }

$Collections = @('sales', 'restocks', 'refmoves', 'money', 'oct_batches')
$Documents   = @('settings/main', 'oct/config')

function Write-Log([string]$Message, [string]$Level = 'INFO') {
    $line = '{0}  {1,-5}  {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    if (-not $Quiet) {
        switch ($Level) {
            'ERROR' { Write-Host $line -ForegroundColor Red }
            'WARN'  { Write-Host $line -ForegroundColor Yellow }
            default { Write-Host $line }
        }
    }
}

function Fail([string]$Message) {
    Write-Log $Message 'ERROR'
    if (-not $Quiet) { Write-Host ''; Write-Host 'Sync failed. The app and your local data are unaffected.' -ForegroundColor Yellow }
    exit 1
}

# ---------------------------------------------------------------- key handling
function Set-StoredKey {
    if (-not (Test-Path $AppDir)) { New-Item -ItemType Directory -Path $AppDir -Force | Out-Null }

    Write-Host ''
    Write-Host 'Supabase secret key setup' -ForegroundColor Cyan
    Write-Host 'Get it from: Supabase dashboard -> your project -> Project Settings -> API keys'
    Write-Host '             -> the key labelled "secret" / "service_role".' -ForegroundColor Gray
    Write-Host 'It starts with either sb_secret_ or eyJ. It is not the publishable/anon key.' -ForegroundColor Gray
    Write-Host ''

    $secure = Read-Host -AsSecureString 'Paste the secret key (input is hidden)'
    $plain  = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
                  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))

    if ([string]::IsNullOrWhiteSpace($plain)) { Write-Host 'Nothing entered - nothing saved.' -ForegroundColor Yellow; exit 1 }
    if ($plain -like 'sb_publishable_*' -or $plain -like 'anon*') {
        Write-Host 'That is the publishable (public) key. It cannot write: row level security blocks it.' -ForegroundColor Red
        Write-Host 'Use the secret / service_role key instead.' -ForegroundColor Red
        exit 1
    }

    $secure | ConvertFrom-SecureString | Set-Content -Path $KeyFile -Encoding ASCII
    # lock the file down to this Windows user
    & icacls $KeyFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

    Write-Host ''
    Write-Host "Key saved (encrypted, this Windows user only): $KeyFile" -ForegroundColor Green
    Write-Host 'Test it now with:   -Verify' -ForegroundColor Green
    exit 0
}

function Get-StoredKey {
    if ($env:APEX_SUPABASE_KEY) { return $env:APEX_SUPABASE_KEY }
    if (-not (Test-Path $KeyFile)) {
        Fail "No key stored yet. Run once with -SetKey. (Expected at $KeyFile)"
    }
    try {
        $secure = Get-Content -Path $KeyFile | ConvertTo-SecureString
    } catch {
        Fail "Could not decrypt the stored key. Re-run with -SetKey on this PC, as this Windows user."
    }
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try   { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

# ---------------------------------------------------------------- http helpers
$script:Headers = $null

function Initialize-Api([string]$Key) {
    $script:Headers = @{
        apikey        = $Key
        Authorization = "Bearer $Key"
    }
}

function Invoke-Supa([string]$Method, [string]$Path, $Body) {
    $params = @{
        Uri         = "$SupabaseUrl$Path"
        Method      = $Method
        Headers     = $script:Headers
        TimeoutSec  = 30
        ErrorAction = 'Stop'
    }
    if ($null -ne $Body) {
        $params.Body        = $Body
        $params.ContentType = 'application/json; charset=utf-8'
    }
    try {
        return Invoke-RestMethod @params
    } catch {
        $detail = $_.Exception.Message
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
        throw "Supabase rejected $Method $Path : $detail"
    }
}

function ConvertTo-JsonArray($Items) {
    # -InputObject keeps an array an array, and -Depth keeps nested oct_batches items intact
    return ConvertTo-Json -InputObject @($Items) -Depth 10 -Compress
}

# ---------------------------------------------------------------- mapping
function Get-Rows($Data) {
    $rows = [ordered]@{}

    $rows['sales'] = @($Data.sales | ForEach-Object {
        [pscustomobject]@{
            id          = $_.id
            buyer       = $_.buyer
            flavor      = $_.flavor
            qty         = $_.qty
            price       = $_.price
            cost        = $(if ($null -ne $_.cost) { $_.cost } else { 54.17 })
            method      = $(if ($_.method) { $_.method } else { 'Cash' })
            paid        = $(if ($null -ne $_.paid) { [bool]$_.paid } else { $true })
            paid_method = $_.paidMethod
            ts          = $_.ts
        }
    })

    $rows['restocks'] = @($Data.restocks | ForEach-Object {
        [pscustomobject]@{
            id        = $_.id
            flavor    = $_.flavor
            qty       = $_.qty
            cost      = $(if ($null -ne $_.cost) { $_.cost } else { 54.17 })
            expense   = $(if ($null -ne $_.expense) { $_.expense } else { 0 })
            paid_from = $_.paidFrom
            type      = $(if ($_.type) { $_.type } else { 'restock' })
            ts        = $_.ts
        }
    })

    $rows['refmoves'] = @($Data.refmoves | ForEach-Object {
        [pscustomobject]@{
            id     = $_.id
            flavor = $_.flavor
            qty    = $_.qty
            type   = $(if ($_.type) { $_.type } else { 'move' })
            ts     = $_.ts
        }
    })

    $rows['money'] = @($Data.money | ForEach-Object {
        [pscustomobject]@{
            id         = $_.id
            type       = $_.type
            amount     = $_.amount
            category   = $_.category
            account    = $(if ($_.account) { $_.account } else { 'Cash' })
            to_account = $_.to
            note       = $_.note
            ts         = $_.ts
        }
    })

    $rows['oct_batches'] = @($Data.oct_batches | ForEach-Object {
        [pscustomobject]@{
            id       = $_.id
            label    = $_.label
            ord      = $(if ($null -ne $_.order) { $_.order } else { 1 })
            capital  = $(if ($null -ne $_.capital) { $_.capital } else { 0 })
            shipping = $(if ($null -ne $_.shipping) { $_.shipping } else { 0 })
            items    = @($_.items)
        }
    })

    $rows['app_documents'] = @($Documents | Where-Object { $null -ne $Data.$_ } | ForEach-Object {
        [pscustomobject]@{ path = $_; data = $Data.$_ }
    })

    return $rows
}

# ---------------------------------------------------------------- commands
function Invoke-Push($Data, $Rows) {
    $summary = @()
    foreach ($table in ($Collections + 'app_documents')) {
        $batch = @($Rows[$table])
        if ($batch.Count -eq 0) {
            # an empty collection is fine - nothing to send, nothing to delete
            $summary += "$table=0"
            continue
        }
        for ($i = 0; $i -lt $batch.Count; $i += 500) {
            $chunk = $batch[$i..([Math]::Min($i + 499, $batch.Count - 1))]
            $headers = @{}
            foreach ($k in $script:Headers.Keys) { $headers[$k] = $script:Headers[$k] }
            $headers['Prefer'] = 'resolution=merge-duplicates,return=minimal'
            $body = ConvertTo-JsonArray $chunk
            try {
                Invoke-RestMethod -Uri "$SupabaseUrl/rest/v1/$table" -Method Post -Headers $headers `
                    -ContentType 'application/json; charset=utf-8' -Body $body -TimeoutSec 30 -ErrorAction Stop | Out-Null
            } catch {
                $detail = $_.Exception.Message
                if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
                throw "Push to $table failed: $detail"
            }
        }
        $summary += "$table=$($batch.Count)"
    }

    if ($Prune) {
        Write-Log 'Prune requested: deleting cloud rows that are not in the local file.' 'WARN'
        foreach ($table in $Collections) {
            $keep = @($Rows[$table] | ForEach-Object { $_.id })
            $filter = if ($keep.Count -eq 0) { 'id=not.is.null' } else {
                'id=not.in.(' + (($keep | ForEach-Object { '"' + $_ + '"' }) -join ',') + ')'
            }
            $headers = @{}
            foreach ($k in $script:Headers.Keys) { $headers[$k] = $script:Headers[$k] }
            $headers['Prefer'] = 'return=minimal'
            Invoke-RestMethod -Uri ($SupabaseUrl + '/rest/v1/' + $table + '?' + $filter) -Method Delete -Headers $headers -TimeoutSec 30 | Out-Null
        }
    }

    return ($summary -join ' ')
}

function Get-CloudCount([string]$Table) {
    # app_documents has no id column: it is keyed by path
    $keyColumn = if ($Table -eq 'app_documents') { 'path' } else { 'id' }
    $result = Invoke-Supa 'GET' ('/rest/v1/' + $Table + '?select=' + $keyColumn) $null
    # an empty table comes back as $null, and @($null).Count is 1 - guard it
    if ($null -eq $result) { return 0 }
    return @($result).Count
}

function Invoke-Verify($Rows) {
    Write-Log 'Verifying local against cloud (no writes).'
    $ok = $true
    $lines = @()

    foreach ($table in ($Collections + 'app_documents')) {
        $local = @($Rows[$table]).Count
        try   { $cloud = Get-CloudCount $table }
        catch { Write-Log "Could not read $table from the cloud: $($_.Exception.Message)" 'ERROR'; $ok = $false; continue }
        $mark = if ($local -eq $cloud) { 'ok' } else { 'DIFFERS' }
        if ($local -ne $cloud) { $ok = $false }
        $lines += "  {0,-14} local {1,4}   cloud {2,4}   {3}" -f $table, $local, $cloud, $mark
    }

    $localRevenue = 0
    foreach ($s in @($Rows['sales'])) { $localRevenue += ([double]$s.qty * [double]$s.price) }
    try {
        $totals = Invoke-Supa 'GET' '/rest/v1/v_daily_totals?select=revenue' $null
        $cloudRevenue = 0
        if ($null -ne $totals) {
            foreach ($t in @($totals)) { $cloudRevenue += [double]$t.revenue }
        }
        $match = if ([Math]::Abs($localRevenue - $cloudRevenue) -lt 0.005) { 'ok' } else { 'DIFFERS' }
        if ($match -ne 'ok') { $ok = $false }
        $lines += ('  {0,-14} local {1,8}   cloud {2,8}   {3}' -f 'revenue', $localRevenue.ToString('0.00'), $cloudRevenue.ToString('0.00'), $match)
    } catch {
        Write-Log "Could not read revenue from the cloud: $($_.Exception.Message)" 'ERROR'
        $ok = $false
    }

    foreach ($l in $lines) { Write-Log $l }
    if ($ok) { Write-Log 'Local and cloud agree.' }
    else     { Write-Log "Local and cloud disagree - run the script without -Verify to push this PC's data up." 'WARN' }
    return $ok
}

# ---------------------------------------------------------------- main
if ($SetKey) { Set-StoredKey }

if (-not (Test-Path $DataFile)) {
    Fail "No data file at $DataFile. Open the app and record something first, or pass -DataFile <path>."
}

try {
    $raw  = Get-Content -Path $DataFile -Raw -Encoding UTF8
    $Data = $raw | ConvertFrom-Json
} catch {
    Fail "Could not read $DataFile as JSON: $($_.Exception.Message)"
}

foreach ($c in $Collections) {
    if ($null -eq $Data.$c) { Fail "The data file has no '$c' collection - it looks corrupt. Nothing was sent." }
}

$Rows = Get-Rows $Data

# Resolve the key before anything can short-circuit. Otherwise a missing or undecryptable
# key on an unchanged dataset would exit 0, and a scheduled task would report success
# every night while nothing was actually being synced.
$key = Get-StoredKey

if ($Verify) {
    Initialize-Api $key
    $ok = Invoke-Verify $Rows
    if ($ok) { exit 0 } else { exit 2 }
}

# skip the network entirely when nothing has changed since the last push
$hash = (Get-FileHash -Path $DataFile -Algorithm SHA256).Hash
if (Test-Path $StateFile) {
    try {
        $state = Get-Content -Path $StateFile -Raw | ConvertFrom-Json
        if ($state.hash -eq $hash) {
            Write-Log 'Data unchanged since the last successful push - nothing to do.' 'INFO'
            exit 0
        }
    } catch { }
}

try {
    Initialize-Api $key
    Write-Log "Pushing $DataFile to $SupabaseUrl"
    $summary = Invoke-Push $Data $Rows
    Write-Log "Pushed: $summary"

    $ok = Invoke-Verify $Rows
    if (-not $ok) { Fail 'Push ran but the cloud does not match the local file. Check the log above.' }

    [pscustomobject]@{ hash = $hash; pushedAt = (Get-Date -Format 's'); rows = $summary } |
        ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8

    Write-Log 'Sync complete.' 'INFO'
    exit 0
} catch {
    Fail $_.Exception.Message
}
