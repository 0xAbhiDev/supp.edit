# Answer the native Open/Save dialog of a running supp.edit process with a path.
# Used only by scripts/verify-native-focused.mjs to drive the real Windows application.
param([Parameter(Mandatory = $true)][string]$Path, [int]$TimeoutSeconds = 30)
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SuppDialog {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr hwnd, uint msg, IntPtr w, string l);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr w, IntPtr l);
  static string Class(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  public static string Title(IntPtr h) { var s = new StringBuilder(256); GetWindowText(h, s, 256); return s.ToString(); }
  public static IntPtr Find(uint[] pids) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (IsWindowVisible(h) && Array.IndexOf(pids, pid) >= 0 && Class(h) == "#32770") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  // The file-name field is the Edit inside a ComboBox; the search box and address bar are not.
  public static bool Answer(IntPtr dialog, string path) {
    IntPtr edit = IntPtr.Zero;
    EnumChildWindows(dialog, (h, l) => {
      if (Class(h) == "Edit" && Class(GetParent(h)) == "ComboBox" && IsWindowVisible(h)) { edit = h; return false; }
      return true;
    }, IntPtr.Zero);
    if (edit == IntPtr.Zero) return false;
    // Type the path as characters so the dialog receives its normal change notifications;
    // WM_SETTEXT alone leaves a Save dialog's own file name in place.
    SendMessage(edit, 0x000C, IntPtr.Zero, "");          // WM_SETTEXT: clear
    foreach (char ch in path) PostMessage(edit, 0x0102, (IntPtr)ch, IntPtr.Zero); // WM_CHAR
    System.Threading.Thread.Sleep(400);
    PostMessage(dialog, 0x0111, (IntPtr)1, IntPtr.Zero); // WM_COMMAND, IDOK
    return true;
  }
}
'@
$ids = [uint32[]]@(Get-Process -Name 'supp-edit' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if (-not $ids.Count) { throw 'supp.edit is not running' }
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = [IntPtr]::Zero
while ($dialog -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline) {
  $dialog = [SuppDialog]::Find($ids)
  if ($dialog -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 300 }
}
if ($dialog -eq [IntPtr]::Zero) { throw 'No file dialog appeared' }
Start-Sleep -Milliseconds 700
$title = [SuppDialog]::Title($dialog)
if (-not [SuppDialog]::Answer($dialog, $Path)) { throw "File-name field not found in '$title'" }
"answered '$title' with $Path"
