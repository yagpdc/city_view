<#
.SYNOPSIS
  Envia os arquivos de mapa de data/out para o bucket do Cloudflare R2 (cityview-dados).

.DESCRIPTION
  Usa o rclone (baixado em D:\dev\rclone na primeira vez, do site oficial rclone.org). As chaves do R2 são
  pedidas na hora e ficam só na memória deste processo: nada é gravado em disco nem enviado a outro lugar.
  Tudo fica no D: (ferramenta, cache e temporários).

.EXAMPLE
  .\deploy\publish-r2.ps1
  .\deploy\publish-r2.ps1 -Only places
  .\deploy\publish-r2.ps1 -Sample        # inclui o exemplo de 30 milhões de registros (458 MB)
#>
param(
  [string] $Bucket = "cityview-dados",
  [ValidateSet("all", "basemap", "assets", "datapacks", "places")] [string] $Only = "all",
  [switch] $Sample
)
$ErrorActionPreference = "Stop"
$Root = Join-Path $PSScriptRoot ".." | Resolve-Path
$Out = Join-Path $Root "data\out"
$Tools = "D:\dev\rclone"
$env:TMP = "D:\city_view\target\tmp"; $env:TEMP = $env:TMP
New-Item -ItemType Directory -Force $Tools, $env:TMP | Out-Null

# rclone portátil (uma vez)
$Rclone = Get-ChildItem $Tools -Recurse -Filter rclone.exe -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $Rclone) {
  Write-Host "Baixando o rclone (rclone.org) para $Tools..." -ForegroundColor Cyan
  $zip = Join-Path $env:TMP "rclone.zip"
  Invoke-WebRequest "https://downloads.rclone.org/rclone-current-windows-amd64.zip" -OutFile $zip
  Expand-Archive $zip -DestinationPath $Tools -Force
  Remove-Item $zip
  $Rclone = Get-ChildItem $Tools -Recurse -Filter rclone.exe | Select-Object -First 1 -ExpandProperty FullName
}

# Chaves: digitadas agora, só na memória deste processo.
Write-Host "Cole os dados do token do R2 (R2 > Manage API Tokens). Nada é gravado." -ForegroundColor Cyan
$endpoint = (Read-Host "Endereço S3 (termina em .r2.cloudflarestorage.com)").Trim().TrimEnd("/")
if ($endpoint -match '^cfat_') { throw "Isso é o 'Token value' (cfat_...). Use o endereço S3/Endpoint, que termina em .r2.cloudflarestorage.com. Por segurança, apague esse token e crie outro." }
if ($endpoint -notmatch '^https?://') { $endpoint = "https://$endpoint" }
if ($endpoint -notmatch '^https://[a-z0-9]+\.(eu\.|fedramp\.)?r2\.cloudflarestorage\.com$') { throw "Endereço S3 inválido: '$endpoint'. Deve ser algo como https://<id-da-conta>.r2.cloudflarestorage.com (em R2 > bucket > Settings > S3 API)." }
$keyId = (Read-Host "Access Key ID").Trim()
$secretSecure = Read-Host "Secret Access Key" -AsSecureString
$secret = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretSecure))

$env:RCLONE_CONFIG = Join-Path $Tools "rclone.conf"   # vazio; a configuração vem das variáveis abaixo
$env:RCLONE_CACHE_DIR = Join-Path $Tools "cache"
$env:RCLONE_CONFIG_R2_TYPE = "s3"
$env:RCLONE_CONFIG_R2_PROVIDER = "Cloudflare"
$env:RCLONE_CONFIG_R2_ACCESS_KEY_ID = $keyId
$env:RCLONE_CONFIG_R2_SECRET_ACCESS_KEY = $secret
$env:RCLONE_CONFIG_R2_ENDPOINT = $endpoint
$env:RCLONE_CONFIG_R2_NO_CHECK_BUCKET = "true"

# Mesmos arquivos que o app lê (src/dataUrl.ts).
$Parts = [ordered]@{
  basemap   = @("brasil.pmtiles", "cidades.pmtiles")
  assets    = @("assets")
  datapacks = @("datapacks")
  places    = @("places/brasil", "places/brasil.release.json", "places/sao-paulo", "places/sao-paulo.release.json")
}
if ($Sample) { $Parts["sample"] = @("empresas") }

$flags = @("--progress", "--transfers", "4", "--s3-upload-cutoff", "100M", "--s3-chunk-size", "64M", "--stats-one-line")
try {
  foreach ($name in $Parts.Keys) {
    if ($Only -ne "all" -and $Only -ne $name) { continue }
    foreach ($rel in $Parts[$name]) {
      $local = Join-Path $Out $rel
      if (-not (Test-Path $local)) { Write-Host "  (pulando ${rel}: não existe em data/out)" -ForegroundColor DarkGray; continue }
      $dest = "r2:$Bucket/$($rel -replace '\\', '/')"
      Write-Host "Enviando $rel..." -ForegroundColor Cyan
      if ((Get-Item $local).PSIsContainer) { & $Rclone copy $local $dest @flags } else { & $Rclone copyto $local $dest @flags }
      if ($LASTEXITCODE -ne 0) { throw "falhou ao enviar $rel" }
    }
  }
  Write-Host "Pronto. Arquivos no bucket ${Bucket}:" -ForegroundColor Green
  & $Rclone size "r2:$Bucket"
} finally {
  # Apaga as chaves do ambiente deste processo.
  Remove-Item Env:RCLONE_CONFIG_R2_ACCESS_KEY_ID, Env:RCLONE_CONFIG_R2_SECRET_ACCESS_KEY -ErrorAction SilentlyContinue
  $secret = $null
}
