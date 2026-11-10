; The user's managed PDF library lives next to the application. Never remove
; the installation directory recursively, during either updates or uninstall.
; Old update clients may still pass /S. Keep the native progress page visible.
!macro customInit
  ${If} ${isUpdated}
    SetSilent normal
  ${EndIf}
!macroend

!macro customInstallMode
  ${If} ${isUpdated}
    ${If} $installMode == "all"
      StrCpy $isForceMachineInstall "1"
    ${Else}
      StrCpy $isForceCurrentInstall "1"
    ${EndIf}
  ${EndIf}
!macroend

!macro customFinishPage
  Function PDFSandwichStartAfterInstall
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
  FunctionEnd
  Function PDFSandwichFinishPre
    ${If} ${isUpdated}
    ${AndIf} ${isForceRun}
      HideWindow
      Call PDFSandwichStartAfterInstall
      SetAutoClose true
      Abort
    ${EndIf}
  FunctionEnd
  !define MUI_PAGE_CUSTOMFUNCTION_PRE PDFSandwichFinishPre
  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION PDFSandwichStartAfterInstall
  !insertmacro MUI_PAGE_FINISH
!macroend

!macro customRemoveFiles
  SetOutPath "$TEMP"
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\PDFSandwich.exe"
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\version"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vulkan-1.dll"
  RMDir "$INSTDIR"
!macroend
