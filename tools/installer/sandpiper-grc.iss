; Sandpiper GRC Windows installer (E42). Built by tools\installer\build.ps1 with Inno Setup 6
; (free, its own permissive license: https://jrsoftware.org/files/is/license.txt); see
; docs/installation.md, "Windows installer".
;
; The work is done by deploy\windows\grc-windows.ps1 (installed as {app}\grc-windows.ps1): this
; script asks the questions, copies the files and calls it at three points:
;   - before the files are copied, on an upgrade: pre-upgrade (stop, back up, keep the old files);
;   - after they are copied: install (a new installation) or post-upgrade (migrate, start, check,
;     and roll back by itself if any of that fails);
;   - when the installer ends: recover (rolls back an upgrade the installer left half-way).
;
; Silent installation (an administrator's command prompt):
;   SandpiperGRC-Setup-<version>.exe /VERYSILENT /SUPPRESSMSGBOXES /LOG=setup-log.txt
;     [/DIR="C:\Program Files\Sandpiper GRC"] [/PORT=8080] [/DATADIR="C:\ProgramData\Sandpiper GRC"]
;     [/TLSCERT=C:\certs\grc.pem /TLSKEY=C:\certs\grc-key.pem [/FIREWALL=1]]
;     [/TASKS="startmenu,desktopicon"]
; Exit codes: 0 done; 1-8 Inno Setup's own (for example 1: an older version over a newer one was
; refused); 11 installed but the service did not become ready; 12 the upgrade failed and the previous
; version runs again with its data; 13 the rollback did not finish (the service is stopped).
; Silent removal: "{app}\unins000.exe" /VERYSILENT [/REMOVEDATA=1]

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef NumericVersion
  #define NumericVersion "0.0.0"
#endif
#ifndef StageDir
  #define StageDir "stage"
#endif
#ifndef OutputDir
  #define OutputDir "output"
#endif
; Instance: a second, separate installation with its own service, folders and uninstall entry
; (used by the installer tests, so they cannot touch a real installation on the same machine).
#ifndef Instance
  #define Instance ""
#endif
#if Instance == ""
  #define ServiceName "SandpiperGRC"
  #define FolderName "Sandpiper GRC"
  #define DisplayName "Sandpiper GRC"
  #define OutputName "SandpiperGRC-Setup-" + AppVersion
#else
  #define ServiceName "SandpiperGRC-" + Instance
  #define FolderName "Sandpiper GRC " + Instance
  #define DisplayName "Sandpiper GRC (" + Instance + ")"
  #define OutputName "SandpiperGRC-" + Instance + "-Setup-" + AppVersion
#endif

[Setup]
AppId={#ServiceName}
AppName={#DisplayName}
AppVersion={#AppVersion}
AppVerName={#DisplayName} {#AppVersion}
AppPublisher=Sandpiper GRC contributors
AppPublisherURL=https://github.com/mdcrowley/sandpiper-grc
AppSupportURL=https://github.com/mdcrowley/sandpiper-grc/issues
AppUpdatesURL=https://github.com/mdcrowley/sandpiper-grc/releases
VersionInfoVersion={#NumericVersion}
VersionInfoProductName=Sandpiper GRC
VersionInfoDescription=Sandpiper GRC installer
DefaultDirName={autopf}\{#FolderName}
DisableProgramGroupPage=yes
DisableDirPage=auto
UsePreviousAppDir=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename={#OutputName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
LicenseFile={#StageDir}\LICENSE.txt
UninstallDisplayName={#DisplayName}
CloseApplications=yes
SetupLogging=yes

[Tasks]
Name: "startmenu"; Description: "Create Start menu shortcuts (open, status, start, stop, restart, back up, check for updates, logs)"
Name: "desktopicon"; Description: "Create a desktop shortcut to the application"; Flags: unchecked

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion
; Also unpacked on its own before the files are copied, to run pre-upgrade.
Source: "{#StageDir}\grc-windows.ps1"; Flags: dontcopy

[InstallDelete]
; The previous version's program files go first (they were copied aside by pre-upgrade), so no
; file a newer version removed (a migration, for example) is left behind.
Type: filesandordirs; Name: "{app}\app"
Type: filesandordirs; Name: "{app}\node"

[INI]
Filename: "{app}\Sandpiper GRC.url"; Section: "InternetShortcut"; Key: "URL"; String: "{code:AppUrl}"

[Icons]
; Every management shortcut runs sandpiper.cmd (sandpiper.ps1) in a normal console window that waits
; for Enter; start, stop, restart and back up ask for administrator rights (UAC) when needed.
Name: "{autoprograms}\{#DisplayName}\Open Sandpiper GRC"; Filename: "{app}\Sandpiper GRC.url"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Server status"; Filename: "{app}\sandpiper.cmd"; Parameters: "status --pause"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Start server"; Filename: "{app}\sandpiper.cmd"; Parameters: "start --pause"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Stop server"; Filename: "{app}\sandpiper.cmd"; Parameters: "stop --pause"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Restart server"; Filename: "{app}\sandpiper.cmd"; Parameters: "restart --pause"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Back up now"; Filename: "{app}\sandpiper.cmd"; Parameters: "backup --pause"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Check for updates"; Filename: "{app}\sandpiper.cmd"; Parameters: "check-update --pause"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Open logs folder"; Filename: "{app}\sandpiper.cmd"; Parameters: "logs"; WorkingDir: "{app}"; Tasks: startmenu
Name: "{autoprograms}\{#DisplayName}\Uninstall Sandpiper GRC"; Filename: "{uninstallexe}"; Tasks: startmenu
Name: "{autodesktop}\{#DisplayName}"; Filename: "{app}\Sandpiper GRC.url"; Tasks: desktopicon

[Run]
Filename: "{app}\Sandpiper GRC.url"; Description: "Open Sandpiper GRC in the browser (to create the first administrator)"; \
  Flags: shellexec postinstall nowait skipifsilent; Check: Succeeded

[UninstallDelete]
Type: files; Name: "{app}\Sandpiper GRC.url"

[Code]
const
  RegKey = 'SOFTWARE\Sandpiper GRC\{#ServiceName}';

var
  Installed: String;          // version already installed, '' for a new installation
  PortPage: TInputQueryWizardPage;
  DataPage: TInputDirWizardPage;
  TlsPage: TInputFileWizardPage;
  FirewallPage: TInputOptionWizardPage;
  PreUpgradeDone, PostRan, Failed: Boolean;
  StepCode: Integer;
  RemoveDataBox: TNewCheckBox;

function IsUpgrade: Boolean;
begin
  Result := Installed <> '';
end;

// Numbers of a version: 1.2.3 (anything after a '-' or '+' is ignored here).
function VersionPart(V: String; Index: Integer): Integer;
var
  I, N: Integer;
begin
  I := Pos('-', V); if I > 0 then V := Copy(V, 1, I - 1);
  I := Pos('+', V); if I > 0 then V := Copy(V, 1, I - 1);
  for N := 1 to Index do begin
    I := Pos('.', V);
    if I = 0 then V := '' else V := Copy(V, I + 1, Length(V));
  end;
  I := Pos('.', V);
  if I > 0 then V := Copy(V, 1, I - 1);
  Result := StrToIntDef(V, 0);
end;

// Negative when A is older than B.
function CompareVersions(A, B: String): Integer;
var
  I: Integer;
begin
  Result := 0;
  for I := 0 to 2 do begin
    Result := VersionPart(A, I) - VersionPart(B, I);
    if Result <> 0 then Exit;
  end;
  // Same numbers: a pre-release (1.2.3-rc.1) is older than the release.
  if (Pos('-', A) > 0) and (Pos('-', B) = 0) then Result := -1
  else if (Pos('-', A) = 0) and (Pos('-', B) > 0) then Result := 1;
end;

function InitializeSetup: Boolean;
begin
  Result := True;
  if not RegQueryStringValue(HKLM64, RegKey, 'Version', Installed) then Installed := '';
  if IsUpgrade and (CompareVersions(Installed, '{#AppVersion}') > 0) then begin
    Log('Refused: version ' + Installed + ' is installed, newer than {#AppVersion}.');
    SuppressibleMsgBox('{#DisplayName} ' + Installed + ' is installed, which is newer than this installer (' + '{#AppVersion}' + ').' + #13#10#13#10 +
      'Going back to an older version is not supported: the database may already have changes the older version cannot read. ' +
      'To return to an earlier version, uninstall, install that version and restore a backup made by it.', mbError, MB_OK, IDOK);
    Result := False;
  end;
end;

function RegValue(Name, Default: String): String;
begin
  if not RegQueryStringValue(HKLM64, RegKey, Name, Result) then Result := Default;
end;

function DataRoot(Param: String): String;
begin
  if IsUpgrade then Result := RegValue('DataRoot', '')
  else if DataPage <> nil then Result := DataPage.Values[0]
  else Result := ExpandConstant('{param:DATADIR|{commonappdata}\{#FolderName}}');
end;

function Port: String;
begin
  if IsUpgrade then Result := RegValue('Port', '8080') else Result := Trim(PortPage.Values[0]);
end;

function AppUrl(Param: String): String;
var
  Scheme: String;
begin
  if IsUpgrade then Scheme := RegValue('Scheme', 'http')
  else if Trim(TlsPage.Values[0]) <> '' then Scheme := 'https'
  else Scheme := 'http';
  Result := Scheme + '://localhost:' + Port + '/';
end;

procedure InitializeWizard;
begin
  PortPage := CreateInputQueryPage(wpSelectDir, 'Port', 'Which port should Sandpiper GRC listen on?',
    'People open the application at this port. Choose one no other program on this computer uses.');
  PortPage.Add('&Port (1 to 65535):', False);
  PortPage.Values[0] := ExpandConstant('{param:PORT|8080}');

  DataPage := CreateInputDirPage(PortPage.ID, 'Data folder', 'Where should the data be kept?',
    'The database, attached files, backups, logs, settings and the secret key go here, apart from the program files. ' +
    'Only administrators and the service can open it. Choose a folder on a disk that is backed up.', False, '');
  DataPage.Add('');
  DataPage.Values[0] := ExpandConstant('{param:DATADIR|{commonappdata}\{#FolderName}}');

  TlsPage := CreateInputFilePage(DataPage.ID, 'HTTPS certificate (optional)', 'Should the server speak HTTPS itself?',
    'Leave both empty to serve this computer only, at http://localhost. To let other computers connect, give a certificate ' +
    'and its private key as PEM files (the certificate first, then any intermediate certificates). The server then listens on every network address. ' +
    'You can also leave these empty and put a reverse proxy in front later (see the installation guide).');
  TlsPage.Add('&Certificate file (PEM):', 'PEM files|*.pem;*.crt;*.cer|All files|*.*', '.pem');
  TlsPage.Add('Private &key file (PEM):', 'PEM files|*.pem;*.key|All files|*.*', '.pem');
  TlsPage.Values[0] := ExpandConstant('{param:TLSCERT|}');
  TlsPage.Values[1] := ExpandConstant('{param:TLSKEY|}');

  FirewallPage := CreateInputOptionPage(TlsPage.ID, 'Windows Firewall', 'Should other computers be let through the firewall?',
    'Only used with an HTTPS certificate: without one the server listens on this computer only. The rule allows the port on ' +
    'domain and private networks, not public ones.', False, False);
  FirewallPage.Add('&Open the port in Windows Firewall');
  FirewallPage.Values[0] := ExpandConstant('{param:FIREWALL|0}') = '1';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  // An upgrade keeps the port, folders and certificate of the installation it replaces.
  Result := IsUpgrade and ((PageID = PortPage.ID) or (PageID = DataPage.ID) or (PageID = TlsPage.ID) or (PageID = FirewallPage.ID));
  if (PageID = FirewallPage.ID) and (Trim(TlsPage.Values[0]) = '') then Result := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  P: Integer;
begin
  Result := True;
  if CurPageID = PortPage.ID then begin
    P := StrToIntDef(Trim(PortPage.Values[0]), 0);
    if (P < 1) or (P > 65535) then begin
      MsgBox('Enter a port number from 1 to 65535.', mbError, MB_OK);
      Result := False;
    end;
  end else if CurPageID = TlsPage.ID then begin
    if (Trim(TlsPage.Values[0]) <> '') <> (Trim(TlsPage.Values[1]) <> '') then begin
      MsgBox('Give both the certificate and its private key, or neither.', mbError, MB_OK);
      Result := False;
    end else if (Trim(TlsPage.Values[0]) <> '') and not (FileExists(TlsPage.Values[0]) and FileExists(TlsPage.Values[1])) then begin
      MsgBox('The certificate or key file was not found.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  if IsUpgrade then
    Result := 'Upgrade {#DisplayName} ' + Installed + ' to {#AppVersion}:' + NewLine +
      Space + '1. stop the service' + NewLine + Space + '2. back up the data' + NewLine +
      Space + '3. replace the program files' + NewLine + Space + '4. update the database' + NewLine +
      Space + '5. start the service' + NewLine + Space + '6. check that it answers' + NewLine +
      Space + 'If any step fails, the previous version and its data are put back.' + NewLine + NewLine +
      Space + 'Data folder: ' + DataRoot('') + NewLine + Space + 'Address: ' + AppUrl('')
  else
    Result := MemoDirInfo + NewLine + NewLine + 'Data folder:' + NewLine + Space + DataRoot('') + NewLine + NewLine +
      'Address:' + NewLine + Space + AppUrl('') + NewLine + NewLine + MemoTasksInfo;
end;

function Script(Path, Args: String): Integer;
var
  Code: Integer;
begin
  Log('Running grc-windows.ps1 ' + Args);
  if not Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + Path + '" ' + Args, '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
  Log('grc-windows.ps1 ended with ' + IntToStr(Code));
  Result := Code;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsUpgrade then Exit;
  WizardForm.PreparingLabel.Caption := 'Stopping the service and backing up the data...';
  ExtractTemporaryFile('grc-windows.ps1');
  if Script(ExpandConstant('{tmp}\grc-windows.ps1'), 'pre-upgrade -ServiceName "{#ServiceName}" -Version "{#AppVersion}"') <> 0 then
    Result := 'The upgrade could not start: the service could not be stopped or the data could not be backed up. Nothing was changed. ' +
      'The details are in ' + DataRoot('') + '\logs\setup.log.'
  else
    PreUpgradeDone := True;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Args: String;
begin
  if CurStep <> ssPostInstall then Exit;
  PostRan := True;
  if IsUpgrade then begin
    WizardForm.StatusLabel.Caption := 'Updating the database and starting the service...';
    StepCode := Script(ExpandConstant('{app}\grc-windows.ps1'), 'post-upgrade -ServiceName "{#ServiceName}" -Version "{#AppVersion}"');
  end else begin
    WizardForm.StatusLabel.Caption := 'Setting up the service and waiting for it to start...';
    Args := 'install -ServiceName "{#ServiceName}" -Version "{#AppVersion}" -InstallDir "' + ExpandConstant('{app}') + '" -DataRoot "' +
      DataRoot('') + '" -Port ' + Port;
    if Trim(TlsPage.Values[0]) <> '' then begin
      Args := Args + ' -TlsCert "' + Trim(TlsPage.Values[0]) + '" -TlsKey "' + Trim(TlsPage.Values[1]) + '"';
      if FirewallPage.Values[0] then Args := Args + ' -OpenFirewall';
    end;
    StepCode := Script(ExpandConstant('{app}\grc-windows.ps1'), Args);
  end;
  if StepCode <> 0 then begin
    Failed := True;
    case StepCode of
      2: SuppressibleMsgBox('The upgrade failed, so it was undone: version ' + Installed + ' is running again with the data as it was before. ' +
           'The details are in ' + DataRoot('') + '\logs\setup.log.', mbError, MB_OK, IDOK);
      3: SuppressibleMsgBox('The upgrade failed and putting the previous version back did not finish. The service is stopped. ' +
           'The steps to finish by hand are in ' + DataRoot('') + '\logs\setup.log.', mbCriticalError, MB_OK, IDOK);
    else
      SuppressibleMsgBox('Sandpiper GRC was installed but the service did not start and answer. ' +
        'The details are in ' + DataRoot('') + '\logs\setup.log and service.log.', mbError, MB_OK, IDOK);
    end;
  end;
end;

function Succeeded: Boolean;
begin
  Result := not Failed;
end;

function GetCustomSetupExitCode: Integer;
begin
  if Failed then begin
    if StepCode = 2 then Result := 12
    else if StepCode = 3 then Result := 13
    else Result := 11;
  end else Result := 0;
end;

procedure DeinitializeSetup;
var
  Saved: String;
begin
  // The files were being replaced but the installer stopped before post-upgrade: put the old ones back.
  if PreUpgradeDone and not PostRan then begin
    Saved := DataRoot('') + '\upgrade\grc-windows.ps1';
    if FileExists(Saved) then Script(Saved, 'recover -ServiceName "{#ServiceName}"');
  end;
end;

// ---------- removal ----------

function InitializeUninstall: Boolean;
var
  Form: TSetupForm;
  Text: TNewStaticText;
  Ok, Cancel: TNewButton;
begin
  Result := True;
  if UninstallSilent then Exit;
  Form := CreateCustomForm(ScaleX(440), ScaleY(190), False, True);
  try
    Form.Caption := 'Remove {#DisplayName}';
    Text := TNewStaticText.Create(Form);
    Text.Parent := Form;
    Text.Left := ScaleX(16); Text.Top := ScaleY(16); Text.Width := Form.ClientWidth - ScaleX(32);
    Text.AutoSize := False; Text.WordWrap := True; Text.Height := ScaleY(60);
    Text.Caption := 'The program and the service are removed. The data folder (' + RegValue('DataRoot', '') + ') is kept, so ' +
      'installing again picks up where you left off, unless you check the box below.';
    RemoveDataBox := TNewCheckBox.Create(Form);
    RemoveDataBox.Parent := Form;
    RemoveDataBox.Left := ScaleX(16); RemoveDataBox.Top := ScaleY(84); RemoveDataBox.Width := Form.ClientWidth - ScaleX(32); RemoveDataBox.Height := ScaleY(36);
    RemoveDataBox.Caption := 'Also delete the data folder: the database, attached files, backups, settings and the secret key. This cannot be undone.';
    Ok := TNewButton.Create(Form);
    Ok.Parent := Form; Ok.Caption := 'Remove'; Ok.ModalResult := mrOk; Ok.Default := True;
    Ok.Width := ScaleX(90); Ok.Height := ScaleY(26);
    Ok.Left := Form.ClientWidth - ScaleX(16 + 90 + 8 + 90); Ok.Top := Form.ClientHeight - ScaleY(16 + 26);
    Cancel := TNewButton.Create(Form);
    Cancel.Parent := Form; Cancel.Caption := 'Cancel'; Cancel.ModalResult := mrCancel; Cancel.Cancel := True;
    Cancel.Width := ScaleX(90); Cancel.Height := ScaleY(26);
    Cancel.Left := Form.ClientWidth - ScaleX(16 + 90); Cancel.Top := Ok.Top;
    Result := Form.ShowModal = mrOk;
  finally
    if not Result then Form.Free;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Args: String;
  Code: Integer;
begin
  if CurUninstallStep <> usUninstall then Exit;
  Args := 'uninstall -ServiceName "{#ServiceName}"';
  if UninstallSilent then begin
    if ExpandConstant('{param:REMOVEDATA|0}') = '1' then Args := Args + ' -RemoveData';
  end else if (RemoveDataBox <> nil) and RemoveDataBox.Checked then Args := Args + ' -RemoveData';
  Log('Running grc-windows.ps1 ' + Args);
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\grc-windows.ps1') + '" ' + Args, '', SW_HIDE, ewWaitUntilTerminated, Code);
  Log('grc-windows.ps1 ended with ' + IntToStr(Code));
end;
