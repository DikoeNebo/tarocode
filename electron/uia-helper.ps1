# Persistent UIA helper for Keycode. NDJSON on stdin/stdout. ASCII-only messages.
# Commands: probe | elementFromPoint | listChats | selectChat | focusInput | diagnose | ping | quit
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName WindowsBase

$UIA = [System.Windows.Automation.AutomationElement]
$CT = [System.Windows.Automation.ControlType]
$TP = [System.Windows.Automation.TreeScope]
$SelectionItemPattern = [System.Windows.Automation.SelectionItemPattern]::Pattern
$InvokePattern = [System.Windows.Automation.InvokePattern]::Pattern
$ValuePattern = [System.Windows.Automation.ValuePattern]::Pattern

Add-Type @"
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)]
public struct UiaPoint { public int X; public int Y; }
public static class UiaNative {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(UiaPoint pt);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
  public static void ClickScreen(int x, int y) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(30);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(20);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero);
    System.Threading.Thread.Sleep(40);
  }
  public static bool ForceFocus(IntPtr h) {
    IntPtr fg = GetForegroundWindow();
    uint pid;
    uint fgThread = fg != IntPtr.Zero ? GetWindowThreadProcessId(fg, out pid) : 0;
    uint cur = GetCurrentThreadId();
    uint targetThread = GetWindowThreadProcessId(h, out pid);
    if (fgThread != 0) AttachThreadInput(cur, fgThread, true);
    if (targetThread != 0 && targetThread != fgThread) AttachThreadInput(cur, targetThread, true);
    ShowWindow(h, 9);
    BringWindowToTop(h);
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    bool ok = SetForegroundWindow(h);
    if (fgThread != 0) AttachThreadInput(cur, fgThread, false);
    if (targetThread != 0 && targetThread != fgThread) AttachThreadInput(cur, targetThread, false);
    return ok || GetForegroundWindow() == h;
  }
}
"@

function Write-Json($obj) {
  $json = $obj | ConvertTo-Json -Compress -Depth 12
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Safe-Name([System.Windows.Automation.AutomationElement]$el) {
  try { return [string]$el.Current.Name } catch { return '' }
}
function Safe-Id([System.Windows.Automation.AutomationElement]$el) {
  try { return [string]$el.Current.AutomationId } catch { return '' }
}
function Safe-Class([System.Windows.Automation.AutomationElement]$el) {
  try { return [string]$el.Current.ClassName } catch { return '' }
}
function Safe-Type([System.Windows.Automation.AutomationElement]$el) {
  try { return [string]$el.Current.ControlType.ProgrammaticName.Replace('ControlType.','') } catch { return '' }
}
function Safe-Hwnd([System.Windows.Automation.AutomationElement]$el) {
  try { return [int64]$el.Current.NativeWindowHandle } catch { return 0 }
}

function Get-Locator([System.Windows.Automation.AutomationElement]$el, [System.Windows.Automation.AutomationElement]$root) {
  # Path without sibling index scan (FindAll(Children) can throw on some Chromium nodes).
  $path = @()
  $cur = $el
  $guard = 0
  while ($null -ne $cur -and $guard -lt 24) {
    $guard++
    $path = @(
      @{
        controlType = (Safe-Type $cur)
        name = (Safe-Name $cur)
        automationId = (Safe-Id $cur)
        className = (Safe-Class $cur)
      }
    ) + $path
    if ($null -ne $root) {
      try { if ($cur.Equals($root)) { break } } catch { break }
    }
    try {
      $cur = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cur)
    } catch { break }
    if ($null -eq $cur) { break }
  }
  return @{
    controlType = Safe-Type $el
    name = Safe-Name $el
    automationId = Safe-Id $el
    className = Safe-Class $el
    path = $path
  }
}

function Find-WindowRoot([int64]$hwnd) {
  if ($hwnd -le 0) { return $null }
  return $UIA::FromHandle([IntPtr]$hwnd)
}

function Find-CursorWindows {
  $roots = New-Object System.Collections.Generic.List[object]
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $CT::Window)
  $wins = $UIA::RootElement.FindAll($TP::Children, $cond)
  for ($i = 0; $i -lt $wins.Count; $i++) {
    $w = $wins.Item($i)
    $name = Safe-Name $w
    $cls = Safe-Class $w
    if ($cls -match 'Chrome_WidgetWin' -and ($name -match 'Cursor|Agents')) {
      $roots.Add($w) | Out-Null
    } elseif ($name -match '^(Cursor|Cursor Agents)') {
      $roots.Add($w) | Out-Null
    }
  }
  return $roots
}

function Is-ChatCandidate([System.Windows.Automation.AutomationElement]$el) {
  $t = Safe-Type $el
  if ($t -notin @('TabItem','ListItem','TreeItem','Button','Hyperlink','DataItem','Custom')) { return $false }
  $name = Safe-Name $el
  if ([string]::IsNullOrWhiteSpace($name)) { return $false }
  if ($name.Length -gt 160) { return $false }
  if ($name -match '^(Minimize|Maximize|Close|Restore|Settings|Help|File|Edit|View|Selection|Terminal|Output|Debug Console|Problems|See more|Pin|Unpin|More|New Chat|New Agent|Open|Composer|Chat|Cursor|Agents|Repositories|Search|Filter)$') { return $false }
  if ($name -match 'Customize Sidebar|Open Editors|Timeline') { return $false }
  # Cursor agent rows are ListItem / TabItem
  if ($t -in @('ListItem','TabItem','TreeItem','DataItem')) { return $true }
  # Button child of a list row with a long title
  if ($t -eq 'Button' -and $name.Length -ge 8 -and $name -match '[a-zA-Z]') {
    try {
      $p = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($el)
      if ($null -ne $p -and (Safe-Type $p) -in @('ListItem','TreeItem','DataItem')) { return $true }
    } catch {}
  }
  return $false
}

function Is-InputCandidate([System.Windows.Automation.AutomationElement]$el) {
  $t = Safe-Type $el
  $aid = Safe-Id $el
  $name = Safe-Name $el
  # Exclude Chromium page root / huge docs
  if ($aid -eq 'RootWebArea') { return $false }
  if ($t -eq 'Document' -and ($name -match 'Cursor|Agents' -or $aid -eq 'RootWebArea')) { return $false }
  if ($t -eq 'Edit') { return $true }
  if ($t -eq 'Document') {
    try { return [bool]$el.Current.IsKeyboardFocusable } catch { return $false }
  }
  try {
    if ($el.Current.IsKeyboardFocusable) {
      $null = $el.GetCurrentPattern($ValuePattern)
      return $true
    }
  } catch {}
  return $false
}

function Climb-Chat([System.Windows.Automation.AutomationElement]$el) {
  $cur = $el
  $fallback = $null
  for ($i = 0; $i -lt 14; $i++) {
    if ($null -eq $cur) { break }
    $t = Safe-Type $cur
    # Prefer selectable list/tab rows over inner Button/Text
    if ($t -in @('ListItem','TabItem','TreeItem','DataItem') -and -not [string]::IsNullOrWhiteSpace((Safe-Name $cur))) {
      return $cur
    }
    if ($null -eq $fallback -and (Is-ChatCandidate $cur)) { $fallback = $cur }
    try {
      $null = $cur.GetCurrentPattern($SelectionItemPattern)
      if ($t -in @('ListItem','TabItem','TreeItem','DataItem')) { return $cur }
      if ($null -eq $fallback) { $fallback = $cur }
    } catch {}
    try { $cur = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cur) } catch { break }
  }
  return $fallback
}

function Climb-Input([System.Windows.Automation.AutomationElement]$el) {
  $cur = $el
  for ($i = 0; $i -lt 10; $i++) {
    if ($null -eq $cur) { break }
    if (Is-InputCandidate $cur) { return $cur }
    try { $cur = [System.Windows.Automation.TreeWalker]::ControlViewWalker.GetParent($cur) } catch { break }
  }
  return $null
}

function Find-AtPointByRole([System.Windows.Automation.AutomationElement]$root, [int]$x, [int]$y, [string]$role) {
  if ($null -eq $root) { return $null }
  $bestHit = $null
  $bestHitArea = [double]::MaxValue
  $bestNear = $null
  $bestNearDist = [double]::MaxValue
  $nearMax = 96.0
  try {
    $all = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $limit = [Math]::Min($all.Count, 1400)
    for ($i = 0; $i -lt $limit; $i++) {
      $el = $all.Item($i)
      $ok = $false
      if ($role -eq 'chat') { $ok = Is-ChatCandidate $el }
      elseif ($role -eq 'input') { $ok = Is-InputCandidate $el }
      else { $ok = $true }
      if (-not $ok) { continue }
      try {
        $r = $el.Current.BoundingRectangle
        if ($r.Width -le 1 -or $r.Height -le 1) { continue }
        $contains = ($x -ge $r.X -and $x -le ($r.X + $r.Width) -and $y -ge $r.Y -and $y -le ($r.Y + $r.Height))
        if ($contains) {
          $area = [double]$r.Width * [double]$r.Height
          # Prefer ListItem/TabItem over equal-sized Button children
          $t = Safe-Type $el
          $bonus = 0.0
          if ($role -eq 'chat' -and $t -in @('ListItem','TabItem','TreeItem')) { $bonus = -1.0 }
          $score = $area + $bonus
          if ($score -lt $bestHitArea) {
            $bestHitArea = $score
            $bestHit = $el
          }
        } else {
          # Nearest center — helps when DPI/click is a few px off the row
          $cx = $r.X + $r.Width / 2.0
          $cy = $r.Y + $r.Height / 2.0
          $dist = [Math]::Abs($cx - $x) + [Math]::Abs($cy - $y)
          if ($dist -lt $bestNearDist -and $dist -le $nearMax) {
            $bestNearDist = $dist
            $bestNear = $el
          }
        }
      } catch {}
    }
  } catch {}
  if ($null -ne $bestHit) { return $bestHit }
  return $bestNear
}

function Locator-Matches([System.Windows.Automation.AutomationElement]$el, $loc) {
  if ($null -eq $loc) { return $false }
  $t = Safe-Type $el
  if ($loc.controlType -and $t -ne [string]$loc.controlType) { return $false }
  if ($loc.automationId -and (Safe-Id $el) -ne [string]$loc.automationId) { return $false }
  if ($loc.name -and (Safe-Name $el) -ne [string]$loc.name) { return $false }
  if ($loc.className -and (Safe-Class $el) -ne [string]$loc.className) { return $false }
  return $true
}

function Resolve-ByLocator([System.Windows.Automation.AutomationElement]$root, $loc) {
  if ($null -eq $root -or $null -eq $loc) { return @() }
  $hits = New-Object System.Collections.Generic.List[object]
  # Manual scan only — PropertyCondition/AndCondition throw "Argument types do not match" under some PS/UIA builds.
  try {
    $found = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $wantType = [string]$loc.controlType
    $wantName = [string]$loc.name
    $wantId = [string]$loc.automationId
    for ($i = 0; $i -lt $found.Count; $i++) {
      $el = $found.Item($i)
      $t = ''
      $n = ''
      $id = ''
      try {
        $t = [string]$el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        $n = [string]$el.Current.Name
        $id = [string]$el.Current.AutomationId
      } catch { continue }
      if ($wantType -and $t -ne $wantType) { continue }
      if ($wantId -and $id -ne $wantId) { continue }
      if ($wantName -and $n -ne $wantName) { continue }
      if (-not $wantType -and -not $wantId -and -not $wantName) { continue }
      $hits.Add($el) | Out-Null
    }
  } catch {
    return @()
  }
  return @($hits)
}

function Activate-Hwnd([int64]$hwnd) {
  if ($hwnd -le 0) { return $false }
  return [UiaNative]::ForceFocus([IntPtr]$hwnd)
}

function Handle-Probe($req) {
  $hwnd = 0
  if ($req.hwnd) { $hwnd = [int64]$req.hwnd }
  $root = $null
  if ($hwnd -gt 0) { $root = Find-WindowRoot $hwnd }
  $cursorRoots = Find-CursorWindows
  if ($null -eq $root -and $cursorRoots.Count -gt 0) {
    $root = $cursorRoots[0]
    $hwnd = Safe-Hwnd $root
  }
  $total = 0
  $chats = 0
  $inputs = 0
  $buttons = 0
  $sample = @()
  if ($null -ne $root) {
    try {
      $all = $root.FindAll($TP::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $total = $all.Count
      $limit = [Math]::Min($all.Count, 800)
      for ($i = 0; $i -lt $limit; $i++) {
        $el = $all.Item($i)
        $t = Safe-Type $el
        if ($t -eq 'Button') { $buttons++ }
        if (Is-ChatCandidate $el) { $chats++ }
        if (Is-InputCandidate $el) { $inputs++ }
        if ($sample.Count -lt 12 -and $t -in @('Edit','Document','TabItem','ListItem','TreeItem','Button')) {
          $n = Safe-Name $el
          $sample += @{
            controlType = $t
            name = $(if ($n.Length -gt 40) { $n.Substring(0,40) } else { $n })
            automationId = Safe-Id $el
          }
        }
      }
    } catch {}
  }
  $accessible = ($total -gt 20) -or ($inputs -gt 0) -or ($chats -gt 2)
  $status = if ($null -eq $root) { 'no_cursor' }
    elseif (-not $accessible) { 'chrome_only' }
    else { 'ok' }
  $hint = 'ok'
  if ($status -eq 'no_cursor') { $hint = 'no_cursor' }
  elseif ($status -eq 'chrome_only') { $hint = 'chrome_only' }
  Write-Json @{
    id = $req.id
    ok = $true
    status = $status
    accessible = $accessible
    hwnd = $hwnd
    windowName = $(if ($root) { Safe-Name $root } else { '' })
    elementCount = $total
    chatCandidates = $chats
    inputCandidates = $inputs
    buttonCount = $buttons
    sample = $sample
    hint = $hint
  }
}

function Handle-ElementFromPoint($req) {
  $x = [int]$req.x
  $y = [int]$req.y
  $role = [string]$req.role
  if (-not $role) { $role = 'any' }
  $hwndUnder = 0
  try {
    $native = New-Object UiaPoint
    $native.X = $x; $native.Y = $y
    $h = [UiaNative]::WindowFromPoint($native)
    $top = [UiaNative]::GetAncestor($h, 2)
    if ($top -ne [IntPtr]::Zero) { $hwndUnder = [int64]$top } else { $hwndUnder = [int64]$h }
  } catch {}

  $picked = $null
  $root = $null
  $hwnd = $hwndUnder

  if ($role -eq 'chat' -or $role -eq 'input') {
    # Always search Cursor windows by bounds first. Another app may sit on top
    # (games, overlays) so WindowFromPoint alone is unreliable for agent rows.
    $roots = New-Object System.Collections.Generic.List[object]
    $cursorRoots = Find-CursorWindows
    foreach ($cr in $cursorRoots) { $roots.Add($cr) | Out-Null }
    if ($hwndUnder -gt 0) {
      $under = Find-WindowRoot $hwndUnder
      if ($null -ne $under) {
        $already = $false
        foreach ($r0 in $roots) {
          try { if ((Safe-Hwnd $r0) -eq $hwndUnder) { $already = $true; break } } catch {}
        }
        if (-not $already) { $roots.Add($under) | Out-Null }
      }
    }
    foreach ($candRoot in $roots) {
      $hit = Find-AtPointByRole $candRoot $x $y $role
      if ($null -ne $hit) {
        $picked = $hit
        $root = $candRoot
        $hwnd = Safe-Hwnd $candRoot
        if ($hwnd -le 0) { $hwnd = $hwndUnder }
        break
      }
    }
    if ($null -eq $picked) {
      $pt = New-Object System.Windows.Point($x, $y)
      $el = $null
      try { $el = $UIA::FromPoint($pt) } catch {}
      if ($null -ne $el) {
        if ($role -eq 'chat') { $picked = Climb-Chat $el }
        else { $picked = Climb-Input $el }
        if ($null -ne $picked) {
          $root = Find-WindowRoot $hwndUnder
          if ($null -eq $root -and $cursorRoots.Count -gt 0) { $root = $cursorRoots[0] }
          $hwnd = Safe-Hwnd $root
        }
      }
    }
    if ($null -eq $picked) {
      Write-Json @{
        id = $req.id
        ok = $false
        error = $(if ($role -eq 'chat') { 'not_chat' } else { 'not_input' })
      }
      return
    }
  } else {
    $root = Find-WindowRoot $hwndUnder
    $pt = New-Object System.Windows.Point($x, $y)
    try { $picked = $UIA::FromPoint($pt) } catch {}
    if ($null -eq $picked) {
      Write-Json @{ id = $req.id; ok = $false; error = 'element_not_found' }
      return
    }
  }
  $loc = Get-Locator $picked $root
  try {
    $br = $picked.Current.BoundingRectangle
    $loc.pointHint = @{
      x = [int]($br.X + $br.Width / 2)
      y = [int]($br.Y + $br.Height / 2)
    }
  } catch {
    $loc.pointHint = @{ x = $x; y = $y }
  }
  Write-Json @{
    id = $req.id
    ok = $true
    hwnd = $hwnd
    windowName = $(if ($root) { Safe-Name $root } else { Safe-Name $picked })
    controlType = Safe-Type $picked
    name = Safe-Name $picked
    automationId = Safe-Id $picked
    className = Safe-Class $picked
    locator = $loc
    role = $role
  }
}

function Handle-ListChats($req) {
  $hwnd = 0
  try { $hwnd = [int64]$req.hwnd } catch { $hwnd = 0 }
  $root = Find-WindowRoot $hwnd
  if ($null -eq $root) {
    Write-Json @{ id = $req.id; ok = $false; error = 'window_not_found' }
    return
  }
  $items = @()
  $stage = 'find'
  try {
    $scope = [System.Windows.Automation.TreeScope]::Descendants
    $trueCond = [System.Windows.Automation.Condition]::TrueCondition
    $all = $root.FindAll($scope, $trueCond)
    $stage = 'scan'
    $limit = [Math]::Min($all.Count, 900)
    for ($i = 0; $i -lt $limit; $i++) {
      $el = $all.Item($i)
      $t = ''
      $name = ''
      try {
        $t = [string]$el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        $name = [string]$el.Current.Name
      } catch { continue }
      if ($t -ne 'ListItem' -and $t -ne 'TabItem' -and $t -ne 'TreeItem') { continue }
      if ([string]::IsNullOrWhiteSpace($name)) { continue }
      if ($name -match '^(See more)$') { continue }
      $aid = ''
      try { $aid = [string]$el.Current.AutomationId } catch {}
      $loc = @{
        controlType = $t
        name = $name
        automationId = $aid
        className = ''
        path = @()
      }
      $items += @{
        controlType = $t
        name = $name
        automationId = $aid
        locator = $loc
      }
      if ($items.Count -ge 40) { break }
    }
  } catch {
    Write-Json @{ id = $req.id; ok = $false; error = ($stage + ':' + $_.Exception.Message) }
    return
  }
  Write-Json @{ id = $req.id; ok = $true; chats = $items; count = $items.Count }
}

function Handle-SelectChat($req) {
  $stage = 'start'
  try {
    $hwnd = [int64]$req.hwnd
    $loc = $req.locator
    $wantType = [string]$loc.controlType
    $wantName = [string]$loc.name
    $wantId = [string]$loc.automationId
    $stage = 'root'
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
    if ($null -eq $root) {
      Write-Json @{ id = $req.id; ok = $false; error = 'window_not_found' }
      return
    }
    $stage = 'activate'
    try { [void][UiaNative]::ForceFocus([IntPtr]$hwnd) } catch {}
    Start-Sleep -Milliseconds 80
    $stage = 'findall'
    $all = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $stage = 'scan'
    $el = $null
    $matchCount = 0
    for ($i = 0; $i -lt $all.Count; $i++) {
      $cand = $all.Item($i)
      $t = ''
      $n = ''
      $id = ''
      try {
        $t = [string]$cand.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        $n = [string]$cand.Current.Name
        $id = [string]$cand.Current.AutomationId
      } catch { continue }
      if ($wantType -and $t -ne $wantType) { continue }
      if ($wantId -and $id -ne $wantId) { continue }
      if ($wantName -and $n -ne $wantName) { continue }
      $matchCount++
      if ($null -eq $el) { $el = $cand }
    }
    if ($null -eq $el) {
      Write-Json @{ id = $req.id; ok = $false; error = 'chat_not_found' }
      return
    }
    if ($matchCount -gt 1) {
      Write-Json @{ id = $req.id; ok = $false; error = 'chat_ambiguous'; count = $matchCount }
      return
    }
    $selected = $false
    $stage = 'select'
    try {
      $pat = $el.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $sip = $pat -as [System.Windows.Automation.SelectionItemPattern]
      if ($null -ne $sip) { $sip.Select(); $selected = $true }
    } catch {}
    if (-not $selected) {
      try {
        $stage = 'invoke'
        $pat2 = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $ip = $pat2 -as [System.Windows.Automation.InvokePattern]
        if ($null -ne $ip) { $ip.Invoke(); $selected = $true }
      } catch {}
    }
    if (-not $selected) {
      try {
        $stage = 'focus'
        $el.SetFocus()
        $selected = $true
      } catch {
        Write-Json @{ id = $req.id; ok = $false; error = 'chat_select_failed'; stage = $stage }
        return
      }
    }
    Start-Sleep -Milliseconds 120
    Write-Json @{
      id = $req.id
      ok = $true
      selected = $selected
      name = [string]$el.Current.Name
      controlType = [string]$el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
    }
  } catch {
    Write-Json @{ id = $req.id; ok = $false; error = ($stage + ':' + $_.Exception.Message) }
  }
}

function Handle-FocusInput($req) {
  $stage = 'start'
  try {
    $hwnd = [int64]$req.hwnd
    $loc = $req.locator
    $wantType = [string]$loc.controlType
    $wantName = [string]$loc.name
    $wantId = [string]$loc.automationId
    $stage = 'root'
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
    if ($null -eq $root) {
      Write-Json @{ id = $req.id; ok = $false; error = 'window_not_found' }
      return
    }
    try { [void][UiaNative]::ForceFocus([IntPtr]$hwnd) } catch {}
    Start-Sleep -Milliseconds 60
    $stage = 'findall'
    $all = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $stage = 'scan'
    $matches = New-Object System.Collections.ArrayList
    for ($i = 0; $i -lt $all.Count; $i++) {
      $cand = $all.Item($i)
      $t = ''
      $n = ''
      $id = ''
      try {
        $t = [string]$cand.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        $n = [string]$cand.Current.Name
        $id = [string]$cand.Current.AutomationId
      } catch { continue }
      if ($wantType -and $t -ne $wantType) { continue }
      if ($wantId -and $wantId.Length -gt 0 -and $id -ne $wantId) { continue }
      if ($wantName -and $wantName.Length -gt 0 -and $n -ne $wantName) { continue }
      if ($id -eq 'RootWebArea') { continue }
      [void]$matches.Add($cand)
    }
    if ($matches.Count -eq 0) {
      Write-Json @{ id = $req.id; ok = $false; error = 'input_not_found' }
      return
    }
    $el = $null
    if ($matches.Count -eq 1) {
      $el = $matches[0]
    } else {
      $hintX = 0; $hintY = 0; $hasHint = $false
      try {
        if ($null -ne $loc.pointHint) {
          $hintX = [int]$loc.pointHint.x
          $hintY = [int]$loc.pointHint.y
          $hasHint = $true
        }
      } catch {}
      $best = $null
      $bestScore = [double]::MaxValue
      foreach ($m in $matches) {
        try {
          $r = $m.Current.BoundingRectangle
          if ($r.Width -le 1 -or $r.Height -le 1) { continue }
          $score = [double]$r.Width * [double]$r.Height
          if ($hasHint) {
            $cx = $r.X + $r.Width / 2
            $cy = $r.Y + $r.Height / 2
            $dist = [Math]::Abs($cx - $hintX) + [Math]::Abs($cy - $hintY)
            $contains = ($hintX -ge $r.X -and $hintX -le ($r.X + $r.Width) -and $hintY -ge $r.Y -and $hintY -le ($r.Y + $r.Height))
            $score = $(if ($contains) { $dist } else { 100000 + $dist })
          }
          if ($score -lt $bestScore) { $bestScore = $score; $best = $m }
        } catch {}
      }
      if ($null -eq $best) {
        Write-Json @{ id = $req.id; ok = $false; error = 'input_ambiguous'; count = $matches.Count }
        return
      }
      $el = $best
    }
    $stage = 'setfocus'
    $clicked = $false
    try { $el.SetFocus() } catch {}
    Start-Sleep -Milliseconds 60
    $focused = $null
    try { $focused = [System.Windows.Automation.AutomationElement]::FocusedElement } catch {}
    $focusOk = $false
    $focusType = ''
    $focusName = ''
    if ($null -ne $focused) {
      try {
        $focusType = [string]$focused.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        $focusName = [string]$focused.Current.Name
      } catch {}
      try { if ($focused.Equals($el)) { $focusOk = $true } } catch {}
      if (-not $focusOk -and $focusType -in @('Edit','Document')) { $focusOk = $true }
    }
    if (-not $focusOk) {
      $stage = 'click'
      try {
        $r = $el.Current.BoundingRectangle
        $cx = [int]($r.X + $r.Width / 2)
        $cy = [int]($r.Y + $r.Height / 2)
        if ($cx -gt 0 -and $cy -gt 0) {
          [UiaNative]::ClickScreen($cx, $cy)
          $clicked = $true
          Start-Sleep -Milliseconds 100
          # Chromium Edit often reports opaque focus; click on resolved Edit is enough to paste.
          $focusOk = $true
          try {
            $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
            if ($null -ne $focused) {
              $focusType = [string]$focused.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
              $focusName = [string]$focused.Current.Name
            }
          } catch {}
        }
      } catch {}
    }
    Write-Json @{
      id = $req.id
      ok = $focusOk
      focused = $focusOk
      clicked = $clicked
      controlType = [string]$el.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
      name = [string]$el.Current.Name
      focusType = $focusType
      focusName = $focusName
      error = $(if ($focusOk) { $null } else { 'focus_mismatch' })
    }
  } catch {
    Write-Json @{ id = $req.id; ok = $false; error = ($stage + ':' + $_.Exception.Message) }
  }
}

function Handle-SetValue($req) {
  # Quiet write via ValuePattern — does not activate the window.
  $stage = 'start'
  try {
    $hwnd = [int64]$req.hwnd
    $loc = $req.locator
    $value = [string]$req.value
    $wantType = [string]$loc.controlType
    $wantName = [string]$loc.name
    $wantId = [string]$loc.automationId
    $root = [System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]$hwnd)
    if ($null -eq $root) {
      Write-Json @{ id = $req.id; ok = $false; error = 'window_not_found' }
      return
    }
    $all = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $el = $null
    for ($i = 0; $i -lt $all.Count; $i++) {
      $cand = $all.Item($i)
      try {
        $t = [string]$cand.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
        $n = [string]$cand.Current.Name
        $id = [string]$cand.Current.AutomationId
      } catch { continue }
      if ($wantType -and $t -ne $wantType) { continue }
      if ($wantId -and $wantId.Length -gt 0 -and $id -ne $wantId) { continue }
      if ($wantName -and $wantName.Length -gt 0 -and $n -ne $wantName) { continue }
      $el = $cand
      break
    }
    if ($null -eq $el) {
      Write-Json @{ id = $req.id; ok = $false; error = 'input_not_found' }
      return
    }
    $stage = 'value'
    try {
      $pat = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $vp = $pat -as [System.Windows.Automation.ValuePattern]
      if ($null -eq $vp) { throw 'no ValuePattern' }
      if ($vp.Current.IsReadOnly) {
        Write-Json @{ id = $req.id; ok = $false; error = 'readonly' }
        return
      }
      $vp.SetValue($value)
      Write-Json @{ id = $req.id; ok = $true }
    } catch {
      Write-Json @{ id = $req.id; ok = $false; error = 'no_value_pattern' }
    }
  } catch {
    Write-Json @{ id = $req.id; ok = $false; error = ($stage + ':' + $_.Exception.Message) }
  }
}

function Handle-Ping($req) {
  Write-Json @{ id = $req.id; ok = $true; pong = $true }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $line = $line.Trim()
  if (-not $line) { continue }
  $req = $null
  try { $req = $line | ConvertFrom-Json } catch {
    Write-Json @{ id = $null; ok = $false; error = 'bad_json' }
    continue
  }
  $cmd = [string]$req.cmd
  try {
    switch ($cmd) {
      'ping' { Handle-Ping $req }
      'probe' { Handle-Probe $req }
      'diagnose' { Handle-Probe $req }
      'elementFromPoint' { Handle-ElementFromPoint $req }
      'listChats' { Handle-ListChats $req }
      'selectChat' { Handle-SelectChat $req }
      'focusInput' { Handle-FocusInput $req }
      'setValue' { Handle-SetValue $req }
      'quit' { Write-Json @{ id = $req.id; ok = $true }; break }
      default { Write-Json @{ id = $req.id; ok = $false; error = "unknown_cmd:$cmd" } }
    }
  } catch {
    Write-Json @{ id = $req.id; ok = $false; error = $_.Exception.Message }
  }
  if ($cmd -eq 'quit') { break }
}
