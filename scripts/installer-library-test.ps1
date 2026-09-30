$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$testRoot = Join-Path $projectRoot ('tmp\installer-library-' + [guid]::NewGuid().ToString('N'))
$resolved = [IO.Path]::GetFullPath($testRoot)
if (-not $resolved.StartsWith((Join-Path $projectRoot 'tmp') + '\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Test directory outside workspace' }
$appDir = Join-Path $testRoot 'app'
$libraryDir = Join-Path $appDir '文献库\example'
$null = New-Item -ItemType Directory -Path $libraryDir -Force
$null = New-Item -ItemType Directory -Path (Join-Path $appDir 'resources') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $appDir 'locales') -Force
[IO.File]::WriteAllText((Join-Path $libraryDir 'original.pdf'),'Original test sentinel')
[IO.File]::WriteAllText((Join-Path $libraryDir 'original.zh.pdf'),'Translation test sentinel')
[IO.File]::WriteAllText((Join-Path $appDir 'user-file.txt'),'Additional user file')
[IO.File]::WriteAllText((Join-Path $appDir 'PDFSandwich.exe'),'Old program')
[IO.File]::WriteAllText((Join-Path $appDir 'resources\app.asar'),'Old resources')
$script = @"
Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "$testRoot\preserve-test.exe"
InstallDir "$appDir"
!define UNINSTALL_FILENAME "Uninstall PDFSandwich.exe"
!include "$projectRoot\build-resources\installer.nsh"
Section
!insertmacro customRemoveFiles
SectionEnd
"@
$testScript = Join-Path $testRoot 'test.nsi'
[IO.File]::WriteAllText($testScript,$script,[Text.UTF8Encoding]::new($true))
$compiler = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\nsis\nsis-3.0.4.1\Bin\makensis.exe'
& $compiler /V1 $testScript
if ($LASTEXITCODE -ne 0) { throw 'NSIS test compilation failed' }
$process = Start-Process -FilePath (Join-Path $testRoot 'preserve-test.exe') -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw 'NSIS test failed' }
if ([IO.File]::ReadAllText((Join-Path $libraryDir 'original.pdf')) -ne 'Original test sentinel') { throw 'Source lost' }
if ([IO.File]::ReadAllText((Join-Path $libraryDir 'original.zh.pdf')) -ne 'Translation test sentinel') { throw 'Translation lost' }
if (-not (Test-Path -LiteralPath (Join-Path $appDir 'user-file.txt'))) { throw 'User file lost' }
if (Test-Path -LiteralPath (Join-Path $appDir 'PDFSandwich.exe')) { throw 'Old program not removed' }
if (Test-Path -LiteralPath (Join-Path $appDir 'resources')) { throw 'Old resources not removed' }
[pscustomobject]@{ LibraryPreserved = $true; TranslationPreserved = $true; UserFilesPreserved = $true; OldProgramRemoved = $true } | ConvertTo-Json
