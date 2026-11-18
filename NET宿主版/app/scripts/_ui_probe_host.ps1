# 外壳层端到端实测：悬浮球拖动 / 点击展开 / 遮罩透明度 / Esc 关闭
# 用法：powershell -File scripts/_ui_probe_host.ps1
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public struct RECT { public int L, T, R, B; }
  public const uint LEFTDOWN = 0x0002, LEFTUP = 0x0004;
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] i, int sz);
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public KEYBDINPUT k; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
  public static void Esc() {
    var i = new INPUT[2];
    i[0].type = 1; i[0].k.wVk = 0x1B;
    i[1].type = 1; i[1].k.wVk = 0x1B; i[1].k.dwFlags = 2;
    SendInput(2, i, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Click(int x, int y) {
    SetCursorPos(x, y); System.Threading.Thread.Sleep(80);
    mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(60);
    mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
  }
}
"@

function Get-AppWindows([int]$procId) {
  $out = New-Object System.Collections.ArrayList
  $cb = [W+EnumProc]{
    param($h, $lp)
    if (-not [W]::IsWindowVisible($h)) { return $true }
    [uint32]$pid2 = 0; [void][W]::GetWindowThreadProcessId($h, [ref]$pid2)
    if ($pid2 -ne $procId) { return $true }
    $r = New-Object W+RECT
    [void][W]::GetWindowRect($h, [ref]$r)
    [void]$out.Add([pscustomobject]@{ H = $h; L = $r.L; T = $r.T; R = $r.R; B = $r.B; W = $r.R - $r.L; H2 = $r.B - $r.T })
    return $true
  }
  [void][W]::EnumWindows($cb, [IntPtr]::Zero)
  $out
}

function Pixel([string]$png, [int]$x, [int]$y) {
  $bmp = [System.Drawing.Bitmap]::FromFile($png)
  try { $c = $bmp.GetPixel($x, $y); '{0:X2}{1:X2}{2:X2}' -f $c.R, $c.G, $c.B } finally { $bmp.Dispose() }
}

# ---- 启动宿主 ----
$env:APPDATA = 'C:\Users\Administrator\AppData\Roaming'
$exe = 'E:\capture-tool\net\QhjfCapture\bin\Release\net8.0-windows\QhjfCapture.exe'
$p = Start-Process -FilePath $exe -WorkingDirectory (Split-Path $exe) -PassThru
"PID=$($p.Id)"
Start-Sleep -Seconds 7

$wins = Get-AppWindows $p.Id
$wins | ForEach-Object { "win: $($_.W)x$($_.H2) @($($_.L),$($_.T))" }

# ---- 找悬浮球（约 70x70 物理像素的窗口） ----
$ball = $wins | Where-Object { $_.W -ge 60 -and $_.W -le 90 -and $_.H2 -ge 60 -and $_.H2 -le 90 } | Select-Object -First 1
if (-not $ball) { "FAIL: 未找到悬浮球窗口"; exit 1 }
"ball: $($ball.W)x$($ball.H2) @($($ball.L),$($ball.T))"

# ---- 1) 透明度：截球所在区域，检查球窗外角落像素（透明应显示桌面，不透明白底则是 FFFFFF） ----
$cap = "$env:TEMP\ball_zone.png"
& E:\capture-tool\scripts\capture-region.ps1 -K ($ball.L - 10) ($ball.T - 10) ($ball.W + 20) ($ball.H2 + 20) $cap 2>$null | Out-Null
$corner = Pixel $cap 6 6     # 窗口外角（必是桌面）
$incorner = Pixel $cap 14 14 # 球窗内角落（透明=桌面色；不透明=FFFFFF）
$center = Pixel $cap ([int](10 + $ball.W / 2)) ([int](10 + $ball.H2 / 2))
"pixel corner(桌面)=$corner  ball-window-corner=$incorner  ball-center=$center"
if ($incorner -eq 'FFFFFF') { "RESULT transparency=OPAQUE(白底)" } else { "RESULT transparency=OK" }

# ---- 2) 拖动测试：按下→移动→松开，读窗口新位置 ----
$cx = [int]($ball.L + $ball.W / 2); $cy = [int]($ball.T + $ball.H2 / 2)
[void][W]::SetCursorPos($cx, $cy); Start-Sleep -Milliseconds 120
[W]::mouse_event([W]::LEFTDOWN, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 80
for ($i = 1; $i -le 10; $i++) {
  [void][W]::SetCursorPos($cx + $i * 20, $cy + $i * 10); Start-Sleep -Milliseconds 40
}
Start-Sleep -Milliseconds 150
[W]::mouse_event([W]::LEFTUP, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 400
$after = (Get-AppWindows $p.Id) | Where-Object { $_.W -ge 60 -and $_.W -le 90 } | Select-Object -First 1
if ($after) {
  $dx = $after.L - $ball.L; $dy = $after.T - $ball.T
  "RESULT drag: dx=$dx dy=$dy (期望约 +200/+100 物理像素)"
} else { "RESULT drag: 球窗口丢失" }

# ---- 3) 点击展开（验证鼠标事件能到达页面） ----
$b2 = (Get-AppWindows $p.Id) | Where-Object { $_.W -ge 60 -and $_.W -le 90 } | Select-Object -First 1
if ($b2) {
  [W]::Click([int]($b2.L + $b2.W / 2), [int]($b2.T + $b2.H2 / 2))
  Start-Sleep -Milliseconds 900
  $exp = (Get-AppWindows $p.Id) | Where-Object { $_.W -gt 200 -and $_.H2 -gt 400 } | Select-Object -First 1
  if ($exp) { "RESULT expand: OK 展开为 $($exp.W)x$($exp.H2) @($($exp.L),$($exp.T))" } else { "RESULT expand: FAIL 未展开" }

  # ---- 4) 框选遮罩：点展开面板第 2 项「框选抓取」----（先截图面板找按钮位置）
  if ($exp) {
    $menu = "$env:TEMP\ball_menu.png"
    & E:\capture-tool\scripts\capture-region.ps1 -X $exp.L -Y $exp.T -W $exp.W -H $exp.H2 -Out $menu | Out-Null
    "menu snapshot: $menu"
  }
}
"host pid=$($p.Id) （保持运行，供下一步用）"
