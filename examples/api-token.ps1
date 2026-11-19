# Calling the API with a personal access token.
#
# 1. Sign in, open Account security > API tokens, and create a token with only the
#    permissions this script needs (here: assets.view, assets.create and assets.edit) and a
#    short expiry.
# 2. Keep the token out of the script and out of source control: put it in an environment
#    variable for the session.
#
#    $env:GRC_TOKEN = 'grc_pat_...'
#    .\examples\api-token.ps1 -BaseUrl http://127.0.0.1:8080
#
# A token needs no X-GRC-CSRF header and sends no cookie. It can never be used for sign-in,
# password, second-factor or token management routes. Integrations use the stable base path
# /api/v1 (see docs/api.md for paging, rate limits, idempotency and the other conventions;
# examples/api-client.mjs is the same in Node.js).

param(
  [string]$BaseUrl = 'http://127.0.0.1:8080'
)

if (-not $env:GRC_TOKEN) { throw 'Set $env:GRC_TOKEN to a personal access token first.' }
$headers = @{ Authorization = "Bearer $env:GRC_TOKEN" }

# Who am I, and what may this token do?
$state = Invoke-RestMethod -Uri "$BaseUrl/api/v1/auth/state" -Headers $headers
"Signed in as $($state.user.displayName) with $($state.permissions.Count) permission(s)"

# Full-text search over assets: ranked, last word matched as a prefix.
$found = Invoke-RestMethod -Uri "$BaseUrl/api/v1/assets?q=depot%20router&pageSize=5" -Headers $headers
$found.rows | ForEach-Object { "$($_.tag)  $($_.name)" }

# Send invented asset records to the ingest route (upsert by serial number, then by tag).
$body = @{
  assets = @(
    @{ name = 'Depot gate controller'; serial = 'EX-SN-0001'; asset_type = 'network_device' }
  )
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/v1/assets/ingest" -Headers $headers -ContentType 'application/json' -Body $body

# The machine-readable description of every route this token may call.
Invoke-RestMethod -Uri "$BaseUrl/api/v1/openapi.json" -Headers $headers | ConvertTo-Json -Depth 50 | Out-File -Encoding utf8 openapi.json
