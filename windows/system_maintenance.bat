@echo off
setlocal

echo ================== Maintenance Starting... ==================

echo ================== Cleaning Temporary Files ==================
echo Cleaning temporary files...
del /q /f %TEMP%\*
del /q /f C:\Windows\Temp\*
echo Temporary files cleaned.

echo ================== SFC ScanNow Starting... ==================
sfc /scannow
if %errorlevel% neq 0 (
  echo ERROR: SFC ScanNow failed!
  goto :error
) else (
  echo SUCCESS: SFC ScanNow completed.
)

echo ================== DISM ScanHealth Starting... ==================
dism /online /cleanup-image /ScanHealth
if %errorlevel% neq 0 (
  echo ERROR: DISM ScanHealth failed!
  goto :error
) else (
  echo SUCCESS: DISM ScanHealth completed.
)

echo ================== DISM CheckHealth Starting... ==================
dism /online /cleanup-image /CheckHealth
if %errorlevel% neq 0 (
  echo ERROR: DISM CheckHealth failed!
  goto :error
) else (
  echo SUCCESS: DISM CheckHealth completed.
)

echo ================== DISM RestoreHealth Starting... ==================
dism /online /cleanup-image /RestoreHealth
if %errorlevel% neq 0 (
  echo ERROR: DISM RestoreHealth failed!
  goto :error
) else (
  echo SUCCESS: DISM RestoreHealth completed.
)

echo ================== DISM StartComponentCleanup Starting... ==================
dism /online /cleanup-image /StartComponentCleanup
if %errorlevel% neq 0 (
  echo ERROR: DISM StartComponentCleanup failed!
  goto :error
) else (
  echo SUCCESS: DISM StartComponentCleanup completed.
)

echo ================== Checking Disk for Errors ==================
echo This process may take a while, please be patient...
(
  echo y | chkdsk C: /f
) || (
  echo INFO: Errors found or disk in use. Scheduling check on reboot.
  if %errorlevel% neq 0 (
    echo ERROR: Disk check failed!
    goto :error
  )
)
echo SUCCESS: Disk check completed.

echo ================== Cleaning Up Unnecessary Files ==================
cleanmgr /sagerun:1
if %errorlevel% neq 0 (
  echo ERROR: Cleanup failed!
  goto :error
) else (
  echo SUCCESS: Cleanup completed.
)

echo ================== Maintenance Completed Successfully ==================
pause
goto :eof

:error
echo ================== An error occurred during maintenance! ==================
pause
exit /b 1
