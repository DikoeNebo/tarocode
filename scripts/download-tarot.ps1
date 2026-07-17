# Downloads Rider-Waite-Smith deck (78 cards) from Wikimedia Commons.
# Source: Category:Rider-Waite-Smith_tarot_deck_(TaionWC)

$OutDir = Join-Path $PSScriptRoot "..\assets\tarot"
$UserAgent = "KeycodeTarotDownloader/1.0 (https://github.com/keycode; local setup)"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$Map = @(
  @{ src = "RWS Tarot 00 Fool.jpg"; dst = "fool.jpg" },
  @{ src = "RWS Tarot 01 Magician.jpg"; dst = "magician.jpg" },
  @{ src = "RWS Tarot 02 High Priestess.jpg"; dst = "high_priestess.jpg" },
  @{ src = "RWS Tarot 03 Empress.jpg"; dst = "empress.jpg" },
  @{ src = "RWS Tarot 04 Emperor.jpg"; dst = "emperor.jpg" },
  @{ src = "RWS Tarot 05 Hierophant.jpg"; dst = "hierophant.jpg" },
  @{ src = "RWS Tarot 06 Lovers.jpg"; dst = "lovers.jpg" },
  @{ src = "RWS Tarot 07 Chariot.jpg"; dst = "chariot.jpg" },
  @{ src = "RWS Tarot 08 Strength.jpg"; dst = "strength.jpg" },
  @{ src = "RWS Tarot 09 Hermit.jpg"; dst = "hermit.jpg" },
  @{ src = "RWS Tarot 10 Wheel of Fortune.jpg"; dst = "wheel_of_fortune.jpg" },
  @{ src = "RWS Tarot 11 Justice.jpg"; dst = "justice.jpg" },
  @{ src = "RWS Tarot 12 Hanged Man.jpg"; dst = "hanged_man.jpg" },
  @{ src = "RWS Tarot 13 Death.jpg"; dst = "death.jpg" },
  @{ src = "RWS Tarot 14 Temperance.jpg"; dst = "temperance.jpg" },
  @{ src = "RWS Tarot 15 Devil.jpg"; dst = "devil.jpg" },
  @{ src = "RWS Tarot 16 Tower.jpg"; dst = "tower.jpg" },
  @{ src = "RWS Tarot 17 Star.jpg"; dst = "star.jpg" },
  @{ src = "RWS Tarot 18 Moon.jpg"; dst = "moon.jpg" },
  @{ src = "RWS Tarot 19 Sun.jpg"; dst = "sun.jpg" },
  @{ src = "RWS Tarot 20 Judgement.jpg"; dst = "judgement.jpg" },
  @{ src = "RWS Tarot 21 World.jpg"; dst = "world.jpg" },
  @{ src = "Wands01.jpg"; dst = "wands_ace.jpg" },
  @{ src = "Wands02.jpg"; dst = "wands_02.jpg" },
  @{ src = "Wands03.jpg"; dst = "wands_03.jpg" },
  @{ src = "Wands04.jpg"; dst = "wands_04.jpg" },
  @{ src = "Wands05.jpg"; dst = "wands_05.jpg" },
  @{ src = "Wands06.jpg"; dst = "wands_06.jpg" },
  @{ src = "Wands07.jpg"; dst = "wands_07.jpg" },
  @{ src = "Wands08.jpg"; dst = "wands_08.jpg" },
  @{ src = "Wands09.jpg"; dst = "wands_09.jpg" },
  @{ src = "Wands10.jpg"; dst = "wands_10.jpg" },
  @{ src = "Wands11.jpg"; dst = "wands_page.jpg" },
  @{ src = "Wands12.jpg"; dst = "wands_knight.jpg" },
  @{ src = "Wands13.jpg"; dst = "wands_queen.jpg" },
  @{ src = "Wands14.jpg"; dst = "wands_king.jpg" },
  @{ src = "Cups01.jpg"; dst = "cups_ace.jpg" },
  @{ src = "Cups02.jpg"; dst = "cups_02.jpg" },
  @{ src = "Cups03.jpg"; dst = "cups_03.jpg" },
  @{ src = "Cups04.jpg"; dst = "cups_04.jpg" },
  @{ src = "Cups05.jpg"; dst = "cups_05.jpg" },
  @{ src = "Cups06.jpg"; dst = "cups_06.jpg" },
  @{ src = "Cups07.jpg"; dst = "cups_07.jpg" },
  @{ src = "Cups08.jpg"; dst = "cups_08.jpg" },
  @{ src = "Cups09.jpg"; dst = "cups_09.jpg" },
  @{ src = "Cups10.jpg"; dst = "cups_10.jpg" },
  @{ src = "Cups11.jpg"; dst = "cups_page.jpg" },
  @{ src = "Cups12.jpg"; dst = "cups_knight.jpg" },
  @{ src = "Cups13.jpg"; dst = "cups_queen.jpg" },
  @{ src = "Cups14.jpg"; dst = "cups_king.jpg" },
  @{ src = "Swords01.jpg"; dst = "swords_ace.jpg" },
  @{ src = "Swords02.jpg"; dst = "swords_02.jpg" },
  @{ src = "Swords03.jpg"; dst = "swords_03.jpg" },
  @{ src = "Swords04.jpg"; dst = "swords_04.jpg" },
  @{ src = "Swords05.jpg"; dst = "swords_05.jpg" },
  @{ src = "Swords06.jpg"; dst = "swords_06.jpg" },
  @{ src = "Swords07.jpg"; dst = "swords_07.jpg" },
  @{ src = "Swords08.jpg"; dst = "swords_08.jpg" },
  @{ src = "Swords09.jpg"; dst = "swords_09.jpg" },
  @{ src = "Swords10.jpg"; dst = "swords_10.jpg" },
  @{ src = "Swords11.jpg"; dst = "swords_page.jpg" },
  @{ src = "Swords12.jpg"; dst = "swords_knight.jpg" },
  @{ src = "Swords13.jpg"; dst = "swords_queen.jpg" },
  @{ src = "Swords14.jpg"; dst = "swords_king.jpg" },
  @{ src = "Pents01.jpg"; dst = "pentacles_ace.jpg" },
  @{ src = "Pents02.jpg"; dst = "pentacles_02.jpg" },
  @{ src = "Pents03.jpg"; dst = "pentacles_03.jpg" },
  @{ src = "Pents04.jpg"; dst = "pentacles_04.jpg" },
  @{ src = "Pents05.jpg"; dst = "pentacles_05.jpg" },
  @{ src = "Pents06.jpg"; dst = "pentacles_06.jpg" },
  @{ src = "Pents07.jpg"; dst = "pentacles_07.jpg" },
  @{ src = "Pents08.jpg"; dst = "pentacles_08.jpg" },
  @{ src = "Pents09.jpg"; dst = "pentacles_09.jpg" },
  @{ src = "Pents10.jpg"; dst = "pentacles_10.jpg" },
  @{ src = "Pents11.jpg"; dst = "pentacles_page.jpg" },
  @{ src = "Pents12.jpg"; dst = "pentacles_knight.jpg" },
  @{ src = "Pents13.jpg"; dst = "pentacles_queen.jpg" },
  @{ src = "Pents14.jpg"; dst = "pentacles_king.jpg" }
)

function Get-CommonsUrl {
  param([string]$FileName)
  $api = "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles=File:$([uri]::EscapeDataString($FileName))"
  $resp = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = $UserAgent }
  $page = $resp.query.pages.PSObject.Properties | Select-Object -First 1
  return $page.Value.imageinfo[0].url
}

$headers = @{ "User-Agent" = $UserAgent }
$ok = 0
$fail = 0

foreach ($item in $Map) {
  $dest = Join-Path $OutDir $item.dst
  if (Test-Path $dest) {
    Write-Host "skip $($item.dst)"
    $ok++
    continue
  }

  try {
    Start-Sleep -Seconds 3
    $url = Get-CommonsUrl -FileName $item.src
    if (-not $url) { throw "No URL from API" }
    Start-Sleep -Seconds 2
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -Headers $headers
    Write-Host "ok   $($item.dst)"
    $ok++
  } catch {
    Write-Host "FAIL $($item.dst): $($_.Exception.Message)"
    $fail++
  }
}

Write-Host "`nDone: $ok ok, $fail failed"
if ($fail -gt 0) { exit 1 }
