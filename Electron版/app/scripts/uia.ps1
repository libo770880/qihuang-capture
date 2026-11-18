# uia.ps1 - read readable texts of foreground window via UI Automation (for C/S clients)
# usage: powershell -ExecutionPolicy Bypass -File uia.ps1 [-Handle 12345] [-Depth 30] [-MaxItems 2000]
param(
  [long]$Handle = 0,
  [int]$Depth = 30,
  [int]$MaxItems = 2000
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if ($Handle -eq 0) {
  $fe = [System.Windows.Automation.AutomationElement]::FocusedElement
  $Handle = $fe.Current.NativeWindowHandle
}
$root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Handle)
if (-not $root) { @{ ok=$false; error="NO_ROOT" } | ConvertTo-Json -Compress; exit 0 }

$title = $root.Current.Name
$procId = $root.Current.ProcessId
$proc = Get-Process -Id $procId -ErrorAction SilentlyContinue

$out = New-Object System.Collections.ArrayList
$count = 0
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$stack = New-Object System.Collections.Stack
$stack.Push(@($root, 0)) | Out-Null

while ($stack.Count -gt 0 -and $count -lt $MaxItems) {
  $cur = $stack.Pop()
  $el = $cur[0]; $lv = $cur[1]
  if ($lv -gt $Depth) { continue }
  $count++
  $name = ""; $val = ""
  try { $name = $el.Current.Name } catch {}
  try {
    $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $val = $vp.Current.Value
  } catch {}
  try {
    if (-not $val) {
      $tp = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
      $val = $tp.DocumentRange.GetText(-1)
    }
  } catch {}
  $t = $name
  if ($val -and $val -ne $name) { $t = ($t + "|" + $val) }
  $t = ($t -replace '[\r\n]+', ' ')
  if ($t) {
    [void]$out.Add([ordered]@{ text = $t; depth = $lv; type = $el.Current.ControlType.ProgrammaticName })
  }
  try {
    $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $arr = @($children)
    for ($i = $arr.Length - 1; $i -ge 0; $i--) { $stack.Push(@($arr[$i], ($lv+1))) | Out-Null }
  } catch {}
}

$procName = ""
if ($proc) { $procName = $proc.ProcessName }
@{ ok=$true; title=$title; pid=$procId; process=$procName; items=$out } | ConvertTo-Json -Compress -Depth 5
