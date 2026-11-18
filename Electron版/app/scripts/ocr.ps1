# ocr.ps1 - Windows built-in OCR (Windows.Media.Ocr) on a PNG image
# usage: powershell -ExecutionPolicy Bypass -File ocr.ps1 -Image C:\tmp\shot.png [-Lang zh-Hans-CN]
param(
  [string]$Image = "",
  [string]$Lang = "zh-Hans-CN"
)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"
if (-not $Image -or -not (Test-Path $Image)) { throw "image not found: $Image" }

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Await($WinRtTask, $ResultType, [string]$Step = "") {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  try {
    $netTask.Wait(-1) | Out-Null
  } catch {
    $inner = $_.Exception
    while ($inner -and $inner.InnerException) { $inner = $inner.InnerException }
    @{ ok = $false; error = "ASYNC_FAIL"; step = $Step; detail = "$inner" } | ConvertTo-Json -Compress
    exit 1
  }
  $netTask.Result
}

$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataWriter, Windows.Storage.Streams, ContentType = WindowsRuntime]

$engine = $null
try {
  $lang = New-Object Windows.Globalization.Language $Lang
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
} catch { $engine = $null }
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
if (-not $engine) {
  @{ ok = $false; error = "NO_OCR_LANG"; detail = "system lacks OCR language pack for $Lang" } | ConvertTo-Json -Compress
  exit 0
}

# read file bytes into memory stream (avoids StorageFile path restrictions)
$bytes = [System.IO.File]::ReadAllBytes($Image)
$stream = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
$writer = New-Object Windows.Storage.Streams.DataWriter($stream)
$writer.WriteBytes($bytes)
$storeOp = $writer.StoreAsync()
$null = Await $storeOp ([uint32]) "store_bytes"
$writer.DetachStream() | Out-Null
$stream.Seek(0) | Out-Null

$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder]) "create_decoder"

$maxDim = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
$sw = $decoder.PixelWidth
$sh = $decoder.PixelHeight
# 缩放策略：超大图降到 MaxImageDimension 内；小图放大到目标尺寸——
# 屏幕截取的汉字往往只有十几像素高，Windows OCR 对小字号极易整行乱码（识别出成串拉丁字母），
# 放大 2 倍左右可显著提升精度；不超过引擎上限
$curMax = [Math]::Max($sw, $sh)
$scale = 1.0
if ($curMax -gt $maxDim) {
  $scale = $maxDim / $curMax
} elseif ($curMax -lt 2000) {
  $scale = [Math]::Min(2000.0 / $curMax, $maxDim / $curMax)
}

if ([Math]::Abs($scale - 1.0) -gt 0.001) {
  $w2 = [int][Math]::Floor($sw * $scale); $h2 = [int][Math]::Floor($sh * $scale)
  $tf = New-Object Windows.Graphics.Imaging.BitmapTransform
  $tf.ScaledWidth = $w2; $tf.ScaledHeight = $h2
  $tf.InterpolationMode = [Windows.Graphics.Imaging.BitmapInterpolationMode]::Linear
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $tf, [Windows.Graphics.Imaging.ExifOrientationMode]::IgnoreExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap]) "decode_resize"
} else {
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap]) "decode"
}

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult]) "recognize"

$lines = @()
foreach ($line in $result.Lines) {
  $words = @()
  foreach ($wd in $line.Words) {
    $r = $wd.BoundingRect
    $words += [ordered]@{ text = $wd.Text; x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height }
  }
  $lines += [ordered]@{ text = $line.Text; words = $words }
}
@{ ok = $true; lang = $engine.RecognizerLanguage.LanguageTag; scale = $scale; lines = $lines } | ConvertTo-Json -Compress -Depth 6
