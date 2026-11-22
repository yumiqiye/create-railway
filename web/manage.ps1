<#
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
#>
param(
  [string]$Action = ""
)

$ErrorActionPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-ConfigPort([string]$Section, [int]$Fallback) {
  $configPath = Join-Path $Root "config.toml"
  if (-not (Test-Path -LiteralPath $configPath)) { return $Fallback }
  $text = [IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8)
  $pattern = "(?ms)^\s*\[$([regex]::Escape($Section))\][^\[]*?^\s*port\s*=\s*(\d+)"
  $match = [regex]::Match($text, $pattern)
  if ($match.Success) {
    $value = [int]$match.Groups[1].Value
    if ($value -gt 0) { return $value }
  }
  return $Fallback
}

$TicketPort = Get-ConfigPort "ticket" 3000
$AdminPort = Get-ConfigPort "admin" 8001

$Services = @(
  @{ Name = "ticket 前台+接口"; Port = $TicketPort; WorkDir = Join-Path $Root "ticket"; Args = "server.js"; Log = "service.log" },
  @{ Name = "admin 后台"; Port = $AdminPort; WorkDir = Join-Path $Root "admin"; Args = ""; Log = "service.log" }
)

function Get-PortPid([int]$Port) {
  $lines = netstat -ano | Select-String "LISTENING" | Select-String (":" + $Port + "\s")
  foreach ($line in $lines) {
    $parts = ($line.ToString().Trim() -split "\s+")
    if ($parts.Count -ge 5 -and $parts[1] -match (":" + $Port + "$")) {
      return [int]$parts[-1]
    }
  }
  return 0
}

function Show-Status {
  Write-Host ""
  Write-Host "清江铁路12306 服务状态" -ForegroundColor Cyan
  Write-Host ("-" * 46)
  foreach ($svc in $Services) {
    $pidValue = Get-PortPid $svc.Port
    if ($pidValue -gt 0) {
      Write-Host ("[运行中] {0,-18} 端口 {1}  PID {2}" -f $svc.Name, $svc.Port, $pidValue) -ForegroundColor Green
    } else {
      Write-Host ("[已停止] {0,-18} 端口 {1}" -f $svc.Name, $svc.Port) -ForegroundColor DarkGray
    }
  }
  Write-Host ("-" * 46)
  Write-Host ("前台 http://ticket.localhost:{0}/  检票 http://localhost:{1}/  后台 http://localhost:{2}/" -f $TicketPort, $CheckPort, $AdminPort)
}

function Start-All {
  Write-Host "正在启动全部服务..." -ForegroundColor Cyan
  foreach ($svc in $Services) {
    $existing = Get-PortPid $svc.Port
    if ($existing -gt 0) {
      Write-Host ("跳过 {0}（端口 {1} 已运行，PID {2}）" -f $svc.Name, $svc.Port, $existing)
      continue
    }
    $outLog = Join-Path $svc.WorkDir $svc.Log
    $errLog = Join-Path $svc.WorkDir "service.err.log"
    if ($svc.WorkDir -eq (Join-Path $Root "admin")) {
      $pnpmCmd = Join-Path $env:APPDATA "npm\pnpm.cmd"
      if (-not (Test-Path -LiteralPath $pnpmCmd)) { $pnpmCmd = "pnpm.cmd" }
      Start-Process -FilePath $pnpmCmd -ArgumentList "run", "dev" -WorkingDirectory $svc.WorkDir -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    } else {
      Start-Process -FilePath "node" -ArgumentList $svc.Args -WorkingDirectory $svc.WorkDir -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog
    }
    Start-Sleep -Milliseconds 700
    Write-Host ("已启动 {0}（端口 {1}）" -f $svc.Name, $svc.Port) -ForegroundColor Green
  }
  Start-Sleep -Seconds 2
  Show-Status
}

function Stop-All {
  Write-Host "正在停止全部服务..." -ForegroundColor Yellow
  foreach ($svc in $Services) {
    $pidValue = Get-PortPid $svc.Port
    if ($pidValue -gt 0) {
      Stop-Process -Id $pidValue -Force
      Write-Host ("已停止 {0}（端口 {1}，PID {2}）" -f $svc.Name, $svc.Port, $pidValue)
      Start-Sleep -Milliseconds 400
    } else {
      Write-Host ("{0} 未在运行" -f $svc.Name)
    }
  }
  Show-Status
}

if (-not $Action) {
  while ($true) {
    Write-Host ""
    Write-Host "================ 清江铁路 12306 ================" -ForegroundColor Cyan
    Write-Host "  1  启动全部服务"
    Write-Host "  2  停止全部服务"
    Write-Host "  3  查看运行状态"
    Write-Host "  0  退出"
    Write-Host "================================================" -ForegroundColor Cyan
    $choice = Read-Host "请输入 1 / 2 / 3"
    switch ($choice) {
      "1" { Start-All }
      "2" { Stop-All }
      "3" { Show-Status }
      "0" { break }
      default { Write-Host "请输入 1、2、3 或 0" -ForegroundColor Red }
    }
    if ($choice -eq "0") { break }
  }
} else {
  switch ($Action.ToLower()) {
    "start" { Start-All }
    "stop" { Stop-All }
    "status" { Show-Status }
    default { Write-Host "用法：manage.ps1 start|stop|status" -ForegroundColor Red }
  }
}
