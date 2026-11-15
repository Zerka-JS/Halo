# Halo - extraction des icones d'applications (ASCII uniquement : PowerShell 5.1 lit ce fichier en ANSI)
# Entree : -In <fichier texte UTF-8, une cible par ligne> (ex. "shell:AppsFolder\<AppID>" ou chemin d'un .lnk)
# Sortie : une ligne par cible, "<numero de ligne>\t<PNG 64x64 en base64>" ; base64 vide si pas d'icone.
param([string]$In)
$ErrorActionPreference = 'SilentlyContinue'
[System.Threading.Thread]::CurrentThread.CurrentCulture = [System.Globalization.CultureInfo]::InvariantCulture

$cs = @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class HaloIcons {
    [StructLayout(LayoutKind.Sequential)] struct SIZE { public int cx; public int cy; }

    [ComImport, Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IShellItemImageFactory {
        [PreserveSig] int GetImage(SIZE size, int flags, out IntPtr phbm);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct BITMAP { public int bmType, bmWidth, bmHeight, bmWidthBytes; public short bmPlanes, bmBitsPixel; public IntPtr bmBits; }

    [StructLayout(LayoutKind.Sequential)]
    struct BMIH { public int biSize, biWidth, biHeight; public short biPlanes, biBitCount; public int biCompression, biSizeImage, biXPels, biYPels, biClrUsed, biClrImportant; }

    [StructLayout(LayoutKind.Sequential)]
    struct DIBSECTION { public BITMAP dsBm; public BMIH dsBmih; public int f0, f1, f2; public IntPtr hSection; public int dsOffset; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHCreateItemFromParsingName(string path, IntPtr pbc, ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IShellItemImageFactory f);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr h);
    [DllImport("gdi32.dll")] static extern int GetObject(IntPtr h, int cb, ref DIBSECTION o);

    // Icone d'une cible du menu Demarrer (application classique ou du Store) -> PNG carre de "px" pixels
    public static string Get(string target, int px) {
        IntPtr hbm = IntPtr.Zero;
        try {
            Guid iid = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");
            IShellItemImageFactory f;
            SHCreateItemFromParsingName(target, IntPtr.Zero, ref iid, out f);
            if (f == null) return "";
            SIZE sz; sz.cx = px; sz.cy = px;
            // 0x4 = ICONONLY (icone, pas de miniature) ; 0x1 = une taille plus grande est acceptee
            if (f.GetImage(sz, 0x4 | 0x1, out hbm) != 0 || hbm == IntPtr.Zero) return "";

            DIBSECTION ds = new DIBSECTION();
            int got = GetObject(hbm, Marshal.SizeOf(typeof(DIBSECTION)), ref ds);
            Bitmap src = null;
            bool owns = false;
            if (got > 0 && ds.dsBm.bmBitsPixel == 32 && ds.dsBm.bmBits != IntPtr.Zero) {
                int w = ds.dsBm.bmWidth, h = ds.dsBm.bmHeight, stride = ds.dsBm.bmWidthBytes;
                byte[] buf = new byte[stride * h];
                Marshal.Copy(ds.dsBm.bmBits, buf, 0, buf.Length);
                bool alpha = false;
                for (int i = 3; i < buf.Length; i += 4) { if (buf[i] != 0) { alpha = true; break; } }
                if (alpha) {
                    // Les pixels sont lus dans l'ordre memoire : si le DIB est "bas en haut", on retourne l'image
                    GCHandle gh = GCHandle.Alloc(buf, GCHandleType.Pinned);
                    try {
                        using (Bitmap tmp = new Bitmap(w, h, stride, PixelFormat.Format32bppPArgb, gh.AddrOfPinnedObject())) {
                            src = new Bitmap(w, h, PixelFormat.Format32bppArgb);
                            using (Graphics g = Graphics.FromImage(src)) { g.Clear(Color.Transparent); g.DrawImage(tmp, 0, 0, w, h); }
                        }
                    } finally { gh.Free(); }
                    if (ds.dsBmih.biHeight > 0) src.RotateFlip(RotateFlipType.RotateNoneFlipY);
                    owns = true;
                }
            }
            if (src == null) { src = Image.FromHbitmap(hbm); owns = true; }   // plan B : sans transparence

            using (Bitmap outb = new Bitmap(px, px, PixelFormat.Format32bppArgb)) {
                using (Graphics g = Graphics.FromImage(outb)) {
                    g.Clear(Color.Transparent);
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                    g.DrawImage(src, 0, 0, px, px);
                }
                if (owns) src.Dispose();
                using (MemoryStream ms = new MemoryStream()) {
                    outb.Save(ms, ImageFormat.Png);
                    return Convert.ToBase64String(ms.ToArray());
                }
            }
        } catch { return ""; }
        finally { if (hbm != IntPtr.Zero) DeleteObject(hbm); }
    }
}
'@

try {
    Add-Type -AssemblyName System.Drawing
    Add-Type -TypeDefinition $cs -Language CSharp -ReferencedAssemblies System.Drawing
} catch {
    [Console]::Error.WriteLine("icons: " + $_.Exception.Message)
    exit 1
}

$out = [Console]::Out
$lines = [System.IO.File]::ReadAllLines($In, [System.Text.Encoding]::UTF8)
for ($i = 0; $i -lt $lines.Length; $i++) {
    $t = $lines[$i].Trim()
    $b = ''
    if ($t) { $b = [HaloIcons]::Get($t, 64) }
    $out.WriteLine("$i`t$b")
    $out.Flush()
}
