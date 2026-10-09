param(
  [Parameter(Mandatory = $false)]
  [string]$Path
)
# Push a UTF-8 markdown file onto the OS clipboard for pasting into Feishu docs.
# Usage (from repo root): powershell -NoProfile -ExecutionPolicy Bypass -File brief/push_brief_section.ps1 -Path brief/out/feishu_section_2026-10-07.md

if (-not $Path) {
  $Path = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'feishu_section_latest.md'
}

$full = (Resolve-Path -LiteralPath $Path).Path
$src = ([IO.File]::ReadAllText($full, [Text.Encoding]::UTF8)) -replace "`r`n", "`n"

Set-Clipboard -Value $src
Start-Sleep -Milliseconds 300

$got = ((Get-Clipboard -Raw) -replace "`r`n", "`n").TrimEnd("`n")
$exp = $src.TrimEnd("`n")

$sha = [Security.Cryptography.SHA256]::Create()
$h1 = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($exp)))
$h2 = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($got)))

Write-Output ("[clipboard] file=" + $full)
Write-Output ("[clipboard] chars=" + $exp.Length + " match=" + ($h1 -eq $h2))
if ($h1 -ne $h2) { exit 1 } else { exit 0 }
