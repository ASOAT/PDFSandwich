$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$testRoot = Join-Path $projectRoot ('tmp\installer-progress-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $testRoot -Force
# Run the production hooks in a harmless installer: no registry, user files or application install.
$script = @'
Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "PDFSandwich update progress test"
OutFile "@ROOT@\progress-test.exe"
InstallDir "@ROOT@\fixture"
!include MUI2.nsh
!include LogicLib.nsh
!define isUpdated '1 = 1'
!define isForceRun '1 = 1'
Var installMode
Var isForceMachineInstall
Var isForceCurrentInstall
Var launchLink
!define StdUtils.ExecShellAsUser '!insertmacro RecordRestart'
!macro RecordRestart result link verb args
  FileOpen $9 "@ROOT@\restart.txt" w
  FileWrite $9 '${args}'
  FileClose $9
!macroend
!include "@PROJECT@\build-resources\installer.nsh"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro customFinishPage
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  !insertmacro customInit
  StrCpy $installMode "all"
  !insertmacro customInstallMode
  FileOpen $9 "@ROOT@\mode.txt" w
  FileWrite $9 '$isForceMachineInstall'
  StrCpy $installMode "CurrentUser"
  !insertmacro customInstallMode
  FileWrite $9 '$isForceCurrentInstall'
  FileClose $9
FunctionEnd
Section
  Sleep 300
  System::Call 'user32::IsWindowVisible(p $HWNDPARENT)i.r0'
  FileOpen $9 "@ROOT@\visible.txt" w
  FileWrite $9 '$0'
  FileClose $9
  FindWindow $0 "#32770" "" $HWNDPARENT
  GetDlgItem $1 $0 1004
  FileOpen $9 "@ROOT@\progress.txt" w
  FileWrite $9 '$1'
  FileClose $9
  SetOutPath "$INSTDIR"
  FileOpen $9 "$INSTDIR\fixture.txt" w
  FileWrite $9 'Isolated test only'
  FileClose $9
  Sleep 300
SectionEnd
'@
$script = $script.Replace('@ROOT@',$testRoot).Replace('@PROJECT@',$projectRoot)
$testScript = Join-Path $testRoot 'test.nsi'
[IO.File]::WriteAllText($testScript,$script,[Text.UTF8Encoding]::new($true))
$compiler = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-3.0.4.1\Bin\makensis.exe'
& $compiler /V1 $testScript
if ($LASTEXITCODE -ne 0) { throw 'NSIS progress test compilation failed' }
$process = Start-Process -FilePath (Join-Path $testRoot 'progress-test.exe') -ArgumentList '/S --updated --force-run' -WindowStyle Hidden -PassThru
if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Installer did not automatically finish' }
if ($process.ExitCode -ne 0) { throw 'NSIS progress test failed' }
if ([IO.File]::ReadAllText((Join-Path $testRoot 'visible.txt')) -ne '1') { throw 'Native installer progress window was hidden' }
if ([long][IO.File]::ReadAllText((Join-Path $testRoot 'progress.txt')) -eq 0) { throw 'Native progress control missing' }
if ([IO.File]::ReadAllText((Join-Path $testRoot 'mode.txt')) -ne '11') { throw 'Existing installation scope not preserved' }
if ([IO.File]::ReadAllText((Join-Path $testRoot 'restart.txt')) -ne '--updated') { throw 'Restart did not carry update marker' }
[pscustomobject]@{NativeWindowVisible=$true;ProgressControlPresent=$true;LegacySilentFlagOverridden=$true;InstallScopePreserved=$true;AutoRestart=$true;AutoClose=$true} | ConvertTo-Json
