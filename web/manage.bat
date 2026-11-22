@echo off
REM ══════════════════════════════════════════════════════
REM   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
REM   版权所有，仿冒必究    All Rights Reserved
REM ══════════════════════════════════════════════════════
chcp 65001 >nul
title 清江铁路12306 服务管理
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0manage.ps1"
pause
