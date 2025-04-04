@echo off
setlocal enabledelayedexpansion

title Windows System Maintenance

:: Check for Admin privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script requires administrator privileges.
    echo Please right-click on the script and select "Run as administrator".
    pause
    exit /b 1
)

echo ================== Windows System Maintenance ==================
echo.
echo This script will perform various system maintenance tasks.
echo Please save your work before continuing as some operations may require a reboot.
echo.
echo Press Ctrl+C to cancel or any key to continue...
pause >nul

:: Create a log file
set LOGFILE=%TEMP%\system_maintenance_%date:~-4,4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2%.log
echo ================== Windows System Maintenance Log ================== > %LOGFILE%
echo Started: %date% %time% >> %LOGFILE%

call :log "Maintenance Starting..."

:: Menu for optional tasks
echo Select maintenance tasks to perform:
echo 1. All tasks (recommended)
echo 2. Clean temporary files only
echo 3. Run system file checks only (SFC and DISM)
echo 4. Run disk checks only
echo 5. Clean up unnecessary files only
echo.
set /p CHOICE="Enter your choice (1-5): "

if "%CHOICE%"=="2" goto :clean_temp
if "%CHOICE%"=="3" goto :system_checks
if "%CHOICE%"=="4" goto :disk_checks
if "%CHOICE%"=="5" goto :cleanup_files

:clean_temp
call :log "Cleaning Temporary Files"
call :run_task "Cleaning Windows temp files" "del /q /f /s C:\Windows\Temp\*" 0
call :run_task "Cleaning user temp files" "del /q /f /s %TEMP%\*" 0
call :run_task "Cleaning prefetch files" "del /q /f /s C:\Windows\Prefetch\*" 0
if "%CHOICE%"=="2" goto :end

:system_checks
call :log "Running System File Checks"
call :run_task "SFC ScanNow" "sfc /scannow" 1
call :run_task "DISM ScanHealth" "dism /online /cleanup-image /ScanHealth" 1
call :run_task "DISM CheckHealth" "dism /online /cleanup-image /CheckHealth" 1
call :run_task "DISM RestoreHealth" "dism /online /cleanup-image /RestoreHealth" 1
call :run_task "DISM StartComponentCleanup" "dism /online /cleanup-image /StartComponentCleanup" 1
if "%CHOICE%"=="3" goto :end

:disk_checks
call :log "Checking Disk for Errors"
echo This process may take a while, please be patient...
echo y | chkdsk C: /f
if %errorlevel% neq 0 (
    echo INFO: Errors found or disk in use. Scheduling check on reboot. >> %LOGFILE%
    echo INFO: Errors found or disk in use. Scheduling check on reboot.
)
if "%CHOICE%"=="4" goto :end

:cleanup_files
call :log "Cleaning Up Unnecessary Files"
call :run_task "Disk Cleanup" "cleanmgr /sagerun:1" 0
if "%CHOICE%"=="5" goto :end

:: Optional: Windows Update
if "%CHOICE%"=="1" (
    call :log "Checking for Windows Updates"
    call :run_task "Windows Update" "wuauclt /detectnow" 0e
)

:end
call :log "Maintenance Completed Successfully"
echo.
echo ================== Maintenance Completed Successfully ==================
echo A log file has been created at: %LOGFILE%
echo.
pause
exit /b 0

:: Functions

:run_task
echo ================== %~1 Starting... ==================
echo ================== %~1 Starting... ================== >> %LOGFILE%
%~2 >> %LOGFILE% 2>&1
if %errorlevel% neq 0 (
    echo ERROR: %~1 failed with error code %errorlevel%!
    echo ERROR: %~1 failed with error code %errorlevel%! >> %LOGFILE%
    if "%~3"=="1" (
        goto :error
    )
) else (
    echo SUCCESS: %~1 completed.
    echo SUCCESS: %~1 completed. >> %LOGFILE%
)
echo.
goto :eof

:log
echo ================== %~1 ==================
echo ================== %~1 ================== >> %LOGFILE%
goto :eof

:error
echo ================== An error occurred during maintenance! ==================
echo ================== An error occurred during maintenance! ================== >> %LOGFILE%
echo See log file for details: %LOGFILE%
echo.
pause
exit /b 1
