Add-Type -AssemblyName System.Drawing

$projectRoot = Split-Path -Parent $PSScriptRoot
$source = [System.Drawing.Bitmap]::new((Join-Path $projectRoot 'assets/icons/s_icon.png'))
$states = @(
  @{ Suffix = ''; Red = 25; Green = 103; Blue = 210 },
  @{ Suffix = '-error'; Red = 234; Green = 67; Blue = 53 },
  @{ Suffix = '-disabled'; Red = 146; Green = 146; Blue = 152 }
)

try {
  foreach ($state in $states) {
    foreach ($size in @(16, 32, 48, 128)) {
      $output = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($output)
      $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
      $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.DrawImage($source, 0, 0, $size, $size)
      $graphics.Dispose()

      for ($y = 0; $y -lt $size; $y++) {
        for ($x = 0; $x -lt $size; $x++) {
          $alpha = $output.GetPixel($x, $y).A
          if ($alpha -gt 0) {
            $output.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $state.Red, $state.Green, $state.Blue))
          }
        }
      }

      $suffix = "$($state.Suffix)$size"
      $output.Save((Join-Path (Join-Path $projectRoot 'src/icons') "icon$suffix.png"), [System.Drawing.Imaging.ImageFormat]::Png)
      $output.Dispose()
    }
  }
} finally {
  $source.Dispose()
}
