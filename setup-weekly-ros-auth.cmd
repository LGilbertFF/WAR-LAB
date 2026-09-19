@echo off
cd /d "%~dp0"
echo Opening Fantasy Points to save the weekly scraper login...
"C:\Users\lgilb\anaconda3\python.exe" scripts\fantasypoints_authenticated_ros_rankings.py --season-year 2026
echo.
echo When successful, copy the contents of:
echo .local\FANTASYPOINTS_STORAGE_STATE_B64.txt
echo into the GitHub repository secret named FANTASYPOINTS_STORAGE_STATE_B64.
pause
