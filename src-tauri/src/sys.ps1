# Halo - demon systeme (ASCII uniquement : PowerShell 5.1 lit ce fichier en ANSI)
# Sortie (une ligne par message) :
#   A|<pic 0..1>|<volume 0..1>|<muet 0/1>|<nb sorties>|<sortie la plus forte>
#                                             pic = le plus fort de TOUTES les sorties audio actives
#   M|{json}                                  lecture en cours (Spotify ou autre) via Windows SMTC
# Entree (une commande par ligne) :
#   vol 0.5 | mute 1 | toggle | next | prev | seek 42.5 | only 1 | resend | dev:<nom> | devs
#   D|<choix>|<sortie pilotee>|<sortie 1>|<sortie 2>...   liste des sorties audio (choix : vide, @auto ou un bout de nom)

$ErrorActionPreference = 'Continue'
# Windows en francais : sans ceci les nombres sortent en "12,3" et cassent le JSON
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture
[System.Threading.Thread]::CurrentThread.CurrentUICulture = [System.Globalization.CultureInfo]::InvariantCulture

$csLegacy = @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out int c);
    int SetMasterVolumeLevel(float l, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float l, ref Guid ctx);
    int GetMasterVolumeLevel(out float l);
    int GetMasterVolumeLevelScalar(out float l);
    int SetChannelVolumeLevel(uint n, float l, ref Guid ctx);
    int SetChannelVolumeLevelScalar(uint n, float l, ref Guid ctx);
    int GetChannelVolumeLevel(uint n, out float l);
    int GetChannelVolumeLevelScalar(uint n, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devs);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev);
}

[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection {
    int GetCount(out uint n);
    int Item(uint i, out IMMDevice dev);
}

[ComImport, Guid("BCDE0395-E52F-44F6-AF70-B3BC1BAAD3E2")]
public class MMDeviceEnumeratorComObject { }

public static class HaloSys {
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }

    static readonly ConcurrentQueue<string> Cmds = new ConcurrentQueue<string>();
    static readonly object Gate = new object();
    static List<IAudioMeterInformation> meters = new List<IAudioMeterInformation>();
    static IAudioEndpointVolume vol;
    static Guid Ctx = Guid.Empty;

    public static string Next() { string s; return Cmds.TryDequeue(out s) ? s : null; }

    // Fenetre Spotify (meme cachee dans la zone de notification) : "Artiste - Titre"
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    public static string SpotifyTitle() {
        HashSet<uint> pids = new HashSet<uint>();
        try { foreach (System.Diagnostics.Process p in System.Diagnostics.Process.GetProcessesByName("Spotify")) pids.Add((uint)p.Id); } catch { }
        if (pids.Count == 0) return "";
        string found = "";
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (!pids.Contains(pid)) return true;
            int n = GetWindowTextLength(h);
            if (n <= 0) return true;
            StringBuilder sb = new StringBuilder(n + 1);
            GetWindowText(h, sb, sb.Capacity);
            string t = sb.ToString();
            if (t.IndexOf(" - ", StringComparison.Ordinal) > 0 && !t.StartsWith("Spotify") && !t.StartsWith("GDI+") && !t.StartsWith("Default IME") && !t.StartsWith("MSCTFIME")) { found = t; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // Volume : sortie par defaut. Niveau sonore : TOUTES les sorties actives (logiciel audio, carte virtuelle, enceintes...)
    static void Acquire() {
        List<IAudioMeterInformation> all = new List<IAudioMeterInformation>();
        IAudioMeterInformation defMeter = null; IAudioEndpointVolume defVol = null;
        try {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            Guid gm = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
            Guid gv = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
            IMMDevice dev;
            if (en.GetDefaultAudioEndpoint(0, 1, out dev) == 0 && dev != null) {
                object o1 = null; object o2 = null;
                if (dev.Activate(ref gm, 23, IntPtr.Zero, out o1) == 0 && o1 != null) defMeter = (IAudioMeterInformation)o1;
                if (dev.Activate(ref gv, 23, IntPtr.Zero, out o2) == 0 && o2 != null) defVol = (IAudioEndpointVolume)o2;
            }
            IMMDeviceCollection col;
            if (en.EnumAudioEndpoints(0, 1, out col) == 0 && col != null) {
                uint n; col.GetCount(out n);
                for (uint i = 0; i < n; i++) {
                    try {
                        IMMDevice d; object o = null;
                        if (col.Item(i, out d) != 0 || d == null) continue;
                        if (d.Activate(ref gm, 23, IntPtr.Zero, out o) == 0 && o != null) all.Add((IAudioMeterInformation)o);
                    } catch { }
                }
            }
        } catch { }
        if (all.Count == 0 && defMeter != null) all.Add(defMeter);
        lock (Gate) { meters = all; vol = defVol; }
    }

    static void AudioLoop() {
        float lastP = -1f, lastV = -1f; bool lastM = false; int tick = 0;
        DateTime lastSend = DateTime.MinValue;
        while (true) {
            try {
                int count0; lock (Gate) { count0 = meters.Count; }
                if (tick % 75 == 0 || count0 == 0) Acquire();
                float p = 0f, v = 0f; bool m = false; int best = -1, n = 0;
                lock (Gate) {
                    for (int i = 0; i < meters.Count; i++) {
                        float x;
                        if (meters[i].GetPeakValue(out x) == 0 && x > p) { p = x; best = i; }
                    }
                    n = meters.Count;
                    if (vol != null) { vol.GetMasterVolumeLevelScalar(out v); vol.GetMute(out m); }
                }
                bool changed = Math.Abs(p - lastP) > 0.004f || Math.Abs(v - lastV) > 0.004f || m != lastM;
                if (changed || (DateTime.UtcNow - lastSend).TotalSeconds > 2.0) {
                    Console.Out.WriteLine("A|" + p.ToString("0.000", CultureInfo.InvariantCulture) + "|" +
                        v.ToString("0.000", CultureInfo.InvariantCulture) + "|" + (m ? "1" : "0") + "|" + n + "|" + best);
                    lastP = p; lastV = v; lastM = m; lastSend = DateTime.UtcNow;
                }
            } catch {
                lock (Gate) { meters = new List<IAudioMeterInformation>(); vol = null; }
            }
            tick++;
            Thread.Sleep(40);
        }
    }

    static void StdinLoop() {
        try {
            string line;
            while ((line = Console.In.ReadLine()) != null) {
                line = line.Trim();
                if (line.StartsWith("vol ")) {
                    float f;
                    if (float.TryParse(line.Substring(4), NumberStyles.Float, CultureInfo.InvariantCulture, out f)) {
                        if (f < 0f) f = 0f;
                        if (f > 1f) f = 1f;
                        lock (Gate) { if (vol != null) vol.SetMasterVolumeLevelScalar(f, ref Ctx); }
                    }
                } else if (line.StartsWith("mute ")) {
                    bool mm = line.Substring(5).Trim() == "1";
                    lock (Gate) { if (vol != null) vol.SetMute(mm, ref Ctx); }
                } else if (line.Length > 0) {
                    Cmds.Enqueue(line);
                }
            }
        } catch { }
        Environment.Exit(0);
    }

    public static void Start() {
        Thread a = new Thread(AudioLoop); a.IsBackground = true; a.Start();
        Thread b = new Thread(StdinLoop); b.IsBackground = true; b.Start();
    }
}
'@

$cs = @'
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation {
    int GetPeakValue(out float peak);
}

[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out int c);
    int SetMasterVolumeLevel(float l, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float l, ref Guid ctx);
    int GetMasterVolumeLevel(out float l);
    int GetMasterVolumeLevelScalar(out float l);
    int SetChannelVolumeLevel(uint n, float l, ref Guid ctx);
    int SetChannelVolumeLevelScalar(uint n, float l, ref Guid ctx);
    int GetChannelVolumeLevel(uint n, out float l);
    int GetChannelVolumeLevelScalar(uint n, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore ps);
}

[StructLayout(LayoutKind.Sequential)]
public struct PROPERTYKEY { public Guid fmtid; public uint pid; }

[StructLayout(LayoutKind.Sequential)]
public struct PROPVARIANT { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }

[Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPropertyStore {
    [PreserveSig] int GetCount(out uint c);
    [PreserveSig] int GetAt(uint i, out PROPERTYKEY k);
    [PreserveSig] int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
    [PreserveSig] int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
    [PreserveSig] int Commit();
}

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devs);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev);
}

[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection {
    int GetCount(out uint n);
    int Item(uint i, out IMMDevice dev);
}

[ComImport, Guid("BCDE0395-E52F-44F6-AF70-B3BC1BAAD3E2")]
public class MMDeviceEnumeratorComObject { }

public static class HaloSys {
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static void Key(byte vk) { keybd_event(vk, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 2, UIntPtr.Zero); }

    static readonly ConcurrentQueue<string> Cmds = new ConcurrentQueue<string>();
    static readonly object Gate = new object();
    static List<IAudioMeterInformation> meters = new List<IAudioMeterInformation>();
    static IAudioEndpointVolume vol;
    static IAudioMeterInformation selMeter = null;   // niveau de la sortie choisie (casque...)
    static volatile bool selOnly = false;            // vrai : l'indicateur ne suit que la sortie choisie
    static Guid Ctx = Guid.Empty;

    // Sortie dont on pilote le volume : "" = sortie par defaut de Windows, "@auto" = comme la sortie par defaut,
    // mais si c'est Elgato Wave Link (carte virtuelle) on prend la premiere vraie sortie ; sinon un morceau du nom de la sortie
    static volatile string pref = "";
    static string lastAnnounce = "";
    static DateTime lastAnnounceAt = DateTime.MinValue;
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PROPVARIANT v);

    static string NameOf(IMMDevice d) {
        try {
            IPropertyStore ps;
            if (d.OpenPropertyStore(0, out ps) != 0 || ps == null) return "";
            PROPERTYKEY k = new PROPERTYKEY();
            k.fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0");
            k.pid = 14;
            PROPVARIANT v;
            if (ps.GetValue(ref k, out v) != 0) return "";
            string name = "";
            if (v.vt == 31 && v.p != IntPtr.Zero) name = Marshal.PtrToStringUni(v.p);
            PropVariantClear(ref v);
            return name == null ? "" : name;
        } catch { return ""; }
    }

    static bool HasText(string hay, string needle) {
        return hay != null && hay.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    public static string Next() { string s; return Cmds.TryDequeue(out s) ? s : null; }

    // Fenetre Spotify (meme cachee dans la zone de notification) : "Artiste - Titre"
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    public static string SpotifyTitle() {
        HashSet<uint> pids = new HashSet<uint>();
        try { foreach (System.Diagnostics.Process p in System.Diagnostics.Process.GetProcessesByName("Spotify")) pids.Add((uint)p.Id); } catch { }
        if (pids.Count == 0) return "";
        string found = "";
        EnumWindows(delegate(IntPtr h, IntPtr l) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (!pids.Contains(pid)) return true;
            int n = GetWindowTextLength(h);
            if (n <= 0) return true;
            StringBuilder sb = new StringBuilder(n + 1);
            GetWindowText(h, sb, sb.Capacity);
            string t = sb.ToString();
            if (t.IndexOf(" - ", StringComparison.Ordinal) > 0 && !t.StartsWith("Spotify") && !t.StartsWith("GDI+") && !t.StartsWith("Default IME") && !t.StartsWith("MSCTFIME")) { found = t; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    // Volume : sortie par defaut. Niveau sonore : TOUTES les sorties actives (logiciel audio, carte virtuelle, enceintes...)
    static void Acquire() {
        List<IAudioMeterInformation> all = new List<IAudioMeterInformation>();
        IAudioMeterInformation defMeter = null; IAudioEndpointVolume defVol = null;
        IAudioEndpointVolume selVol = null; IAudioMeterInformation sm = null; string defName = ""; string selName = "";
        List<string> nl = new List<string>(); List<IMMDevice> dl = new List<IMMDevice>();
        try {
            IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            Guid gm = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
            Guid gv = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
            IMMDevice dev;
            if (en.GetDefaultAudioEndpoint(0, 1, out dev) == 0 && dev != null) {
                object o1 = null; object o2 = null;
                if (dev.Activate(ref gm, 23, IntPtr.Zero, out o1) == 0 && o1 != null) defMeter = (IAudioMeterInformation)o1;
                if (dev.Activate(ref gv, 23, IntPtr.Zero, out o2) == 0 && o2 != null) defVol = (IAudioEndpointVolume)o2;
                defName = NameOf(dev).Replace("|", "/");
            }
            IMMDeviceCollection col;
            if (en.EnumAudioEndpoints(0, 1, out col) == 0 && col != null) {
                uint n; col.GetCount(out n);
                for (uint i = 0; i < n; i++) {
                    try {
                        IMMDevice d; object o = null;
                        if (col.Item(i, out d) != 0 || d == null) continue;
                        if (d.Activate(ref gm, 23, IntPtr.Zero, out o) == 0 && o != null) all.Add((IAudioMeterInformation)o);
                        dl.Add(d); nl.Add(NameOf(d).Replace("|", "/"));
                    } catch { }
                }
            }
            string want = pref;
            int pick = -1;
            if (want == "@auto") {
                if (HasText(defName, "wave link")) {
                    for (int a = 0; a < nl.Count; a++) { if (nl[a].Length > 0 && !HasText(nl[a], "wave link")) { pick = a; break; } }
                }
            } else if (want.Length > 0) {
                for (int b = 0; b < nl.Count; b++) { if (HasText(nl[b], want)) { pick = b; break; } }
            }
            if (pick >= 0) {
                object ov = null; object om = null;
                if (dl[pick].Activate(ref gv, 23, IntPtr.Zero, out ov) == 0 && ov != null) { selVol = (IAudioEndpointVolume)ov; selName = nl[pick]; }
                if (dl[pick].Activate(ref gm, 23, IntPtr.Zero, out om) == 0 && om != null) sm = (IAudioMeterInformation)om;
            }
        } catch { }
        if (selVol == null) { selVol = defVol; selName = defName; }
        if (sm == null) sm = defMeter;
        if (all.Count == 0 && defMeter != null) all.Add(defMeter);
        lock (Gate) { meters = all; vol = selVol; selMeter = sm; }
        // Annonce la liste des sorties quand elle change (et de temps en temps) : "D|choix|sortie pilotee|sortie 1|sortie 2|..."
        string line = "D|" + pref + "|" + selName + "|" + string.Join("|", nl.ToArray());
        if (line != lastAnnounce || (DateTime.UtcNow - lastAnnounceAt).TotalSeconds > 20.0) {
            lastAnnounce = line; lastAnnounceAt = DateTime.UtcNow;
            Console.Out.WriteLine(line);
        }
    }

    static void AudioLoop() {
        float lastP = -1f, lastV = -1f; bool lastM = false; int tick = 0;
        DateTime lastSend = DateTime.MinValue;
        while (true) {
            try {
                int count0; lock (Gate) { count0 = meters.Count; }
                if (tick % 75 == 0 || count0 == 0) Acquire();
                float p = 0f, v = 0f; bool m = false; int best = -1, n = 0;
                lock (Gate) {
                    if (selOnly && selMeter != null) {
                        float xs;
                        if (selMeter.GetPeakValue(out xs) == 0) { p = xs; best = 0; }
                        n = 1;
                    } else {
                        for (int i = 0; i < meters.Count; i++) {
                            float x;
                            if (meters[i].GetPeakValue(out x) == 0 && x > p) { p = x; best = i; }
                        }
                        n = meters.Count;
                    }
                    if (vol != null) { vol.GetMasterVolumeLevelScalar(out v); vol.GetMute(out m); }
                }
                bool changed = Math.Abs(p - lastP) > 0.004f || Math.Abs(v - lastV) > 0.004f || m != lastM;
                if (changed || (DateTime.UtcNow - lastSend).TotalSeconds > 2.0) {
                    Console.Out.WriteLine("A|" + p.ToString("0.000", CultureInfo.InvariantCulture) + "|" +
                        v.ToString("0.000", CultureInfo.InvariantCulture) + "|" + (m ? "1" : "0") + "|" + n + "|" + best);
                    lastP = p; lastV = v; lastM = m; lastSend = DateTime.UtcNow;
                }
            } catch {
                lock (Gate) { meters = new List<IAudioMeterInformation>(); vol = null; selMeter = null; }
            }
            tick++;
            Thread.Sleep(40);
        }
    }

    static void StdinLoop() {
        try {
            string line;
            while ((line = Console.In.ReadLine()) != null) {
                line = line.Trim();
                if (line.StartsWith("vol ")) {
                    float f;
                    if (float.TryParse(line.Substring(4), NumberStyles.Float, CultureInfo.InvariantCulture, out f)) {
                        if (f < 0f) f = 0f;
                        if (f > 1f) f = 1f;
                        lock (Gate) { if (vol != null) vol.SetMasterVolumeLevelScalar(f, ref Ctx); }
                    }
                } else if (line.StartsWith("dev:")) {
                    pref = line.Substring(4).Trim();
                    lastAnnounce = "";
                    Acquire();
                } else if (line.StartsWith("meter:")) {
                    selOnly = line.Substring(6).Trim() == "sel";
                } else if (line == "devs") {
                    lastAnnounce = "";
                    Acquire();
                } else if (line.StartsWith("mute ")) {
                    bool mm = line.Substring(5).Trim() == "1";
                    lock (Gate) { if (vol != null) vol.SetMute(mm, ref Ctx); }
                } else if (line.Length > 0) {
                    Cmds.Enqueue(line);
                }
            }
        } catch { }
        Environment.Exit(0);
    }

    public static void Start() {
        Thread a = new Thread(AudioLoop); a.IsBackground = true; a.Start();
        Thread b = new Thread(StdinLoop); b.IsBackground = true; b.Start();
    }
}
'@

# Si le code ci-dessus (choix de la sortie audio) ne compile pas, on retombe sur la version d'origine : le volume et Spotify marchent quand meme
try { Add-Type -TypeDefinition $cs -Language CSharp -ErrorAction Stop }
catch {
    $m = ("" + $_.Exception.Message) -replace '[^\x20-\x7E]', ' ' -replace '\|', '/'
    if ($m.Length -gt 300) { $m = $m.Substring(0, 300) }
    $script:legacyMsg = $m
    Add-Type -TypeDefinition $csLegacy -Language CSharp
}
[HaloSys]::Start()
[Console]::Out.WriteLine('R|ready')

# ---------- Lecture en cours (SMTC) ----------
$script:mgr = $null
$script:onlySpotify = $false
$script:lastKey = $null
$script:artSent = $false
$script:artTries = 0
$script:lastJson = ''
$script:smtcErr = ''

try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    [void][Windows.Storage.Streams.IRandomAccessStreamWithContentAndType, Windows.Storage.Streams, ContentType=WindowsRuntime]
} catch { $script:asTask = $null; $script:smtcErr = '' + $_.Exception.Message }

function Await($op, $type) {
    try {
        $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op))
        [void]$t.Wait(4000)
        if ($t.IsCompleted -and -not $t.IsFaulted) { return $t.Result }
    } catch { }
    return $null
}

function Get-Mgr {
    if ($script:mgr) { return $script:mgr }
    if (-not $script:asTask) { return $null }
    $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    return $script:mgr
}

function Pick-Session {
    $m = Get-Mgr
    if (-not $m) { return $null }
    $best = $null; $bestScore = -1
    try {
        foreach ($s in $m.GetSessions()) {
            $isSp = ('' + $s.SourceAppUserModelId) -match 'spotify'
            if ($script:onlySpotify -and -not $isSp) { continue }
            $score = 0
            try { if ($s.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $score += 2 } } catch { }
            if ($isSp) { $score += 1 }
            # Spotify en lecture > autre en lecture > Spotify en pause > autre en pause
            if ($score -gt $bestScore) { $best = $s; $bestScore = $score }
        }
    } catch { }
    if (-not $best -and -not $script:onlySpotify) { try { $best = $m.GetCurrentSession() } catch { } }
    return $best
}

function Session-Names {
    $names = @()
    try { $m = Get-Mgr; if ($m) { foreach ($s in $m.GetSessions()) { $names += ('' + $s.SourceAppUserModelId) } } } catch { }
    return $names
}

function Get-Art($p) {
    try {
        if (-not $p.Thumbnail) { return $null }
        $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentAndType])
        if (-not $st) { return $null }
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
        $ms = New-Object System.IO.MemoryStream
        $net.CopyTo($ms)
        $net.Dispose()
        $st.Dispose()
        if ($ms.Length -lt 100) { return $null }
        return [Convert]::ToBase64String($ms.ToArray())
    } catch { return $null }
}

function To-Ascii($json) {
    return [regex]::Replace($json, '[^\x00-\x7F]', [System.Text.RegularExpressions.MatchEvaluator]{ param($m) ('\u{0:x4}' -f [int][char]$m.Value) })
}

function Num($v) { return [string]::Format([System.Globalization.CultureInfo]::InvariantCulture, '{0:0.0}', [double]$v) }

# Secours : le titre de la fenetre Spotify ("Artiste - Titre"), meme cachee dans la zone de notification
function Spotify-Fallback {
    try {
        $t = [HaloSys]::SpotifyTitle()
        if ($t) {
            $i = $t.IndexOf(' - ')
            if ($i -gt 0) {
                $artist = $t.Substring(0, $i); $title = $t.Substring($i + 3)
                $o = [ordered]@{ on = $true; fallback = $true; app = 'Spotify.exe'; key = ($title + '|' + $artist); title = $title; artist = $artist; album = ''; playing = $true; pos = '0.0'; dur = '0.0' }
                return (To-Ascii ($o | ConvertTo-Json -Compress))
            }
        }
    } catch { }
    return $null
}

function Fail-Json($msg, $names) {
    $arr = @()
    foreach ($n in @($names)) { if ($n) { $arr += $n } }   # une liste vide devient $null en PowerShell : on la filtre
    $o = [ordered]@{ on = $false; err = $msg; sessions = $arr }
    return (To-Ascii ($o | ConvertTo-Json -Compress))
}

function Poll-Media {
    $script:cur = $null
    if (-not $script:asTask) {
        $fb = Spotify-Fallback; if ($fb) { return $fb }
        return (Fail-Json ('smtc-indisponible ' + $script:smtcErr) @())
    }
    if (-not (Get-Mgr)) {
        $fb = Spotify-Fallback; if ($fb) { return $fb }
        return (Fail-Json 'smtc-gestionnaire-introuvable' @())
    }
    $s = Pick-Session
    if (-not $s) {
        $fb = Spotify-Fallback; if ($fb) { return $fb }
        return (Fail-Json '' (Session-Names))
    }
    $script:cur = $s
    $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    if (-not $p) { return (Fail-Json 'lecture-des-infos-impossible' (Session-Names)) }
    $pb = $s.GetPlaybackInfo()
    $tl = $s.GetTimelineProperties()
    $key = '' + $p.Title + '|' + $p.Artist + '|' + $p.AlbumTitle
    if ($key -ne $script:lastKey) { $script:lastKey = $key; $script:artSent = $false; $script:artTries = 0 }

    $playing = $false
    if ($pb -and $pb.PlaybackStatus) { $playing = ($pb.PlaybackStatus.ToString() -eq 'Playing') }
    $pos = 0.0; $dur = 0.0
    if ($tl) {
        $pos = $tl.Position.TotalSeconds
        $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
        if ($playing) {
            $age = ([DateTimeOffset]::UtcNow - $tl.LastUpdatedTime).TotalSeconds
            if ($age -gt 0 -and $age -lt 7200) { $pos = $pos + $age }
        }
        if ($dur -gt 0 -and $pos -gt $dur) { $pos = $dur }
        if ($pos -lt 0) { $pos = 0.0 }
    }

    # pos / dur en texte invariant : le cote JS fait Number(...)
    $o = [ordered]@{
        on = $true
        app = '' + $s.SourceAppUserModelId
        key = $key
        title = '' + $p.Title
        artist = '' + $p.Artist
        album = '' + $p.AlbumTitle
        playing = $playing
        pos = (Num $pos)
        dur = (Num $dur)
    }
    if (-not $script:artSent -and $script:artTries -lt 25) {
        $script:artTries++
        $a = Get-Art $p
        if ($a) { $o['art'] = $a; $script:artSent = $true }
        elseif ($script:artTries -ge 25) { $o['art'] = ''; $script:artSent = $true }
    }
    return (To-Ascii ($o | ConvertTo-Json -Compress))
}

function Handle-Cmd($c) {
    $parts = $c.Split(' ')
    try {
        $s = $script:cur
        if (-not $s -and $parts[0] -ne 'only' -and $parts[0] -ne 'resend') { $s = Pick-Session }
        switch ($parts[0]) {
            'toggle' { if ($s) { [void]$s.TryTogglePlayPauseAsync() } else { [HaloSys]::Key(0xB3) } }
            'next'   { if ($s) { [void]$s.TrySkipNextAsync() } else { [HaloSys]::Key(0xB0) } }
            'prev'   { if ($s) { [void]$s.TrySkipPreviousAsync() } else { [HaloSys]::Key(0xB1) } }
            'seek'   {
                if ($s -and $parts.Length -gt 1) {
                    $sec = [double]::Parse($parts[1], [System.Globalization.CultureInfo]::InvariantCulture)
                    [void]$s.TryChangePlaybackPositionAsync([long]($sec * 10000000))
                }
            }
            'only'   { $script:onlySpotify = ($parts.Length -gt 1 -and $parts[1] -eq '1') }
            'resend' { $script:artSent = $false; $script:artTries = 0 }
        }
    } catch { }
}

$script:cur = $null
$tick = 0
while ($true) {
    $c = [HaloSys]::Next()
    while ($c) { Handle-Cmd $c; $c = [HaloSys]::Next() }
    # Version d'origine du demon audio (le choix de sortie n'a pas pu etre compile) : on le signale a l'interface, avec la cause
    if ($script:legacyMsg -ne $null -and ($tick % 8) -eq 0) { [Console]::Out.WriteLine('D|!legacy|' + $script:legacyMsg) }
    try {
        $json = Poll-Media
        # n'envoie que les changements (hors position), ou un battement toutes les ~1,6 s
        if ($json -ne $script:lastJson -or ($tick % 4) -eq 0) {
            [Console]::Out.WriteLine('M|' + $json)
            $script:lastJson = $json
        }
    } catch {
        [Console]::Out.WriteLine('M|{"on":false,"err":"boucle"}')
    }
    $tick++
    Start-Sleep -Milliseconds 400
}
