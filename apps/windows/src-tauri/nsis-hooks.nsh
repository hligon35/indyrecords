!macro NSIS_HOOK_POSTINSTALL
  CreateShortCut "$DESKTOP\IRM RMS.lnk" "$INSTDIR\irm-rms-windows.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "IRM RMS"
  CreateShortCut "$SMPROGRAMS\IRM RMS.lnk" "$INSTDIR\irm-rms-windows.exe" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "IRM RMS"
!macroend
