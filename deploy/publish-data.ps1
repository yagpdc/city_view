<#
.SYNOPSIS
  Envia os dados públicos (tiles, fontes, datapacks) de data/out para a VM do City View.

.EXAMPLE
  .\deploy\publish-data.ps1 -Ip 123.45.67.89
  .\deploy\publish-data.ps1 -Ip 123.45.67.89 -Only places       # só uma parte
  .\deploy\publish-data.ps1 -Ip 123.45.67.89 -Workspace         # também os datasets enviados ao servidor local
#>
param(
  [Parameter(Mandatory)] [string] $Ip,
  [string] $User = "ubuntu",
  [string] $Key = "$HOME\.ssh\oracle_cityview",
  [ValidateSet("all", "basemap", "assets", "datapacks", "places", "sample")] [string] $Only = "all",
  [switch] $Workspace
)
$ErrorActionPreference = "Stop"
$Out = Join-Path $PSScriptRoot "..\data\out" | Resolve-Path
$Remote = "/opt/cityview/data"
$Target = "$User@$Ip"
$Ssh = @("-i", $Key, "-o", "StrictHostKeyChecking=accept-new")

# O que vai para o servidor (o resto de data/out, como os .parquet de origem, fica só aqui).
$Parts = [ordered]@{
  basemap   = @("brasil.pmtiles", "sao-paulo.pmtiles", "sao-paulo-terrain.pmtiles")
  assets    = @("assets")
  datapacks = @("datapacks")
  places    = @("places/brasil", "places/brasil.release.json", "places/sao-paulo", "places/sao-paulo.release.json")
  sample    = @("empresas")
}

function Send([string] $Rel) {
  $Local = Join-Path $Out $Rel
  if (-not (Test-Path $Local)) { Write-Host "  (pulando ${Rel}: não existe em data/out)" -ForegroundColor DarkGray; return }
  $Dir = Split-Path $Rel -Parent
  $Dest = if ($Dir) { "$Remote/$($Dir -replace '\\', '/')/" } else { "$Remote/" }
  $Size = if ((Get-Item $Local).PSIsContainer) { (Get-ChildItem $Local -Recurse -File | Measure-Object Length -Sum).Sum } else { (Get-Item $Local).Length }
  Write-Host ("  {0}  ({1:N0} MB)" -f $Rel, ($Size / 1MB))
  & ssh @Ssh $Target "mkdir -p '$Dest'"
  & scp @Ssh -r -q $Local "${Target}:$Dest"
  if ($LASTEXITCODE -ne 0) { throw "falhou ao enviar $Rel" }
}

foreach ($name in $Parts.Keys) {
  if ($Only -ne "all" -and $Only -ne $name) { continue }
  Write-Host "Enviando $name..." -ForegroundColor Cyan
  foreach ($rel in $Parts[$name]) { Send $rel }
}

if ($Workspace) {
  $Ws = Join-Path $PSScriptRoot "..\data\workspace\datasets" | Resolve-Path
  Write-Host "Enviando datasets do servidor local..." -ForegroundColor Cyan
  & ssh @Ssh $Target "mkdir -p ~/cityview-upload"
  & scp @Ssh -r -q "$Ws\*" "${Target}:~/cityview-upload/"
  & ssh @Ssh $Target "sudo cp -r ~/cityview-upload/. /opt/cityview/workspace/datasets/ && sudo chown -R cityview:cityview /opt/cityview/workspace && rm -rf ~/cityview-upload && sudo systemctl restart cityview-api"
}

& ssh @Ssh $Target "chmod -R a+rX $Remote"
Write-Host "Pronto." -ForegroundColor Green
