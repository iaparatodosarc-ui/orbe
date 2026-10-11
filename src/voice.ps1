# Orbe - voz en Windows: escuchar (reconocimiento de voz de Windows, en linea) y hablar (voces de Windows).
# Protocolo igual que winutil.ps1: "<id> <comando> <args>" -> "<id> <json>".
#   listen                         -> {text, conf} | {text:''} si no hablo nadie | {error:'privacy'|'nomic'|'other', hr}
#   say <voz-b64> <rate> <texto-b64> -> {wav: base64} audio WAV listo para reproducir | {error}
#   voices                         -> {voices:[{name,lang}]}
# Todo el texto viaja en base64 (UTF-8) para no romper el protocolo de una linea.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechRecognition.SpeechRecognizer, Windows.Media.SpeechRecognition, ContentType = WindowsRuntime]
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $script:asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function Unb64([string]$s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }



# ---------- escuchar ----------
$script:rec = $null; $script:hypOk = $false; $script:recMode = ''; $script:minMode = 0; $script:lastErr = ''
function New-Recognizer([bool]$topic, [bool]$hyp) {
  $r = New-Object Windows.Media.SpeechRecognition.SpeechRecognizer
  $r.Timeouts.InitialSilenceTimeout = [TimeSpan]::FromSeconds(7)
  $r.Timeouts.EndSilenceTimeout = [TimeSpan]::FromMilliseconds(900)
  if ($topic) {
    $c = New-Object Windows.Media.SpeechRecognition.SpeechRecognitionTopicConstraint([Windows.Media.SpeechRecognition.SpeechRecognitionScenario]::Dictation, 'dictation')
    $r.Constraints.Add($c)
  }
  $cr = Await ($r.CompileConstraintsAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionCompilationResult])
  if ([string]$cr.Status -ne 'Success') { throw ('compile ' + $cr.Status) }
  $script:hypOk = $false
  if ($hyp) {
    # lo que va entendiendo mientras hablas: respaldo si al final Windows "rechaza" la frase por baja confianza
    try { Unregister-Event -SourceIdentifier 'orbeHyp' -ErrorAction SilentlyContinue } catch {}
    try { Register-ObjectEvent -InputObject $r -EventName HypothesisGenerated -SourceIdentifier 'orbeHyp' -ErrorAction Stop | Out-Null; $script:hypOk = $true } catch {}
  }
  return $r
}
function Get-Recognizer {
  if ($script:rec) { return $script:rec }
  $last = $null
  $modes = @(@($true, $true, 'topic+hyp'), @($true, $false, 'topic'), @($false, $false, 'plain'))
  for ($i = $script:minMode; $i -lt $modes.Count; $i++) {
    $m = $modes[$i]
    try { $script:rec = New-Recognizer $m[0] $m[1]; $script:recMode = $m[2]; $script:minMode = $i; return $script:rec } catch { $last = $_; $script:lastErr += ($m[2] + ': ' + $_.Exception.Message + ' | ') }
  }
  throw $last
}
function Do-Listen {
  for ($try = 0; $try -lt 3; $try++) {
  try {
    $r = Get-Recognizer
    if ($script:hypOk) { try { Get-Event -SourceIdentifier 'orbeHyp' -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue } catch {} }
    $res = Await ($r.RecognizeAsync()) ([Windows.Media.SpeechRecognition.SpeechRecognitionResult])
    $text = [string]$res.Text; $hyp = ''
    if ($script:hypOk) { try { $ev = @(Get-Event -SourceIdentifier 'orbeHyp' -ErrorAction SilentlyContinue); if ($ev.Count) { $hyp = [string]$ev[-1].SourceEventArgs.Hypothesis.Text }; $ev | Remove-Event -ErrorAction SilentlyContinue } catch {} }
    if (-not $text -and $hyp) { $text = $hyp }
    return @{ text = $text; conf = [string]$res.Confidence; status = [string]$res.Status; hyp = $hyp; mode = $script:recMode }
  } catch {
    $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
    $hr = '0x{0:X8}' -f $e.HResult
    $script:rec = $null
    $kind = 'other'
    if ($hr -eq '0x80045509') { $kind = 'privacy' }
    elseif ($hr -eq '0x80070005' -or $hr -eq '0x800455A0' -or $hr -eq '0xC00D36FA') { $kind = 'nomic' }
    $script:lastErr += ($script:recMode + ' -> ' + $e.Message + ' | ')
    # si fallo por algo del modo usado, probar el siguiente modo mas simple
    if ($kind -eq 'other' -and $script:minMode -lt 2) { $script:minMode++; continue }
    return @{ error = $kind; hr = $hr; msg = $script:lastErr }
  }
  }
}

# ---------- hablar ----------
$script:syn = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
function Pick-Voice([string]$want) {
  $all = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices
  $v = $null
  if ($want) { $v = $all | Where-Object { $_.DisplayName -eq $want } | Select-Object -First 1 }
  if (-not $v) { $v = $all | Where-Object { $_.DisplayName -like '*Pablo*' } | Select-Object -First 1 }
  if (-not $v) { $v = $all | Where-Object { $_.Language -like 'es*' } | Select-Object -First 1 }
  if (-not $v) { $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::DefaultVoice }
  return $v
}
function Do-Say([string]$voice, [double]$rate, [string]$text) {
  try {
    $v = Pick-Voice $voice
    $script:syn.Voice = $v
    try { $script:syn.Options.SpeakingRate = [Math]::Max(0.5, [Math]::Min(2.0, $rate)) } catch {}
    try { $script:syn.Options.AppendedSilence = [Windows.Media.SpeechSynthesis.SpeechAppendedSilence]::Min } catch {}
    try { $script:syn.Options.PunctuationSilence = [Windows.Media.SpeechSynthesis.SpeechPunctuationSilence]::Min } catch {}
    $stream = Await ($script:syn.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
    $size = [uint32]$stream.Size
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $null = Await ($reader.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    $reader.Dispose(); $stream.Dispose()
    return @{ wav = [Convert]::ToBase64String($bytes); voice = $v.DisplayName }
  } catch {
    $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }
    return @{ error = 'tts'; msg = [string]$e.Message }
  }
}
function Do-Voices {
  $list = @([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { @{ name = $_.DisplayName; lang = $_.Language } })
  return @{ voices = $list }
}

function Send-Reply([string]$id, $obj) {
  $json = if ($obj -eq $null) { '{}' } else { ([pscustomobject]$obj | ConvertTo-Json -Compress -Depth 4) }
  [Console]::Out.WriteLine($id + ' ' + $json)
  [Console]::Out.Flush()
}
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $all = $line.Trim().Split(' ')
  if ($all.Length -lt 2) { continue }
  $id = $all[0]; $cmd = $all[1]
  try {
    if ($cmd -eq 'listen') { Send-Reply $id (Do-Listen) }
    elseif ($cmd -eq 'say' -and $all.Length -ge 5) {
      $voice = if ($all[2] -eq '-') { '' } else { Unb64 $all[2] }
      $rate = 1.0; [double]::TryParse($all[3], [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$rate) | Out-Null
      Send-Reply $id (Do-Say $voice $rate (Unb64 $all[4]))
    }
    elseif ($cmd -eq 'voices') { Send-Reply $id (Do-Voices) }
    else { Send-Reply $id $null }
  } catch { Send-Reply $id @{ error = 'other'; msg = [string]$_.Exception.Message } }
}
