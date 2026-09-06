/**
 * Offline Windows System.Speech (language packs). No silent language fallback.
 */
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

async function listWindowsSpeechLangs() {
  const script = `
Add-Type -AssemblyName System.Speech
$names = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() |
  ForEach-Object { $_.Culture.Name }
Write-Output ($names -join ',')
`;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 15000, encoding: "utf8" }
    );
    return String(stdout || "")
      .trim()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function windowsHasLang(installed, langHint) {
  const want = String(langHint || "en-US").replace("_", "-");
  const primary = want.split("-")[0].toLowerCase();
  return installed.some((name) => {
    const n = String(name || "");
    return (
      n === want ||
      n.toLowerCase().startsWith(primary + "-") ||
      n.toLowerCase() === primary
    );
  });
}

/**
 * Recognize from a WAV file with System.Speech.
 * @param {string} langHint e.g. en-US
 * @param {string} wavPath
 */
async function dictateOnceWindows(langHint = "en-US", wavPath = "") {
  const culture = String(langHint || "en-US").trim().replace("_", "-") || "en-US";
  const wav = String(wavPath || "").trim();
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$want = ${JSON.stringify(culture)}
$wavPath = ${JSON.stringify(wav)}
$wantPrimary = ($want -split '-')[0].ToLowerInvariant()
$installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
$match = $installed | Where-Object { $_.Culture.Name -eq $want } | Select-Object -First 1
if (-not $match) {
  $match = $installed | Where-Object {
    $_.Culture.TwoLetterISOLanguageName.ToLowerInvariant() -eq $wantPrimary
  } | Select-Object -First 1
}
if (-not $match) {
  $names = ($installed | ForEach-Object { $_.Culture.Name }) -join ','
  Write-Output ('NO_LANG|' + $want + '|' + $names)
  exit 0
}
$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $match.Culture
if ($wavPath -ne '') {
  $engine.SetInputToWaveFile($wavPath)
} else {
  $engine.SetInputToDefaultAudioDevice()
}
$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
$engine.InitialSilenceTimeout = [TimeSpan]::FromSeconds(3)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(1.5)
$engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(0.7)
$result = $engine.Recognize([TimeSpan]::FromSeconds(8))
$engine.Dispose()
if ($null -eq $result -or [string]::IsNullOrWhiteSpace($result.Text)) {
  Write-Output 'EMPTY'
} else {
  Write-Output ('OK|' + $result.Text.Trim())
}
`;
  try {
    const { stdout, stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 18000, encoding: "utf8" }
    );
    const line = String(stdout || "")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .pop();
    if (!line || line === "EMPTY") {
      return {
        ok: false,
        error: "no_speech",
        hint: "no_speech",
        engine: "windows",
      };
    }
    if (line.startsWith("NO_LANG|")) {
      return {
        ok: false,
        error: line.slice(0, 200),
        hint: "no_lang",
        engine: "windows",
      };
    }
    if (line.startsWith("OK|")) {
      return { ok: true, text: line.slice(3), engine: "windows" };
    }
    return {
      ok: false,
      error: String(stderr || line || "dictate_failed").slice(0, 200),
      hint: "dictate_failed",
      engine: "windows",
    };
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e || "dictate_failed").slice(0, 200),
      hint: "dictate_failed",
      engine: "windows",
    };
  }
}

module.exports = {
  listWindowsSpeechLangs,
  windowsHasLang,
  dictateOnceWindows,
};
