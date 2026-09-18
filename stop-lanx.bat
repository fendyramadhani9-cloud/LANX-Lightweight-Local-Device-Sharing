@echo off
title Hentikan LANX
echo Menghentikan LANX di latar belakang...
taskkill /F /IM lanx.exe >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo [OK] LANX berhasil dihentikan.
) else (
    echo [INFO] LANX tidak sedang berjalan.
)
ping 127.0.0.1 -n 2 >nul
