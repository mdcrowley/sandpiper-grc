# Which process owns the window in front, and how long since the person at the machine last pressed
# a key or moved the mouse; with -Activate, brings the given process's main window to the front.
# Used by tools/sr/lib.mjs: NVDA reads only the window in front, so the run waits for the browser to
# be there and records nothing said about any other window.
param([int]$Activate = 0)
Add-Type -Namespace SrRun -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);
[StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO i);
'@
if ($Activate -gt 0) {
  $p = Get-Process -Id $Activate -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne 0) {
    $fg = [SrRun.Win]::GetForegroundWindow()
    $x = 0
    $fgThread = [SrRun.Win]::GetWindowThreadProcessId($fg, [ref]$x)
    $me = [SrRun.Win]::GetCurrentThreadId()
    # Windows lets only the process that had the last input change the window in front: a press of
    # F24, a key no keyboard has and applications ignore, makes this one that process.
    [SrRun.Win]::keybd_event(0x87, 0, 0, [System.UIntPtr]::Zero)
    [SrRun.Win]::keybd_event(0x87, 0, 2, [System.UIntPtr]::Zero)
    [void][SrRun.Win]::AttachThreadInput($me, $fgThread, $true)
    [void][SrRun.Win]::ShowWindow($p.MainWindowHandle, 9)
    [void][SrRun.Win]::SetForegroundWindow($p.MainWindowHandle)
    [void][SrRun.Win]::AttachThreadInput($me, $fgThread, $false)
  }
}
$owner = 0
[void][SrRun.Win]::GetWindowThreadProcessId([SrRun.Win]::GetForegroundWindow(), [ref]$owner)
$info = New-Object SrRun.Win+LASTINPUTINFO
$info.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($info)
[void][SrRun.Win]::GetLastInputInfo([ref]$info)
$idle = [Environment]::TickCount - [int]$info.dwTime
"$owner $idle"
