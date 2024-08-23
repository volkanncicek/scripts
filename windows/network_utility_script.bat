@echo off
:main
cls
echo ---------------------------------
echo      Network Utility Script
echo ---------------------------------
echo.
echo 1. Flush DNS cache
echo 2. Release IP configuration
echo 3. Renew IP configuration
echo 4. Display network settings
echo 5. Reset network settings
echo 6. Exit
echo.

set /p cmd="Enter your choice (1-6): "

if "%cmd%"=="1" goto flushDNS
if "%cmd%"=="2" goto releaseIP
if "%cmd%"=="3" goto renewIP
if "%cmd%"=="4" goto displayConfig
if "%cmd%"=="5" goto reset
if "%cmd%"=="6" goto exit

echo Invalid choice. Please enter a number between 1 and 6.
pause
goto main

:flushDNS
ipconfig /flushdns
echo Flush DNS done.
pause
goto main

:releaseIP
ipconfig /release
echo IP configuration released.
pause
goto main

:renewIP
ipconfig /renew
echo IP configuration renewed.
pause
goto main

:displayConfig
ipconfig /all
pause
goto main

:reset
echo Resetting network settings...
netsh winsock reset
netsh int ip reset
ipconfig /release
ipconfig /renew
arp -d *
nbtstat -R
nbtstat -RR
ipconfig /flushdns
ipconfig /registerdns
echo Network settings have been reset.
pause
goto main

:exit
exit
