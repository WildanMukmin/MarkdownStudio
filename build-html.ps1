# Assembles index.html from src/. index.html is generated - edit the files in src/.
# Each "@@include path" line in src/template.html is replaced by that file's text.
param([string]$Out = "index.html")
$ErrorActionPreference = "Stop"
$src = Join-Path $PSScriptRoot "src"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$tpl = [IO.File]::ReadAllText((Join-Path $src "template.html"), $utf8)
$text = [regex]::Replace($tpl, '(?m)^@@include (.+?)\r?$', {
  param($m)
  $f = Join-Path $src $m.Groups[1].Value.Trim()
  if (-not (Test-Path $f)) { throw "missing include: $f" }
  $t = [IO.File]::ReadAllText($f, $utf8)
  if ($t.EndsWith("`n")) { $t = $t.Substring(0, $t.Length - 1) }
  $t
})
[IO.File]::WriteAllText((Join-Path $PSScriptRoot $Out), $text, $utf8)
Write-Host "Built $Out from src/"
