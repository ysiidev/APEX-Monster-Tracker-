Unicode true
Name "APEX Monster Sales Tracker"
OutFile "output/APEX-Monster-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\APEX Monster Sales Tracker"
RequestExecutionLevel user
!include "MUI2.nsh"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Section "Install"
  SetOutPath "$INSTDIR"
  File "app\Monster Sales Tracker.exe"
  File "app\Microsoft.Web.WebView2.Core.dll"
  File "app\Microsoft.Web.WebView2.WinForms.dll"
  File "app\WebView2Loader.dll"
  File "app\index.html"
  File "app\bridge.js"
  File "app\cloud.js"
  File "app\staff-login.css"
  File "app\snapshot.json"
  CreateDirectory "$SMPROGRAMS\APEX Monster Sales Tracker"
  CreateShortCut "$SMPROGRAMS\APEX Monster Sales Tracker\Monster Sales Tracker.lnk" "$INSTDIR\Monster Sales Tracker.exe"
  CreateShortCut "$DESKTOP\Monster Sales Tracker.lnk" "$INSTDIR\Monster Sales Tracker.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ApexMonsterTracker" "DisplayName" "APEX Monster Sales Tracker"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ApexMonsterTracker" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ApexMonsterTracker" "DisplayVersion" "1.0.0"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ApexMonsterTracker" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ApexMonsterTracker" "NoRepair" 1
SectionEnd
Section "Uninstall"
  Delete "$INSTDIR\Monster Sales Tracker.exe"
  Delete "$INSTDIR\Microsoft.Web.WebView2.Core.dll"
  Delete "$INSTDIR\Microsoft.Web.WebView2.WinForms.dll"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\index.html"
  Delete "$INSTDIR\bridge.js"
  Delete "$INSTDIR\cloud.js"
  Delete "$INSTDIR\staff-login.css"
  Delete "$INSTDIR\snapshot.json"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\APEX Monster Sales Tracker\Monster Sales Tracker.lnk"
  RMDir "$SMPROGRAMS\APEX Monster Sales Tracker"
  Delete "$DESKTOP\Monster Sales Tracker.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\ApexMonsterTracker"
SectionEnd
