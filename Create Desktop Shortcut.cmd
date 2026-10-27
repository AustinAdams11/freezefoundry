@echo off
rem Puts a "Freeze Foundry" shortcut with the app icon on your desktop. It opens the app from this folder.
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Freeze Foundry.lnk'); $s.TargetPath = '%~dp0node_modules\electron\dist\electron.exe'; $s.Arguments = '\"%~dp0.\"'; $s.WorkingDirectory = '%~dp0'; $s.IconLocation = '%~dp0public\icon.ico'; $s.Save()"
echo Shortcut created on your desktop.
pause
