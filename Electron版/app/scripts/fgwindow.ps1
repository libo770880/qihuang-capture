# fgwindow.ps1 - get foreground window info (handle/title/pid/rect, physical px)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
Add-Type @"
using System.Runtime.InteropServices;
public class DpiAw { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[DpiAw]::SetProcessDPIAware() | Out-Null

$h = [Win32Fg]::GetForegroundWindow()
$rect = New-Object Win32Fg+RECT
[Win32Fg]::GetWindowRect($h, [ref]$rect) | Out-Null
$sb = New-Object System.Text.StringBuilder 512
[Win32Fg]::GetWindowText($h, $sb, 512) | Out-Null
$procId = 0
[Win32Fg]::GetWindowThreadProcessId($h, [ref]$procId) | Out-Null
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
$procName = ""
if ($proc) { $procName = $proc.ProcessName }
$obj = [ordered]@{
  handle = $h.ToInt64()
  title  = $sb.ToString()
  pid    = $procId
  process = $procName
  x = $rect.Left; y = $rect.Top
  w = $rect.Right - $rect.Left
  h = $rect.Bottom - $rect.Top
  visible = [Win32Fg]::IsWindowVisible($h)
}
$obj | ConvertTo-Json -Compress
