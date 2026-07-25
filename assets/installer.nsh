; ─────────────────────────────────────────────────────────────────────────────
; Rāma AGI — Custom NSIS Installer Script
; Extends the electron-builder generated installer with:
;   - Registry entries for protocol handler
;   - Optional auto-start on Windows login
;   - Custom welcome text
; ─────────────────────────────────────────────────────────────────────────────

; Custom welcome message on installer header
!define MUI_WELCOMEPAGE_TITLE "Installing Rāma AGI"
!define MUI_WELCOMEPAGE_TEXT "Righteous Autonomous Master Agent$\r$\n$\r$\nSupreme Benevolent Desktop AI$\r$\n$\r$\nAll data is encrypted with AES-256-GCM.$\r$\nYou will set your master passcode on first launch."

; After install completes — register protocol handler rama://
!macro customInstall
  ; Register rama:// protocol for deep linking
  WriteRegStr HKCU "Software\Classes\rama" "" "URL:Rama AGI Protocol"
  WriteRegStr HKCU "Software\Classes\rama" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\rama\shell\open\command" "" '"$INSTDIR\${productName}.exe" "%1"'

  ; Write app version to registry for update detection
  WriteRegStr HKCU "Software\KrishnaPrasad\RamaAGI" "Version"     "${version}"
  WriteRegStr HKCU "Software\KrishnaPrasad\RamaAGI" "InstallPath" "$INSTDIR"
!macroend

; On uninstall — clean up registry
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\rama"
  DeleteRegKey HKCU "Software\KrishnaPrasad\RamaAGI"
  ; Remove auto-start if it was set
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "RamaAGI"
!macroend
