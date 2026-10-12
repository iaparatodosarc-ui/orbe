# Orbe - ayudante de Windows: encuentra la ventana bajo un punto o la ventana activa,
# y (solo cuando el usuario lo autoriza en el chat) escribe una respuesta en ella.
# Protocolo por stdin/stdout, una linea por pedido (precedida por un id que vuelve en la respuesta):
#   point <x> <y> <pidExcluir>   -> ventana visible mas arriba que contiene el punto (coords fisicas)
#   fg <pidExcluir>              -> ventana en primer plano
#   item <x> <y>                -> icono/archivo/carpeta bajo el punto (escritorio o Explorador): {name,path,kind,where}
#   paste <hwnd>                 -> trae esa ventana al frente y pulsa Ctrl+V (el texto ya esta en el portapapeles)
#   focus <hwnd>                 -> devuelve el foco a esa ventana
#   winh start <hwnd> | winh stop <hwnd1> <hwnd2> -> abre / cierra el dictado de Windows (Windows+H)
# Respuesta: una linea JSON {hwnd,title,proc,x,y,w,h} / {ok:true|false} o {} si no hay.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;
public class OrbeWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public class Info { public long hwnd; public string title; public uint pid; public int x, y, w, h; }

  static RECT Bounds(IntPtr h) {
    RECT r;
    if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(RECT))) != 0) GetWindowRect(h, out r);
    return r;
  }
  static bool Usable(IntPtr h, uint exclude) {
    if (!IsWindowVisible(h) || IsIconic(h)) return false;
    int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4); if (cloaked != 0) return false;
    if (GetWindowTextLength(h) == 0) return false;
    uint pid; GetWindowThreadProcessId(h, out pid); if (pid == exclude) return false;
    // capas invisibles de Windows (dictado Win+H, teclado tactil, emojis, menu Inicio, busqueda): cubren toda la
    // pantalla aunque no se vean, asi que nunca cuentan como "la ventana bajo el orbe"
    var cls = new StringBuilder(128); GetClassName(h, cls, 128);
    string c = cls.ToString();
    if (c == "Windows.UI.Core.CoreWindow" || c == "Shell_InputSwitchTopLevelWindow" || c == "XamlExplorerHostIslandWindow" || c == "ForegroundStaging") return false;
    return true;
  }
  static Info Make(IntPtr h) {
    var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
    uint pid; GetWindowThreadProcessId(h, out pid);
    RECT r = Bounds(h);
    return new Info { hwnd = h.ToInt64(), title = sb.ToString(), pid = pid, x = r.L, y = r.T, w = r.R - r.L, h = r.B - r.T };
  }
  public static Info AtPoint(int x, int y, uint exclude) {
    Info found = null;
    EnumWindows((h, l) => {
      if (!Usable(h, exclude)) return true;
      RECT r = Bounds(h);
      if (x >= r.L && x < r.R && y >= r.T && y < r.B) {
        var sb = new StringBuilder(256); GetWindowText(h, sb, 256);
        if (sb.ToString() == "Program Manager") return true;
        found = Make(h); return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static Info Foreground(uint exclude) {
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || !Usable(h, exclude)) return null;
    return Make(h);
  }
  // Trae una ventana al frente (Windows no lo permite a cualquiera; este es el truco habitual).
  public static bool Focus(long hv) {
    IntPtr h = new IntPtr(hv);
    if (!IsWindow(h)) return false;
    if (GetForegroundWindow() == h) return true;
    if (IsIconic(h)) ShowWindow(h, 9);
    uint pid; uint fgThread = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
    uint me = GetCurrentThreadId();
    AttachThreadInput(me, fgThread, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // Alt: permite cambiar el foco
    BringWindowToTop(h); SetForegroundWindow(h);
    AttachThreadInput(me, fgThread, false);
    for (int i = 0; i < 12; i++) { Thread.Sleep(50); if (GetForegroundWindow() == h) return true; }
    return GetForegroundWindow() == h;
  }
  // Windows + H: abre o cierra el dictado por voz de Windows en el cuadro de texto que tiene el foco.
  public static void WinH() {
    keybd_event(0x5B, 0, 1, UIntPtr.Zero); keybd_event(0x48, 0, 0, UIntPtr.Zero);
    keybd_event(0x48, 0, 2, UIntPtr.Zero); keybd_event(0x5B, 0, 3, UIntPtr.Zero);
  }
  // Trae la ventana al frente y pulsa Ctrl+V. No pulsa Enter: enviar siempre lo decide el usuario.
  public static bool Paste(long hv) {
    if (!Focus(hv)) return false;
    Thread.Sleep(100);
    keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x56, 0, 0, UIntPtr.Zero);
    keybd_event(0x56, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
    return true;
  }
}
"@
[OrbeWin]::SetProcessDPIAware() | Out-Null

# ---------- icono / archivo / carpeta bajo un punto (escritorio o Explorador) ----------
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, WindowsBase
Add-Type -TypeDefinition @"
using System; using System.Text; using System.Runtime.InteropServices;
public class OrbeHit {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr p, IntPtr a, UIntPtr size, uint type, uint prot);
  [DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr p, IntPtr a, UIntPtr size, uint type);
  [DllImport("kernel32.dll")] public static extern bool WriteProcessMemory(IntPtr p, IntPtr a, byte[] b, UIntPtr size, out UIntPtr done);
  [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr p, IntPtr a, byte[] b, UIntPtr size, out UIntPtr done);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  public static long Root(int x, int y) { var p = new POINT{X=x,Y=y}; return GetAncestor(WindowFromPoint(p), 2).ToInt64(); }
  public static string Cls(long h) { var sb = new StringBuilder(256); GetClassName(new IntPtr(h), sb, 256); return sb.ToString(); }
  // Nombre del icono del escritorio bajo el punto. El escritorio es una lista clasica (SysListView32) que
  // en Windows 11 no siempre expone sus iconos por UI Automation; se le pregunta directo con LVM_HITTEST.
  public static string ListViewNameAt(int x, int y) {
    if (IntPtr.Size != 8) return null;
    var p = new POINT{X=x,Y=y}; IntPtr lv = WindowFromPoint(p);
    if (Cls(lv.ToInt64()) != "SysListView32") return null;
    ScreenToClient(lv, ref p);
    uint pid; GetWindowThreadProcessId(lv, out pid);
    IntPtr hp = OpenProcess(0x0008 | 0x0010 | 0x0020, false, pid);
    if (hp == IntPtr.Zero) return null;
    IntPtr mem = VirtualAllocEx(hp, IntPtr.Zero, (UIntPtr)4096, 0x3000, 0x04);
    try {
      if (mem == IntPtr.Zero) return null;
      UIntPtr n;
      byte[] ht = new byte[24];
      BitConverter.GetBytes(p.X).CopyTo(ht, 0); BitConverter.GetBytes(p.Y).CopyTo(ht, 4);
      if (!WriteProcessMemory(hp, mem, ht, (UIntPtr)ht.Length, out n)) return null;
      int idx = SendMessage(lv, 0x1012, IntPtr.Zero, mem).ToInt32();          // LVM_HITTEST
      if (idx < 0) return null;
      ReadProcessMemory(hp, mem, ht, (UIntPtr)ht.Length, out n);
      if ((BitConverter.ToUInt32(ht, 8) & 0x0E) == 0) return null;               // LVHT_ONITEM
      byte[] it = new byte[88];                                                   // LVITEMW (x64)
      BitConverter.GetBytes(idx).CopyTo(it, 4);
      long textAddr = mem.ToInt64() + 512;
      BitConverter.GetBytes(textAddr).CopyTo(it, 24);
      BitConverter.GetBytes(260).CopyTo(it, 32);
      if (!WriteProcessMemory(hp, mem, it, (UIntPtr)it.Length, out n)) return null;
      int len = SendMessage(lv, 0x1073, new IntPtr(idx), mem).ToInt32();        // LVM_GETITEMTEXTW
      if (len <= 0 || len > 260) return null;
      byte[] tb = new byte[len * 2];
      if (!ReadProcessMemory(hp, new IntPtr(textAddr), tb, (UIntPtr)tb.Length, out n)) return null;
      return Encoding.Unicode.GetString(tb);
    } finally {
      if (mem != IntPtr.Zero) VirtualFreeEx(hp, mem, UIntPtr.Zero, 0x8000);
      CloseHandle(hp);
    }
  }
}
"@
$script:shell = $null
function Resolve-InFolder([string]$dir, [string]$name) {
  if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { return $null }
  $exact = Join-Path $dir $name
  if (Test-Path -LiteralPath $exact) { return (Get-Item -LiteralPath $exact -Force) }
  # el Explorador suele ocultar la extension: buscar por nombre sin extension
  $m = Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue | Where-Object { $_.BaseName -eq $name -or $_.Name -eq $name } | Select-Object -First 1
  return $m
}
function Get-ItemAt([int]$x, [int]$y) {
  $root = [OrbeHit]::Root($x, $y)
  if ($root -eq 0) { return $null }
  $cls = [OrbeHit]::Cls($root)
  $name = $null
  # 1) escritorio: preguntarle directo a la lista de iconos
  if ($cls -eq 'Progman' -or $cls -eq 'WorkerW') {
    try { $name = [OrbeHit]::ListViewNameAt($x, $y) } catch { $name = $null }
  }
  # 2) UI Automation: el elemento bajo el punto o uno de sus padres
  if (-not $name) {
    $start = $null
    try { $start = [System.Windows.Automation.AutomationElement]::FromPoint((New-Object System.Windows.Point($x, $y))) } catch { return $null }
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $LI = [System.Windows.Automation.ControlType]::ListItem; $DI = [System.Windows.Automation.ControlType]::DataItem
    $el = $start; $i = 0
    while ($el -ne $null -and $i -lt 8) {
      $ct = $el.Current.ControlType
      if ($ct -eq $LI -or $ct -eq $DI) { $name = $el.Current.Name; break }
      $el = $walker.GetParent($el); $i++
    }
    # 3) si el punto cae sobre la lista y no sobre un icono: buscar el hijo cuyo rectangulo lo contiene
    if (-not $name -and $start -ne $null) {
      $cp = [System.Windows.Automation.AutomationElement]::ControlTypeProperty
      $cond = New-Object System.Windows.Automation.OrCondition((New-Object System.Windows.Automation.PropertyCondition($cp, $LI)), (New-Object System.Windows.Automation.PropertyCondition($cp, $DI)))
      $cont = $start; $j = 0
      while ($cont -ne $null -and $j -lt 3 -and -not $name) {
        $kids = $null
        try { $kids = $cont.FindAll([System.Windows.Automation.TreeScope]::Children, $cond) } catch {}
        if ($kids -ne $null -and $kids.Count -gt 0) {
          foreach ($k in $kids) {
            $r = $k.Current.BoundingRectangle
            if (-not $r.IsEmpty -and $x -ge $r.Left -and $x -lt $r.Right -and $y -ge $r.Top -and $y -lt $r.Bottom) { $name = $k.Current.Name; break }
          }
          break
        }
        $cont = $walker.GetParent($cont); $j++
      }
    }
  }
  if (-not $name) { return $null }
  $item = $null; $where = ''
  if ($cls -eq 'Progman' -or $cls -eq 'WorkerW') {
    $where = 'Escritorio'
    foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'))) {
      $item = Resolve-InFolder $d $name; if ($item) { break }
    }
  } elseif ($cls -eq 'CabinetWClass' -or $cls -eq 'ExploreWClass') {
    if (-not $script:shell) { $script:shell = New-Object -ComObject Shell.Application }
    $wins = @($script:shell.Windows() | Where-Object { $_.HWND -eq $root })
    foreach ($w in $wins) {
      $dir = $null; try { $dir = $w.Document.Folder.Self.Path } catch {}
      if ($name -match '\(([A-Z]):\)') { $item = Get-Item -LiteralPath ($Matches[1] + ':\') -ErrorAction SilentlyContinue; if ($item) { break } }
      $item = Resolve-InFolder $dir $name
      if ($item) { $where = $dir; break }
    }
  }
  if (-not $item) { return @{ name = $name; path = ''; kind = 'unknown'; where = $where } }
  $kind = if ($item.PSIsContainer) { 'folder' } else { 'file' }
  return @{ name = $item.Name; path = $item.FullName; kind = $kind; where = $where }
}
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
# Cada pedido llega como "<id> <comando> <args...>" y cada respuesta sale como "<id> <json>",
# asi una respuesta lenta nunca se confunde con la de otro pedido.
function Send-Reply([string]$id, $obj) {
  $json = if ($obj -eq $null) { '{}' } else { ($obj | ConvertTo-Json -Compress) }
  [Console]::Out.WriteLine($id + ' ' + $json)
  [Console]::Out.Flush()
}
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $all = $line.Trim().Split(' ')
  if ($all.Length -lt 2) { continue }
  $id = $all[0]
  $p = @($all | Select-Object -Skip 1)
  try {
    if ($p[0] -eq 'item') {
      $r = $null
      try { $r = Get-ItemAt ([int]$p[1]) ([int]$p[2]) } catch { $r = $null }
      if ($r -ne $null) { Send-Reply $id ([pscustomobject]$r) } else { Send-Reply $id $null }
      continue
    }
    if ($p[0] -eq 'winh') {
      # winh start <hwnd>: trae esa ventana de Orbe al frente y abre el dictado (Windows+H)
      # winh stop <hwnd1> <hwnd2>: lo cierra solo si una ventana de Orbe sigue al frente (nunca toca otras apps)
      $ok = $false; $fg = 0
      try {
        if ($p[1] -eq 'start') { [OrbeWin]::Focus([int64]$p[2]) | Out-Null; [OrbeWin]::WinH(); $ok = $true }
        else {
          $fg = [OrbeWin]::GetForegroundWindow().ToInt64()
          if ($fg -eq [int64]$p[2] -or $fg -eq [int64]$p[3]) { [OrbeWin]::WinH(); $ok = $true }
        }
      } catch { $ok = $false }
      Send-Reply $id ([pscustomobject]@{ ok = $ok; fg = $fg })
      continue
    }
    if ($p[0] -eq 'focus') {
      $ok = $false
      try { $ok = [OrbeWin]::Focus([int64]$p[1]) } catch { $ok = $false }
      Send-Reply $id ([pscustomobject]@{ ok = $ok })
      continue
    }
    if ($p[0] -eq 'paste') {
      $ok = $false
      try { $ok = [OrbeWin]::Paste([int64]$p[1]) } catch { $ok = $false }
      Send-Reply $id ([pscustomobject]@{ ok = $ok })
      continue
    }
    $info = $null
    try {
      if ($p[0] -eq 'point') { $info = [OrbeWin]::AtPoint([int]$p[1], [int]$p[2], [uint32]$p[3]) }
      elseif ($p[0] -eq 'fg') { $info = [OrbeWin]::Foreground([uint32]$p[1]) }
    } catch { $info = $null }
    if ($info -ne $null) {
      $proc = ''
      try { $proc = (Get-Process -Id $info.pid).ProcessName } catch {}
      Send-Reply $id ([pscustomobject]@{ hwnd = $info.hwnd; title = $info.title; proc = $proc; x = $info.x; y = $info.y; w = $info.w; h = $info.h })
    } else { Send-Reply $id $null }
  } catch { Send-Reply $id $null }
}
