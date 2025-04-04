@echo off
setlocal enabledelayedexpansion

:main
cls
echo ===================================
echo       NETWORK UTILITY SCRIPT
echo ===================================
echo.
echo  1. Flush DNS cache
echo  2. Release IP configuration
echo  3. Renew IP configuration
echo  4. Display network settings
echo  5. Reset network settings
echo  6. Ping a host
echo  7. Trace route
echo  8. Check network connection
echo  9. Exit
echo.

set /p choice="Enter your choice (1-9): "

if "%choice%"=="1" goto flushDNS
if "%choice%"=="2" goto releaseIP
if "%choice%"=="3" goto renewIP
if "%choice%"=="4" goto displayConfig
if "%choice%"=="5" goto reset
if "%choice%"=="6" goto pingHost
if "%choice%"=="7" goto traceRoute
if "%choice%"=="8" goto checkConnection
if "%choice%"=="9" goto exit

echo Invalid choice. Please enter a number between 1 and 9.
timeout /t 2 >nul
goto main

:flushDNS
echo.
echo Flushing DNS cache...
ipconfig /flushdns
if %errorlevel% neq 0 (
    echo Error: Failed to flush DNS cache.
) else (
    echo Success: DNS cache flushed.
)
pause
goto main

:releaseIP
echo.
echo Releasing IP configuration...
ipconfig /release
if %errorlevel% neq 0 (
    echo Error: Failed to release IP configuration.
) else (
    echo Success: IP configuration released.
)
pause
goto main

:renewIP
echo.
echo Renewing IP configuration...
ipconfig /renew
if %errorlevel% neq 0 (
    echo Error: Failed to renew IP configuration.
) else (
    echo Success: IP configuration renewed.
)
pause
goto main

:displayConfig
echo.
echo Displaying network configuration...
ipconfig /all
pause
goto main

:reset
echo.
echo Resetting network settings...
echo This may take a moment...
echo.

echo Step 1/8: Resetting Winsock catalog...
netsh winsock reset
echo.

echo Step 2/8: Resetting TCP/IP stack...
netsh int ip reset
echo.

echo Step 3/8: Releasing IP configuration...
ipconfig /release
echo.

echo Step 4/8: Renewing IP configuration...
ipconfig /renew
echo.

echo Step 5/8: Clearing ARP cache...
arp -d *
echo.

echo Step 6/8: Purging and reloading NetBIOS name cache...
nbtstat -R
nbtstat -RR
echo.

echo Step 7/8: Flushing DNS resolver cache...
ipconfig /flushdns
echo.

echo Step 8/8: Registering DNS names...
ipconfig /registerdns
echo.

echo Network settings have been reset.
echo It's recommended to restart your computer.
pause
goto main

:pingHost
echo.
set /p host="Enter hostname or IP address to ping: "
if "!host!"=="" (
    echo Error: No host specified.
    pause
    goto main
)
echo.
echo Pinging !host!...
ping !host!
pause
goto main

:traceRoute
echo.
set /p host="Enter hostname or IP address to trace: "
if "!host!"=="" (
    echo Error: No host specified.
    pause
    goto main
)
echo.
echo Tracing route to !host!...
tracert !host!
pause
goto main

:checkConnection
echo.
echo Checking network connection...
echo.
echo Internet connectivity test:
ping -n 4 8.8.8.8
if %errorlevel% neq 0 (
    echo Internet connection may be down.
) else (
    echo Internet connection appears to be working.
)
echo.
echo DNS resolution test:
ping -n 2 www.google.com
if %errorlevel% neq 0 (
    echo DNS resolution appears to be failing.
) else (
    echo DNS resolution appears to be working.
)
pause
goto main

:exit
endlocal
exit
