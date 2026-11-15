# Halo - diagnostic son + Spotify (ASCII uniquement). Lance-le avec diagnostic-halo.bat (double-clic).
# Le resultat est aussi enregistre dans halo-diagnostic.txt (a cote de ce fichier) : colle-le dans la conversation.
$ErrorActionPreference = 'Continue'
$out = Join-Path $PSScriptRoot 'halo-diagnostic.txt'
Start-Transcript -Path $out -Force | Out-Null

$cs = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation { int GetPeakValue(out float peak); }

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
    int Activate(ref Guid id, int clsCtx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IntPtr ps);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}

[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceCollection { int GetCount(out uint n); int Item(uint i, out IMMDevice dev); }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devs);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice dev);
}

[ComImport, Guid("BCDE0395-E52F-44F6-AF70-B3BC1BAAD3E2")]
public class MMDeviceEnumeratorComObject { }

public static class HaloDiag {
    public static string[] Probe(int ms) {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice def; string defId = "";
        if (en.GetDefaultAudioEndpoint(0, 1, out def) == 0 && def != null) def.GetId(out defId);
        IMMDeviceCollection col; en.EnumAudioEndpoints(0, 1, out col);
        uint n; col.GetCount(out n);
        List<string> ids = new List<string>(); List<IAudioMeterInformation> meters = new List<IAudioMeterInformation>();
        Guid gm = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
        for (uint i = 0; i < n; i++) {
            IMMDevice d; object o = null; string id = "";
            if (col.Item(i, out d) != 0 || d == null) continue;
            d.GetId(out id);
            if (d.Activate(ref gm, 23, IntPtr.Zero, out o) == 0 && o != null) { ids.Add(id); meters.Add((IAudioMeterInformation)o); }
        }
        float[] max = new float[meters.Count];
        DateTime end = DateTime.UtcNow.AddMilliseconds(ms);
        while (DateTime.UtcNow < end) {
            for (int i = 0; i < meters.Count; i++) { float p; if (meters[i].GetPeakValue(out p) == 0 && p > max[i]) max[i] = p; }
            Thread.Sleep(40);
        }
        string[] res = new string[ids.Count];
        for (int i = 0; i < ids.Count; i++) res[i] = ids[i] + "|" + max[i].ToString("0.000", CultureInfo.InvariantCulture) + "|" + (ids[i] == defId ? "1" : "0");
        return res;
    }
}
'@

Write-Host '=== Halo : diagnostic ===' -ForegroundColor Cyan
Write-Host ('Date        : ' + (Get-Date))
Write-Host ('PowerShell  : ' + $PSVersionTable.PSVersion + '  (' + [System.Threading.Thread]::CurrentThread.GetApartmentState() + ')')
Write-Host ('Windows     : ' + [Environment]::OSVersion.VersionString)
Write-Host ('Culture     : ' + (Get-Culture).Name)

# ---- 1. Sorties audio ----
Write-Host ''
Write-Host '--- 1. NIVEAU SONORE PAR SORTIE AUDIO ---' -ForegroundColor Cyan
try {
    Add-Type -TypeDefinition $cs -Language CSharp
    Write-Host '>>> LANCE UN SON DANS SPOTIFY MAINTENANT (mesure pendant 8 secondes)...' -ForegroundColor Yellow
    $rows = [HaloDiag]::Probe(8000)
    if (-not $rows -or $rows.Count -eq 0) { Write-Host 'Aucune sortie audio active trouvee.' }
    foreach ($r in $rows) {
        $p = $r.Split('|')
        $guid = ($p[0] -split '\.')[-1]
        $name = ''
        try {
            $key = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\MMDevices\Audio\Render\' + $guid + '\Properties'
            $props = Get-ItemProperty -Path $key
            $desc = $props.'{a45c254e-df1c-4efd-8020-67d146a850e0},2'
            $itf  = $props.'{b3f8fa53-0004-438e-9003-51a46e139bfc},6'
            $name = ('' + $desc + ' (' + $itf + ')')
        } catch { $name = $p[0] }
        $def = ''
        if ($p[2] -eq '1') { $def = '  <-- sortie PAR DEFAUT de Windows' }
        Write-Host ('  pic max = ' + $p[1] + '   ' + $name + $def)
    }
    Write-Host '  (pic > 0 = du son passe par cette sortie ; si seule une sortie NON par defaut bouge, c''est la cause)'
} catch { Write-Host ('ERREUR section audio : ' + $_.Exception.Message) -ForegroundColor Red }

# ---- 2. Lecture en cours vue par Windows (SMTC) ----
Write-Host ''
Write-Host '--- 2. LECTURE EN COURS VUE PAR WINDOWS (SMTC) ---' -ForegroundColor Cyan
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $t = $asTask.MakeGenericMethod($mgrType).Invoke($null, @($mgrType::RequestAsync()))
    [void]$t.Wait(8000)
    if (-not $t.IsCompleted) { Write-Host 'Le gestionnaire de medias Windows ne repond pas (delai depasse).' -ForegroundColor Red }
    else {
        $mgr = $t.Result
        $sessions = @($mgr.GetSessions())
        Write-Host ('Sessions media detectees : ' + $sessions.Count)
        foreach ($s in $sessions) {
            $pt = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
            $tp = $asTask.MakeGenericMethod($pt).Invoke($null, @($s.TryGetMediaPropertiesAsync()))
            [void]$tp.Wait(5000)
            $title = ''; $artist = ''
            if ($tp.IsCompleted -and -not $tp.IsFaulted) { $title = $tp.Result.Title; $artist = $tp.Result.Artist }
            $status = ''
            try { $status = $s.GetPlaybackInfo().PlaybackStatus.ToString() } catch { }
            Write-Host ('  - ' + $s.SourceAppUserModelId + '  [' + $status + ']  ' + $artist + ' - ' + $title)
        }
        if ($sessions.Count -eq 0) { Write-Host '  (aucune : Spotify ne publie pas sa lecture a Windows)' }
    }
} catch { Write-Host ('ERREUR section SMTC : ' + $_.Exception.Message) -ForegroundColor Red }

# ---- 3. Processus Spotify ----
Write-Host ''
Write-Host '--- 3. PROCESSUS SPOTIFY ---' -ForegroundColor Cyan
try {
    $ps = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'spotify' })
    if ($ps.Count -eq 0) { Write-Host '  Spotify n''est pas lance.' }
    foreach ($p in $ps) { Write-Host ('  ' + $p.ProcessName + '  pid=' + $p.Id + '  titre de fenetre="' + $p.MainWindowTitle + '"') }
    Write-Host ('  Edition : ' + $(if (Get-AppxPackage -Name 'SpotifyAB.SpotifyMusic' -ErrorAction SilentlyContinue) { 'Microsoft Store' } else { 'installateur classique (ou web)' }))
} catch { Write-Host ('ERREUR section Spotify : ' + $_.Exception.Message) -ForegroundColor Red }

# ---- 4. Logiciels audio courants ----
Write-Host ''
Write-Host '--- 4. LOGICIELS AUDIO DETECTES ---' -ForegroundColor Cyan
$known = 'voicemeeter|sonar|steelseries|nahimic|sonic|fxsound|equalizer|eapo|peace|realtek|dolby|waves|asio|vb-?audio|elgato|wavelink|goxlr|audiodg'
$hit = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $known } | Select-Object -ExpandProperty ProcessName -Unique)
if ($hit.Count) { Write-Host ('  ' + ($hit -join ', ')) } else { Write-Host '  (aucun connu)' }

Write-Host ''
Write-Host ('Fin. Resultat enregistre dans : ' + $out) -ForegroundColor Green
Stop-Transcript | Out-Null
