# Orbe - ayudante de Windows: encuentra la ventana bajo un punto o la ventana activa.
# Protocolo por stdin/stdout, una linea por pedido:
#   point <x> <y> <pidExcluir>   -> ventana visible mas arriba que contiene el punto (coords fisicas)
#   fg <pidExcluir>              -> ventana en primer plano
# Respuesta: una linea JSON {title,proc,x,y,w,h} o {} si no hay.
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class OrbeWin {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  public class Info { public string title; public uint pid; public int x, y, w, h; }

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
    return true;
  }
  static Info Make(IntPtr h) {
    var sb = new StringBuilder(512); GetWindowText(h, sb, 512);
    uint pid; GetWindowThreadProcessId(h, out pid);
    RECT r = Bounds(h);
    return new Info { title = sb.ToString(), pid = pid, x = r.L, y = r.T, w = r.R - r.L, h = r.B - r.T };
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
}
"@
[OrbeWin]::SetProcessDPIAware() | Out-Null
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
while (($line = [Console]::In.ReadLine()) -ne $null) {
  $p = $line.Trim().Split(' ')
  $info = $null
  try {
    if ($p[0] -eq 'point') { $info = [OrbeWin]::AtPoint([int]$p[1], [int]$p[2], [uint32]$p[3]) }
    elseif ($p[0] -eq 'fg') { $info = [OrbeWin]::Foreground([uint32]$p[1]) }
  } catch { $info = $null }
  if ($info -ne $null) {
    $proc = ''
    try { $proc = (Get-Process -Id $info.pid).ProcessName } catch {}
    $o = [pscustomobject]@{ title = $info.title; proc = $proc; x = $info.x; y = $info.y; w = $info.w; h = $info.h }
    [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
  } else {
    [Console]::Out.WriteLine('{}')
  }
  [Console]::Out.Flush()
}
