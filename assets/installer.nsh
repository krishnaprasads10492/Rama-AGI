; ----------------------------------------------------------------------------
; Rama AGI - custom NSIS installer additions
;
; Extends the electron-builder generated installer with:
;   - the rama:// protocol handler
;   - registry entries recording the installed version and path
;   - matching cleanup on uninstall
;
; NOTE ON THOSE REGISTRY ENTRIES: nothing in Rama reads them. They were
; described here as "used for update detection", which was never true - the
; update channel compares app.getVersion() against the channel manifest, and
; electron-updater uses its own feed. They are kept because they are genuinely
; useful when inspecting a machine by hand, and because upgrade detection is
; done by electron-builder's own uninstall key under the GUID derived from
; appId - not by anything written here. Do not build update logic on them
; without wiring a reader first.
;
; TWO CONSTRAINTS THIS FILE MUST RESPECT, both learned the hard way:
;
; 1. ASCII ONLY. NSIS reads an included script as the system codepage unless the
;    file carries a BOM, so non-ASCII bytes here are mangled or rejected. This
;    file previously used box-drawing characters and "Rama" with a macron, and
;    it is compiled by makensis - a step that never runs on a machine where
;    7-Zip is blocked, so the risk stayed invisible until a real installer
;    build was attempted. Keep this file ASCII; put display text with accented
;    characters in package.json, which electron-builder encodes correctly.
;
; 2. USE ELECTRON-BUILDER'S OWN DEFINE NAMES: PRODUCT_NAME, PRODUCT_FILENAME
;    and VERSION, all uppercase. The lowercase productName and version spellings
;    are electron-builder's *artifactName* template placeholders, not NSIS
;    symbols. This file used the lowercase pair, so NSIS left them unexpanded
;    and wrote a registry command pointing at a file that does not exist.
; ----------------------------------------------------------------------------

; Inert unless a welcome page is added: electron-builder's assisted installer
; does not insert MUI_PAGE_WELCOME, so nothing renders these today. Kept
; because they are correct the moment a welcome page is introduced.
!define MUI_WELCOMEPAGE_TITLE "Installing ${PRODUCT_NAME}"
!define MUI_WELCOMEPAGE_TEXT "Righteous Autonomous Master Agent$\r$\n$\r$\nSupreme Benevolent Desktop AI$\r$\n$\r$\nAll data is encrypted with AES-256-GCM.$\r$\nYou will set your master passcode on first launch."

; After install completes - register the rama:// protocol for deep linking.
; HKCU throughout: a per-user install must not need administrator rights.
!macro customInstall
  WriteRegStr HKCU "Software\Classes\rama" "" "URL:Rama AGI Protocol"
  WriteRegStr HKCU "Software\Classes\rama" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\rama\shell\open\command" "" '"$INSTDIR\${PRODUCT_FILENAME}.exe" "%1"'

  WriteRegStr HKCU "Software\KrishnaPrasad\RamaAGI" "Version"     "${VERSION}"
  WriteRegStr HKCU "Software\KrishnaPrasad\RamaAGI" "InstallPath" "$INSTDIR"
!macroend

; On uninstall - remove exactly what customInstall wrote, and nothing else.
; User data under %APPDATA% is deliberately left alone; it is encrypted with
; the master passcode and losing it silently would be unrecoverable.
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\rama"
  DeleteRegKey HKCU "Software\KrishnaPrasad\RamaAGI"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "RamaAGI"
!macroend
