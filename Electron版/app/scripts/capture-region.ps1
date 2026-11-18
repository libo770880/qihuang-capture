# capture-region.ps1 - capture a physical-pixel region to PNG
# usage: capture-region.ps1 -X 0 -Y 0 -W 1920 -H 1080 -Out C:\tmp\shot.png
# Output includes screen={w,h} (primary screen PHYSICAL px, measured in this
# DPI-aware process). The host uses it to derive the real DIP->physical scale
# (GetDpiForSystem goes stale across remote sessions / virtual displays /
# runtime scaling changes - see ChannelsCapture.OverlayScale).
param(
  [int]$X = 0, [int]$Y = 0, [int]$W = 1920, [int]$H = 1080,
  [string]$Out = ""
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System.Runtime.InteropServices;
public class DpiAw2 {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int nIndex);
}
"@
[DpiAw2]::SetProcessDPIAware() | Out-Null
if (-not $Out) { $Out = Join-Path $env:TEMP ("shot_" + [guid]::NewGuid().ToString("N") + ".png") }
$bmp = New-Object System.Drawing.Bitmap $W, $H
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($X, $Y, 0, 0, (New-Object System.Drawing.Size($W, $H)))
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
@{
  path   = $Out
  screen = @{ w = [DpiAw2]::GetSystemMetrics(0); h = [DpiAw2]::GetSystemMetrics(1) }
} | ConvertTo-Json -Compress
