use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State};

#[cfg(target_os = "linux")]
mod media_linux;
mod fullscreen;

// ---------- Exécution PowerShell silencieuse (Windows) ----------
#[cfg(windows)]
fn ps(script: &str, env: Option<(&str, &str)>) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let full = format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ErrorActionPreference='SilentlyContinue';{script}");
    let mut c = std::process::Command::new("powershell");
    c.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", &full])
        .creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    if let Some((k, v)) = env { c.env(k, v); }
    let out = c.output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}


// ---------- Mode "shell" : barre Windows masquée + zone de travail réduite ----------
static SHELL: AtomicBool = AtomicBool::new(false);
static ORIG: OnceLock<(i32, i32, i32, i32)> = OnceLock::new(); // zone de travail d'origine
static DOCK: Mutex<(f64, f64)> = Mutex::new((720.0, 150.0));
static DOCK_BAR: Mutex<f64> = Mutex::new(90.0); // hauteur (px logiques) occupée par la barre du dock depuis le bas de l'écran

#[cfg(windows)]
fn shell_apply(hide: bool, a: (i32, i32, i32, i32)) {
    let show = if hide { 0 } else { 5 };
    let def = "Add-Type -Namespace H -Name N -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr FindWindow(string c,string n); [DllImport(\"user32.dll\")] public static extern IntPtr FindWindowEx(IntPtr p,IntPtr a,string c,string n); [DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h,int c); [DllImport(\"user32.dll\")] public static extern bool SystemParametersInfo(int a,int b,int[] r,int c);';";
    let script = format!("{def} $h=[H.N]::FindWindow('Shell_TrayWnd',$null); [H.N]::ShowWindow($h,{show})|Out-Null; $s=[IntPtr]::Zero; while(($s=[H.N]::FindWindowEx([IntPtr]::Zero,$s,'Shell_SecondaryTrayWnd',$null)) -ne [IntPtr]::Zero){{ [H.N]::ShowWindow($s,{show})|Out-Null }}; [H.N]::SystemParametersInfo(47,0,[int[]]@({},{},{},{}),3)|Out-Null", a.0, a.1, a.2, a.3);
    let _ = ps(&script, None);
}

/// Zone de travail que Halo réserve sur l'écran principal : entre la barre du haut (32 px) et le dock (96 px)
#[cfg_attr(not(windows), allow(dead_code))]
fn reserved_area(g: &Geo) -> (i32, i32, i32, i32) {
    (g.x, g.y + (32.0 * g.s) as i32, g.x + g.w as i32, g.y + g.h as i32 - (96.0 * g.s) as i32)
}
#[cfg_attr(not(windows), allow(dead_code))]
fn full_area(g: &Geo) -> (i32, i32, i32, i32) { (g.x, g.y, g.x + g.w as i32, g.y + g.h as i32) }

/// Vrai tant que les barres de l'écran principal sont masquées (plein écran / fenêtre agrandie) : la zone de travail est alors
/// l'écran entier, pour que les fenêtres agrandies le remplissent vraiment (sans bandes vides en haut et en bas).
#[cfg_attr(not(windows), allow(dead_code))]
static EXPANDED: AtomicBool = AtomicBool::new(false);
#[cfg_attr(not(windows), allow(dead_code))]
static WORK_AREA: Mutex<()> = Mutex::new(());

fn apply_shell(app: &AppHandle, enabled: bool) {
    SHELL.store(enabled, Ordering::Relaxed);
    #[cfg(windows)]
    {
        if let (Some(g), Some(o)) = (geo(app), ORIG.get()) {
            let area = if enabled {
                if EXPANDED.load(Ordering::Relaxed) { full_area(&g) } else { reserved_area(&g) }
            } else { *o };
            shell_apply(enabled, area);
        }
    }
    let (w, h) = *DOCK.lock().unwrap();
    place_dock(app, w, h);
}

fn shell_restore() {
    #[cfg(windows)]
    {
        if SHELL.load(Ordering::Relaxed) {
            if let Some(o) = ORIG.get() { shell_apply(false, *o); }
        }
    }
}

#[tauri::command]
async fn set_shell_mode(app: AppHandle, enabled: bool) { apply_shell(&app, enabled); }

// ---------- Géométrie des fenêtres : une copie bureau / barre / dock sur CHAQUE écran ----------
// Fenêtres de l'écran principal : "desktop", "topbar", "dock" (déclarées dans tauri.conf.json).
// Autres écrans : "desktop-1", "topbar-1", "dock-1", "desktop-2"… (créées au démarrage et à chaque branchement d'écran).
struct Geo { x: i32, y: i32, w: u32, h: u32, s: f64, wa_bottom: i32 }

macro_rules! geo_of {
    ($m:expr) => {{
        let m = &$m;
        let wa = m.work_area();
        Geo {
            x: m.position().x, y: m.position().y, w: m.size().width, h: m.size().height,
            s: m.scale_factor(), wa_bottom: wa.position.y + wa.size.height as i32,
        }
    }};
}

/// Écrans : [0] = écran principal, puis les autres de gauche à droite
fn layout(app: &AppHandle) -> Vec<Geo> {
    let mut all: Vec<Geo> = Vec::new();
    if let Ok(list) = app.available_monitors() {
        for m in &list { all.push(geo_of!(m)); }
    }
    if all.is_empty() {
        if let Ok(Some(m)) = app.primary_monitor() { all.push(geo_of!(m)); }
    }
    if all.is_empty() { return all; }
    let pp = app.primary_monitor().ok().flatten().map(|m| (m.position().x, m.position().y));
    let pi = pp.and_then(|p| all.iter().position(|g| (g.x, g.y) == p)).unwrap_or(0);
    let prim = all.remove(pi);
    all.sort_by_key(|g| (g.x, g.y));
    all.insert(0, prim);
    all
}

/// Écran principal
fn geo(app: &AppHandle) -> Option<Geo> { layout(app).into_iter().next() }

/// Écran d'une fenêtre d'après son nom : "dock" → principal, "dock-2" → 2e écran secondaire
fn geo_for(app: &AppHandle, label: &str) -> Option<Geo> {
    let idx = match label.rsplit_once('-') { Some((_, k)) => k.parse::<usize>().ok()?, None => 0 };
    layout(app).into_iter().nth(idx)
}

const SCREEN_WINDOWS: [&str; 3] = ["desktop", "topbar", "dock"];

/// Toutes les fenêtres d'un type, tous écrans confondus
fn windows_of(app: &AppHandle, base: &str) -> Vec<tauri::WebviewWindow> {
    let prefix = format!("{base}-");
    app.webview_windows().into_iter()
        .filter(|(l, _)| l.as_str() == base || l.starts_with(&prefix))
        .map(|(_, w)| w)
        .collect()
}


// ---------- Placement exact d'une fenêtre (corrige le débordement sur l'écran voisin) ----------
// Deux garanties, sous Windows :
//  1. la fenêtre est placée puis MESURÉE (DwmGetWindowAttribute / GetWindowRect) et l'écart est corrigé (marges invisibles, mise à
//     l'échelle DPI entre deux écrans…) ;
//  2. quoi qu'il arrive, la fenêtre est ensuite DÉCOUPÉE (SetWindowRgn) au rectangle demandé : plus un seul pixel ne peut
//     s'afficher (ni recevoir un clic) en dehors, donc plus de fond d'écran qui dépasse sur l'écran voisin.
#[cfg(windows)]
mod winpos {
    use std::ffi::c_void;
    use std::sync::Mutex;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Rect { left: i32, top: i32, right: i32, bottom: i32 }

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(hwnd: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn SystemParametersInfoW(action: u32, param: u32, pv: *mut c_void, flags: u32) -> i32;
        fn GetWindowRect(hwnd: isize, r: *mut Rect) -> i32;
        fn SetWindowRgn(hwnd: isize, rgn: isize, redraw: i32) -> i32;
        fn SetWindowLongW(hwnd: isize, index: i32, value: i32) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn GetWindowLongW(hwnd: isize, index: i32) -> i32;
        fn ShowWindow(hwnd: isize, cmd: i32) -> i32;
        fn FindWindowW(class: *const u16, title: *const u16) -> isize;
        fn FindWindowExW(parent: isize, after: isize, class: *const u16, title: *const u16) -> isize;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(l: i32, t: i32, r: i32, b: i32) -> isize;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(hwnd: isize, attr: u32, out: *mut c_void, size: u32) -> i32;
        fn DwmSetWindowAttribute(hwnd: isize, attr: u32, val: *const c_void, size: u32) -> i32;
    }
    #[link(name = "comctl32")]
    extern "system" {
        fn SetWindowSubclass(hwnd: isize, proc_: SubProc, id: usize, data: usize) -> i32;
        fn GetWindowSubclass(hwnd: isize, proc_: SubProc, id: usize, data: *mut usize) -> i32;
        fn DefSubclassProc(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    const SWP_NOZORDER: u32 = 0x0004;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const DWMWA_EXTENDED_FRAME_BOUNDS: u32 = 9;

    /// Retire de la fenêtre tout cadre Windows (barre de titre, bordure de redimensionnement, boutons).
    /// Halo dessine lui-même ses fenêtres : ces styles ne servent à rien, provoquent des marges invisibles qui font déborder la fenêtre
    /// sur l'écran voisin, et font réapparaître une barre de titre classique dès qu'une fenêtre est découpée (SetWindowRgn).
    // WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX
    const FRAME: u32 = 0x00C0_0000 | 0x0004_0000 | 0x0008_0000 | 0x0002_0000 | 0x0001_0000;
    // WS_EX_DLGMODALFRAME | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE | WS_EX_STATICEDGE
    const FRAME_EX: u32 = 0x0000_0001 | 0x0000_0100 | 0x0000_0200 | 0x0002_0000;
    // WS_POPUP : fenêtre « nue ». Sans WS_POPUP, Windows traite la fenêtre comme une fenêtre classique (WS_OVERLAPPED) et peut lui
    // redessiner une barre de titre ; avec WS_POPUP et sans WS_CAPTION / WS_BORDER, il n'y a plus aucun cadre à dessiner.
    const WS_POPUP: u32 = 0x8000_0000;
    const GWL_STYLE: i32 = -16;
    const GWL_EXSTYLE: i32 = -20;

    /// Fixe la zone de travail de l'écran principal (SPI_SETWORKAREA) : Windows redimensionne alors les fenêtres agrandies.
    /// Appel natif (et non PowerShell) : il faut qu'il soit instantané quand une fenêtre est agrandie.
    pub fn set_work_area(a: (i32, i32, i32, i32)) {
        let mut r = Rect { left: a.0, top: a.1, right: a.2, bottom: a.3 };
        // 0x002F = SPI_SETWORKAREA ; 3 = SPIF_UPDATEINIFILE | SPIF_SENDCHANGE (comme le script PowerShell de apply_shell)
        unsafe { SystemParametersInfoW(0x002F, 0, &mut r as *mut Rect as *mut c_void, 3); }
    }

    pub fn strip_frame(h: isize) {
        unsafe {
            let style = GetWindowLongW(h, GWL_STYLE) as u32;
            let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
            let (new_style, new_ex) = ((style & !FRAME) | WS_POPUP, ex & !FRAME_EX);
            if new_style == style && new_ex == ex { return; }
            SetWindowLongW(h, GWL_STYLE, new_style as i32);
            SetWindowLongW(h, GWL_EXSTYLE, new_ex as i32);
            SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }

    /// Barre des tâches Windows (écran principal et écrans secondaires) : la recache si Windows l'a réaffichée
    pub fn hide_taskbars() {
        let wide = |s: &str| -> Vec<u16> { s.encode_utf16().chain(std::iter::once(0)).collect() };
        unsafe {
            let main = wide("Shell_TrayWnd");
            let h = FindWindowW(main.as_ptr(), std::ptr::null());
            if h != 0 && IsWindowVisible(h) != 0 { ShowWindow(h, 0); } // SW_HIDE
            let second = wide("Shell_SecondaryTrayWnd");
            let mut s = 0isize;
            loop {
                s = FindWindowExW(0, s, second.as_ptr(), std::ptr::null());
                if s == 0 { break; }
                if IsWindowVisible(s) != 0 { ShowWindow(s, 0); }
            }
        }
    }

    // ----- Garde-fou « jamais de barre de titre » -----
    // Retirer les styles ne suffit pas : la bibliothèque de fenêtres (tao) les remet parfois (affichage, masquage, changement de
    // taille…) et la barre « Halo Barre » / « Halo Dock » réapparaît. On sous-classe donc les fenêtres de Halo :
    //  - WM_NCCALCSIZE → 0 : la zone non cliente (barre de titre, bordures) fait 0 pixel, quels que soient les styles de la fenêtre ;
    //  - WM_NCPAINT → 0 : rien n'est dessiné autour de la fenêtre ;
    //  - WM_STYLECHANGING : si quelqu'un tente de remettre un style de cadre, il est retiré avant d'être appliqué.
    type SubProc = unsafe extern "system" fn(isize, u32, usize, isize, usize, usize) -> isize;
    const SUBCLASS_ID: usize = 0x4841_4C4F; // "HALO"

    unsafe extern "system" fn frame_proc(h: isize, msg: u32, wp: usize, lp: isize, _id: usize, _data: usize) -> isize {
        const WM_STYLECHANGING: u32 = 0x007C;
        const WM_NCCALCSIZE: u32 = 0x0083;
        const WM_NCPAINT: u32 = 0x0085;
        const WM_NCACTIVATE: u32 = 0x0086;
        const WM_NCUAHDRAWCAPTION: u32 = 0x00AE; // messages non documentés par lesquels Windows peint la barre de titre
        const WM_NCUAHDRAWFRAME: u32 = 0x00AF;
        match msg {
            WM_NCCALCSIZE | WM_NCPAINT | WM_NCUAHDRAWCAPTION | WM_NCUAHDRAWFRAME => return 0,
            // lParam = -1 : « ne repeins pas la barre de titre » (sinon l'activation / désactivation de la fenêtre la redessine)
            WM_NCACTIVATE => return DefSubclassProc(h, msg, wp, -1),
            WM_STYLECHANGING if lp != 0 => {
                // lp pointe sur un STYLESTRUCT { styleOld: u32, styleNew: u32 } ; wp = GWL_STYLE ou GWL_EXSTYLE
                let s = &mut *(lp as *mut [u32; 2]);
                match wp as i32 {
                    GWL_STYLE => s[1] = (s[1] & !FRAME) | WS_POPUP,
                    GWL_EXSTYLE => s[1] &= !FRAME_EX,
                    _ => {}
                }
            }
            _ => {}
        }
        DefSubclassProc(h, msg, wp, lp)
    }

    /// Installe le garde-fou sur une fenêtre (sans effet si déjà installé). À appeler depuis le thread principal :
    /// Windows n'autorise le sous-classement que depuis le thread qui a créé la fenêtre.
    pub fn guard(h: isize) {
        unsafe {
            let mut data = 0usize;
            if GetWindowSubclass(h, frame_proc, SUBCLASS_ID, &mut data) != 0 { return; }
            if SetWindowSubclass(h, frame_proc, SUBCLASS_ID, 0) == 0 { return; }
            // DWMWA_NCRENDERING_POLICY (2) = DWMNCRP_DISABLED (1) : le gestionnaire de fenêtres ne dessine plus aucun cadre
            let off: i32 = 1;
            DwmSetWindowAttribute(h, 2, &off as *const i32 as *const c_void, 4);
            strip_frame(h);
            // Force Windows à recalculer tout de suite la zone non cliente (qui vaut désormais 0)
            SetWindowPos(h, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }

    /// Dernière découpe appliquée à chaque fenêtre (évite de la refaire, donc de redessiner, pour rien)
    static CLIPS: Mutex<Vec<(isize, [i32; 8])>> = Mutex::new(Vec::new());

    fn window_rect(h: isize) -> Option<Rect> {
        let mut r = Rect::default();
        if unsafe { GetWindowRect(h, &mut r) } != 0 { Some(r) } else { None }
    }

    /// Rectangle réellement visible (sans les marges invisibles). Le résultat de DWM n'est cru que s'il est cohérent
    /// avec le rectangle de la fenêtre (une fenêtre pas encore affichée peut renvoyer n'importe quoi).
    fn visible_rect(h: isize) -> Option<Rect> {
        let wr = window_rect(h)?;
        let mut d = Rect::default();
        let ok = unsafe { DwmGetWindowAttribute(h, DWMWA_EXTENDED_FRAME_BOUNDS, &mut d as *mut Rect as *mut c_void, std::mem::size_of::<Rect>() as u32) } == 0;
        let sane = ok && d.right > d.left && d.bottom > d.top
            && (d.left - wr.left).abs() <= 48 && (wr.right - d.right).abs() <= 48
            && (d.top - wr.top).abs() <= 48 && (wr.bottom - d.bottom).abs() <= 48;
        Some(if sane { d } else { wr })
    }

    /// Découpe la fenêtre au rectangle (x, y, w, h) exprimé en coordonnées écran
    fn clip(h: isize, x: i32, y: i32, w: i32, hgt: i32) {
        let Some(wr) = window_rect(h) else { return };
        let key = [x, y, w, hgt, wr.left, wr.top, wr.right, wr.bottom];
        {
            let Ok(mut c) = CLIPS.lock() else { return };
            if let Some(e) = c.iter_mut().find(|e| e.0 == h) {
                if e.1 == key { return; }
                e.1 = key;
            } else { c.push((h, key)); }
        }
        // Les coordonnées d'une région sont relatives au coin haut-gauche de la fenêtre ; le système devient propriétaire de la région
        let rgn = unsafe { CreateRectRgn(x - wr.left, y - wr.top, x + w - wr.left, y + hgt - wr.top) };
        if rgn != 0 { unsafe { SetWindowRgn(h, rgn, 1); } }
    }

    pub fn fit(h: isize, x: i32, y: i32, w: i32, hgt: i32) -> bool {
        strip_frame(h); // toujours AVANT de mesurer et de découper
        let matches = |v: Rect| v.left == x && v.top == y && v.right - v.left == w && v.bottom - v.top == hgt;
        // Déjà au bon endroit : on ne touche à rien (cet appel est refait régulièrement par la surveillance des écrans)
        if let Some(v) = visible_rect(h) { if matches(v) { clip(h, x, y, w, hgt); return true; } }
        let (mut rx, mut ry, mut rw, mut rh) = (x, y, w, hgt);
        for _ in 0..4 {
            if unsafe { SetWindowPos(h, 0, rx, ry, rw, rh, SWP_NOZORDER | SWP_NOACTIVATE) } == 0 { return false; }
            let Some(v) = visible_rect(h) else { break };
            if matches(v) { break; }
            // L'écart mesuré est reporté sur la demande suivante
            rx -= v.left - x; ry -= v.top - y;
            rw -= (v.right - v.left) - w; rh -= (v.bottom - v.top) - hgt;
            if rw < 1 || rh < 1 { break; }
        }
        clip(h, x, y, w, hgt);
        true
    }
}

// ---------- Touche Windows désactivée ----------
// Avec la barre des tâches masquée, la touche Windows (menu Démarrer) fait réapparaître la barre Windows par-dessus Halo.
// Un hook clavier global (WH_KEYBOARD_LL) avale donc les touches Windows gauche et droite (et, par conséquent, tous les
// raccourcis Win+…). Le hook vit tant que Halo tourne : il disparaît tout seul quand on quitte Halo (la touche Windows revient).
#[cfg(windows)]
mod winkey {
    #[repr(C)]
    struct KbdLlHook { vk: u32, scan: u32, flags: u32, time: u32, extra: usize }

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Pt { x: i32, y: i32 }

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct Msg { hwnd: isize, message: u32, wparam: usize, lparam: isize, time: u32, pt: Pt }

    type HookProc = unsafe extern "system" fn(i32, usize, isize) -> isize;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowsHookExW(id: i32, f: HookProc, module: isize, thread: u32) -> isize;
        fn CallNextHookEx(hook: isize, code: i32, wparam: usize, lparam: isize) -> isize;
        fn UnhookWindowsHookEx(hook: isize) -> i32;
        fn GetMessageW(msg: *mut Msg, hwnd: isize, min: u32, max: u32) -> i32;
        fn TranslateMessage(msg: *const Msg) -> i32;
        fn DispatchMessageW(msg: *const Msg) -> isize;
        fn GetAsyncKeyState(vk: i32) -> i16;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
    }

    const WH_KEYBOARD_LL: i32 = 13;
    const HC_ACTION: i32 = 0;
    const VK_LWIN: u32 = 0x5B;
    const VK_RWIN: u32 = 0x5C;
    const VK_ESCAPE: u32 = 0x1B;
    const VK_SHIFT: i32 = 0x10;
    const VK_CONTROL: i32 = 0x11;
    const VK_MENU: i32 = 0x12; // Alt

    unsafe extern "system" fn hook_proc(code: i32, wparam: usize, lparam: isize) -> isize {
        if code == HC_ACTION && lparam != 0 {
            let k = &*(lparam as *const KbdLlHook);
            // Appui ET relâchement de la touche Windows : avalés, le système ne les voit jamais
            if k.vk == VK_LWIN || k.vk == VK_RWIN { return 1; }
            // Ctrl + Échap ouvre aussi le menu Démarrer : bloqué (Ctrl + Maj + Échap, le gestionnaire des tâches, reste disponible)
            if k.vk == VK_ESCAPE {
                let down = |vk: i32| (GetAsyncKeyState(vk) as u16) & 0x8000 != 0;
                if down(VK_CONTROL) && !down(VK_SHIFT) && !down(VK_MENU) { return 1; }
            }
        }
        CallNextHookEx(0, code, wparam, lparam)
    }

    /// Lance le hook dans un thread dédié (un hook clavier global a besoin d'une boucle de messages)
    pub fn start() {
        std::thread::spawn(|| unsafe {
            let hook = SetWindowsHookExW(WH_KEYBOARD_LL, hook_proc, GetModuleHandleW(std::ptr::null()), 0);
            if hook == 0 { return; }
            let mut m = Msg::default();
            while GetMessageW(&mut m, 0, 0, 0) > 0 {
                TranslateMessage(&m);
                DispatchMessageW(&m);
            }
            UnhookWindowsHookEx(hook);
        });
    }
}

/// Fenêtres de Halo qui ne doivent JAMAIS avoir de cadre Windows (la fenêtre Réglages, elle, se redimensionne : on n'y touche pas)
const FRAMELESS: [&str; 4] = ["desktop", "topbar", "dock", "search"];

/// Remet les fenêtres de Halo sans cadre Windows (au cas où il serait revenu, par ex. après un masquage / affichage)
/// et s'assure qu'il ne puisse plus revenir (garde-fou installé sur chaque fenêtre, y compris celles d'un écran qu'on vient de brancher)
fn heal_frames(app: &AppHandle) {
    #[cfg(windows)]
    {
        let mut hs: Vec<isize> = Vec::new();
        for base in FRAMELESS {
            for w in windows_of(app, base) {
                if let Ok(h) = w.hwnd() {
                    let h = h.0 as isize;
                    winpos::strip_frame(h);
                    hs.push(h);
                }
            }
        }
        // Le sous-classement ne marche que depuis le thread qui a créé les fenêtres : le thread principal
        let _ = app.run_on_main_thread(move || { for h in hs { winpos::guard(h); } });
    }
    #[cfg(not(windows))]
    { let _ = app; }
}

/// Place une fenêtre pour que sa partie visible occupe exactement le rectangle demandé (pixels physiques)
fn place_window(w: &tauri::WebviewWindow, x: i32, y: i32, width: u32, height: u32) {
    #[cfg(windows)]
    {
        if let Ok(h) = w.hwnd() {
            if winpos::fit(h.0 as isize, x, y, width as i32, height as i32) { return; }
        }
    }
    let _ = w.set_size(PhysicalSize::new(width, height));
    let _ = w.set_position(PhysicalPosition::new(x, y));
}

fn place_desktop(app: &AppHandle) {
    for w in windows_of(app, "desktop") {
        if let Some(g) = geo_for(app, w.label()) { place_window(&w, g.x, g.y, g.w, g.h); }
    }
}
fn place_topbar_win(app: &AppHandle, w: &tauri::WebviewWindow, h: f64) {
    if let Some(g) = geo_for(app, w.label()) { place_window(w, g.x, g.y, g.w, (h * g.s) as u32); }
}
fn place_topbar(app: &AppHandle, h: f64) {
    for w in windows_of(app, "topbar") { place_topbar_win(app, &w, h); }
}
/// Bas de la zone du dock sur un écran
fn dock_bottom(g: &Geo) -> i32 { if SHELL.load(Ordering::Relaxed) { g.y + g.h as i32 } else { g.wa_bottom } }
fn place_dock(app: &AppHandle, width: f64, height: f64) {
    for w in windows_of(app, "dock") {
        if let Some(g) = geo_for(app, w.label()) {
            let dw = (width * g.s) as u32;
            let dh = (height * g.s) as u32;
            let bottom = dock_bottom(&g);
            let x = g.x + (g.w.saturating_sub(dw) / 2) as i32;
            place_window(&w, x, bottom - dh as i32, dw, dh);
        }
    }
}

fn spawn_screen_window(app: &AppHandle, base: &str, label: &str, k: usize) {
    use tauri::{WebviewUrl, WebviewWindowBuilder};
    // "m=k" : le front sait qu'il s'agit d'un écran secondaire (fond d'écran seul, sans widgets)
    let url = WebviewUrl::App(format!("index.html?w={base}&m={k}").into());
    let b = WebviewWindowBuilder::new(app, label, url)
        .title("Halo")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .shadow(false)
        .visible(false)
        .focused(false);
    let b = if base == "desktop" { b.always_on_bottom(true) } else { b.transparent(true).always_on_top(true) };
    let _ = b.build();
}

/// Crée les fenêtres des écrans branchés, ferme celles des écrans débranchés
fn ensure_screen_windows(app: &AppHandle) {
    let n = layout(app).len();
    for base in SCREEN_WINDOWS {
        for k in 1..n {
            let label = format!("{base}-{k}");
            if app.get_webview_window(&label).is_none() { spawn_screen_window(app, base, &label, k); }
        }
    }
    for (label, w) in app.webview_windows() {
        if let Some((base, k)) = label.rsplit_once('-') {
            if SCREEN_WINDOWS.contains(&base) {
                if let Ok(k) = k.parse::<usize>() { if k >= n { let _ = w.destroy(); } }
            }
        }
    }
}


// ---------- Plein écran : la barre du haut et le dock s'effacent sur l'écran concerné ----------
// La détection elle-même (toutes les fenêtres de chaque écran, dans l'ordre Z) est dans fullscreen.rs.
static FS_HIDE: AtomicBool = AtomicBool::new(true);
static HIDE_MAX: AtomicBool = AtomicBool::new(true); // une fenêtre simplement agrandie masque aussi les barres
static FS_MON: Mutex<Vec<(i32, i32)>> = Mutex::new(Vec::new()); // origines des écrans dont les barres sont masquées
static REVEAL: Mutex<Vec<((i32, i32), bool, bool)>> = Mutex::new(Vec::new()); // (écran, barre du haut rappelée, dock rappelé)

/// Masque la barre et le dock des écrans concernés, les réaffiche ailleurs (ou quand la souris les rappelle).
/// `heal` : vérifie aussi les cadres Windows (inutile quand on ne fait que refaire respecter l'état courant).
fn apply_fullscreen(app: &AppHandle, heal: bool) {
    let fs: Vec<(i32, i32)> = FS_MON.lock().map(|g| g.clone()).unwrap_or_default();
    let rev = REVEAL.lock().map(|g| g.clone()).unwrap_or_default();
    for base in ["topbar", "dock"] {
        for w in windows_of(app, base) {
            let covered = geo_for(app, w.label()).map(|g| {
                let o = (g.x, g.y);
                let recalled = rev.iter().any(|(ro, top, bottom)| *ro == o && if base == "topbar" { *top } else { *bottom });
                fs.contains(&o) && !recalled
            }).unwrap_or(false);
            let visible = w.is_visible().unwrap_or(true);
            if covered && visible { let _ = w.hide(); }
            else if !covered && !visible { let _ = w.show(); }
        }
    }
    if heal { heal_frames(app); }
}

#[tauri::command]
fn set_fullscreen_hide(enabled: bool) { FS_HIDE.store(enabled, Ordering::Relaxed); }

#[tauri::command]
fn set_hide_maximized(enabled: bool) { HIDE_MAX.store(enabled, Ordering::Relaxed); }

/// Écrans : (surface, échelle). Rafraîchi de temps en temps, pas à chaque relevé (chaque appel interroge le thread principal).
#[cfg_attr(windows, allow(dead_code))]
struct Screens { all: Vec<(fullscreen::Rect, f64)>, primary: Option<(fullscreen::Rect, f64)> }

fn read_screens(app: &AppHandle) -> Screens {
    let rect = |g: &Geo| fullscreen::Rect::new(g.x, g.y, g.x + g.w as i32, g.y + g.h as i32);
    let all: Vec<(fullscreen::Rect, f64)> = layout(app).iter().map(|g| (rect(g), g.s)).collect();
    let primary = all.first().copied();
    Screens { all, primary }
}

/// État de chaque écran (toutes les fenêtres, pas seulement celle qui a le focus)
fn detect_fullscreen(sc: &Screens, opts: fullscreen::Opts) -> Vec<fullscreen::MonVerdict> {
    #[cfg(windows)]
    {
        // Zone que Halo réserve sur l'écran principal (connue d'avance : voir fullscreen::win::detect)
        let reserved = if SHELL.load(Ordering::Relaxed) {
            sc.primary.map(|(r, s)| fullscreen::Rect::new(r.left, r.top + (32.0 * s) as i32, r.right, r.bottom - (96.0 * s) as i32))
        } else { None };
        fullscreen::win::detect(opts, reserved)
    }
    #[cfg(target_os = "linux")]
    {
        let mons: Vec<fullscreen::Mon> = sc.all.iter().map(|(r, _)| fullscreen::Mon { rect: *r, work: *r }).collect();
        fullscreen::x11::detect(&mons, opts)
    }
    #[cfg(not(any(windows, target_os = "linux")))]
    { let _ = (sc, opts); Vec::new() }
}

fn cursor_pos(app: &AppHandle) -> Option<(i32, i32)> {
    #[cfg(windows)]
    { let _ = app; fullscreen::win::cursor() }
    #[cfg(not(windows))]
    { app.cursor_position().ok().map(|p| (p.x as i32, p.y as i32)) }
}

/// Rectangle physique de la barre (« topbar » / « dock ») de l'écran dont l'origine est `o`
fn bar_rect(app: &AppHandle, base: &str, o: (i32, i32)) -> Option<fullscreen::Rect> {
    for w in windows_of(app, base) {
        if let Some(g) = geo_for(app, w.label()) {
            if (g.x, g.y) == o {
                let p = w.outer_position().ok()?;
                let s = w.outer_size().ok()?;
                return Some(fullscreen::Rect::new(p.x, p.y, p.x + s.width as i32, p.y + s.height as i32));
            }
        }
    }
    None
}

/// Zone de travail de l'écran principal : l'écran entier tant que ses barres sont masquées, la zone réservée sinon
fn set_primary_expanded(app: &AppHandle, expanded: bool) {
    #[cfg(windows)]
    {
        if EXPANDED.swap(expanded, Ordering::Relaxed) == expanded { return; }
        if !SHELL.load(Ordering::Relaxed) { return; } // sans le mode shell, la zone de travail appartient à la barre des tâches Windows
        if let Some(g) = geo(app) {
            let (full, reserved) = (full_area(&g), reserved_area(&g));
            // Dans un fil à part (la diffusion du changement peut prendre du temps), mais un à la fois et toujours avec l'état le plus récent
            std::thread::spawn(move || {
                let _g = WORK_AREA.lock();
                winpos::set_work_area(if EXPANDED.load(Ordering::Relaxed) { full } else { reserved });
            });
        }
    }
    #[cfg(not(windows))]
    { let _ = (app, expanded); }
}

/// Journal `fullscreen.log` (dans le dossier des réglages) : une entrée à chaque changement de fenêtre dominante sur un écran.
/// C'est lui qui dit pourquoi les barres se sont masquées, ou pas.
fn fs_log(app: &AppHandle, text: &str) {
    use std::io::Write;
    if text.is_empty() { return; }
    let Some(dir) = cfg_dir(app) else { return };
    let _ = std::fs::create_dir_all(&dir);
    let p = dir.join("fullscreen.log");
    if std::fs::metadata(&p).map(|m| m.len() > 200_000).unwrap_or(false) { let _ = std::fs::remove_file(&p); }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
        let s = now_ms() / 1000;
        let _ = write!(f, "[{:02}:{:02}:{:02} UTC]\n{}\n", (s / 3600) % 24, (s / 60) % 60, s % 60, text);
    }
}

fn start_fullscreen_watch(app: AppHandle) {
    #[cfg(any(windows, target_os = "linux"))]
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));
        // Linux : chaque relevé lance quelques petits processus (xprop, xwininfo), on le fait donc moins souvent
        let step: u32 = if cfg!(windows) { 150 } else { 500 };
        let mut tracker = fullscreen::Tracker::new(if cfg!(windows) { 3 } else { 2 }); // les barres reviennent après ~0,45 s / 1 s sans plein écran
        let mut reveals: HashMap<(i32, i32), fullscreen::Reveal> = HashMap::new();
        let mut last_rev: Vec<((i32, i32), bool, bool)> = Vec::new();
        let mut last_key = String::new();
        let mut screens = read_screens(&app);
        let mut n: u32 = 0;
        loop {
            n = n.wrapping_add(1);
            if n % (3000 / step) == 0 { screens = read_screens(&app); }
            let enabled = FS_HIDE.load(Ordering::Relaxed);
            let opts = fullscreen::Opts { hide_maximized: HIDE_MAX.load(Ordering::Relaxed) };
            let verdicts = if enabled { detect_fullscreen(&screens, opts) } else { Vec::new() };
            let (now, key, text) = fullscreen::summarize(&verdicts);
            if key != last_key { fs_log(&app, &text); last_key = key; }
            let changed = tracker.update(&now, enabled);

            // Écrans masqués « seulement » parce qu'une fenêtre est agrandie : la souris contre le bord du haut / du bas rappelle la barre / le dock
            let soft: Vec<(i32, i32)> = tracker.applied().iter().filter(|h| h.soft).map(|h| h.origin).collect();
            reveals.retain(|o, _| soft.contains(o));
            if !soft.is_empty() {
                let cur = cursor_pos(&app);
                for v in &verdicts {
                    let o = v.origin();
                    if !soft.contains(&o) { continue; }
                    let r = reveals.entry(o).or_default();
                    let (at_top, at_bottom) = cur.map(|c| fullscreen::edge_of(c, &v.rect)).unwrap_or((false, false));
                    let inside = |base: &str, shown: bool| -> bool {
                        if !shown { return false; }
                        match (cur, bar_rect(&app, base, o)) {
                            (Some((x, y)), Some(b)) => x >= b.left - 4 && x < b.right + 4 && y >= b.top - 4 && y < b.bottom + 4,
                            _ => false,
                        }
                    };
                    let edge = fullscreen::Edge { at_top, at_bottom, in_top_bar: inside("topbar", r.top), in_dock: inside("dock", r.bottom) };
                    r.step(step, edge);
                }
            }
            let mut rev: Vec<((i32, i32), bool, bool)> = reveals.iter().map(|(o, r)| (*o, r.top, r.bottom)).collect();
            rev.sort();
            let rev_changed = rev != last_rev;

            if changed || rev_changed {
                if let Ok(mut g) = FS_MON.lock() { *g = tracker.applied().iter().map(|h| h.origin).collect(); }
                if let Ok(mut g) = REVEAL.lock() { *g = rev.clone(); }
                last_rev = rev;
                if changed {
                    let primary_hidden = screens.primary.map(|(r, _)| tracker.applied().iter().any(|h| h.origin == (r.left, r.top))).unwrap_or(false);
                    set_primary_expanded(&app, primary_hidden);
                }
                apply_fullscreen(&app, true);
            } else if n % 8 == 0 {
                // Filet de sécurité : si quoi que ce soit a réaffiché une barre sur un écran masqué, on la remasque
                apply_fullscreen(&app, false);
            }
            std::thread::sleep(std::time::Duration::from_millis(step as u64));
        }
    });
    #[cfg(not(any(windows, target_os = "linux")))]
    { let _ = app; }
}

/// Veilleur rapide (toutes les 250 ms, sous Windows) : retire aussitôt tout cadre Windows qui serait revenu sur la barre du haut,
/// le dock, le fond d'écran ou la recherche (barres « Halo Barre » / « Halo Dock »), et, en mode shell, recache la barre des tâches
/// Windows si elle est réapparue (une fois par seconde).
fn start_frame_watch(app: AppHandle) {
    #[cfg(windows)]
    std::thread::spawn(move || {
        let mut tick: u32 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            tick = tick.wrapping_add(1);
            for base in FRAMELESS {
                for w in windows_of(&app, base) {
                    if let Ok(h) = w.hwnd() { winpos::strip_frame(h.0 as isize); }
                }
            }
            if tick % 4 == 0 && SHELL.load(Ordering::Relaxed) { winpos::hide_taskbars(); }
        }
    });
    #[cfg(not(windows))]
    { let _ = app; }
}

/// Surveille les écrans (branchement, débranchement, changement de résolution) et replace tout
fn start_monitor_watch(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(700));
        let mut last = String::new();
        loop {
            let sig = layout(&app).iter().map(|g| format!("{}:{}:{}x{}@{}", g.x, g.y, g.w, g.h, g.s)).collect::<Vec<_>>().join("|");
            if sig != last {
                last = sig;
                ensure_screen_windows(&app);
                place_desktop(&app);
                place_topbar(&app, 32.0);
                let (dw, dh) = *DOCK.lock().unwrap();
                place_dock(&app, dw, dh);
                heal_frames(&app); // AVANT l'affichage : une fenêtre toute neuve ne doit jamais apparaître avec sa barre de titre
                for base in SCREEN_WINDOWS { for w in windows_of(&app, base) { let _ = w.show(); } }
                heal_frames(&app);
                apply_fullscreen(&app, true); // une barre / un dock qui vient d'apparaître ne doit pas réapparaître sur un écran en plein écran
            }
            else {
                // Aucun changement d'écran : on vérifie quand même que les fonds d'écran épousent toujours leur écran
                // (rien à faire si c'est le cas ; sinon ils sont replacés et re-découpés)
                heal_frames(&app);
                place_desktop(&app);
            }
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

#[tauri::command]
fn fit_dock(app: AppHandle, width: f64, height: f64, bar: Option<f64>) {
    if let Some(b) = bar { if let Ok(mut g) = DOCK_BAR.lock() { *g = b.clamp(40.0, 400.0); } }
    *DOCK.lock().unwrap() = (width, height);
    place_dock(&app, width, height);
}

/// La barre qui s'agrandit (centre de contrôle) est celle de l'écran où l'on a cliqué
#[tauri::command]
fn set_topbar_expanded(window: tauri::WebviewWindow, expanded: bool) {
    place_topbar_win(window.app_handle(), &window, if expanded { 480.0 } else { 32.0 });
}

#[tauri::command]
fn quit(app: AppHandle) { app.exit(0); }

// ---------- Alimentation : veille, arrêt, redémarrage, verrouillage, déconnexion ----------
#[tauri::command]
fn power_action(action: String) -> bool {
    // Avant d'éteindre / redémarrer / se déconnecter : on rend sa barre des tâches à Windows
    if matches!(action.as_str(), "shutdown" | "restart" | "logoff") { shell_restore(); }
    power_run(&action)
}

#[cfg(windows)]
fn power_run(action: &str) -> bool {
    use std::os::windows::process::CommandExt;
    let mut c = match action {
        "sleep" => {
            let mut c = std::process::Command::new("powershell");
            c.args(["-NoProfile", "-NonInteractive", "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState('Suspend', $false, $false)"]);
            c
        }
        "shutdown" => { let mut c = std::process::Command::new("shutdown"); c.args(["/s", "/t", "0"]); c }
        "restart" => { let mut c = std::process::Command::new("shutdown"); c.args(["/r", "/t", "0"]); c }
        "logoff" => { let mut c = std::process::Command::new("shutdown"); c.arg("/l"); c }
        "lock" => { let mut c = std::process::Command::new("rundll32.exe"); c.arg("user32.dll,LockWorkStation"); c }
        _ => return false,
    };
    c.creation_flags(0x0800_0000).spawn().is_ok() // CREATE_NO_WINDOW
}

#[cfg(target_os = "linux")]
fn power_run(action: &str) -> bool {
    let (prog, args): (&str, Vec<String>) = match action {
        "sleep" => ("systemctl", vec!["suspend".into()]),
        "shutdown" => ("systemctl", vec!["poweroff".into()]),
        "restart" => ("systemctl", vec!["reboot".into()]),
        "lock" => ("loginctl", vec!["lock-session".into()]),
        "logoff" => ("loginctl", vec!["terminate-user".into(), std::env::var("USER").unwrap_or_default()]),
        _ => return false,
    };
    std::process::Command::new(prog).args(args).spawn().is_ok()
}

#[cfg(not(any(windows, target_os = "linux")))]
fn power_run(_action: &str) -> bool { false }

// ---------- Applications ouvertes ----------
#[derive(Serialize)]
struct AppWindow { pid: u32, name: String, title: String, path: String }

const SKIP: [&str; 5] = ["halo-desktop", "textinputhost", "searchhost", "startmenuexperiencehost", "shellexperiencehost"];

#[tauri::command]
async fn list_windows() -> Vec<AppWindow> {
    #[cfg(windows)]
    {
        let out = ps("Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Id,ProcessName,MainWindowTitle,Path | ConvertTo-Json -Compress", None)
            .unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::Value::Null);
        let items = match v {
            serde_json::Value::Array(a) => a,
            o @ serde_json::Value::Object(_) => vec![o],
            _ => vec![],
        };
        return items.iter().filter_map(|o| Some(AppWindow {
            pid: o["Id"].as_u64()? as u32,
            name: o["ProcessName"].as_str()?.to_string(),
            title: o["MainWindowTitle"].as_str().unwrap_or("").to_string(),
            path: o["Path"].as_str().unwrap_or("").to_string(),
        })).filter(|a| { let l = a.name.to_lowercase(); !SKIP.iter().any(|n| *n == l) }).collect();
    }
    #[cfg(not(windows))]
    { Vec::new() } // Linux : à faire (X11 _NET_CLIENT_LIST / wlr-foreign-toplevel)
}

#[tauri::command]
async fn app_icon(path: String) -> Option<String> {
    #[cfg(windows)]
    {
        let s = ps("Add-Type -AssemblyName System.Drawing; $i=[System.Drawing.Icon]::ExtractAssociatedIcon($env:HALO_ARG); if($i){$m=New-Object IO.MemoryStream; $i.ToBitmap().Save($m,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($m.ToArray())}", Some(("HALO_ARG", &path)))?;
        return if s.is_empty() { None } else { Some(s) };
    }
    #[cfg(not(windows))]
    { let _ = path; None }
}

#[tauri::command]
async fn focus_window(pid: u32) {
    #[cfg(windows)]
    {
        let script = format!("Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr h,int c);'; $h=(Get-Process -Id {pid}).MainWindowHandle; [W.U]::ShowWindowAsync($h,9)|Out-Null; (New-Object -ComObject WScript.Shell).AppActivate({pid})|Out-Null");
        let _ = ps(&script, None);
    }
    #[cfg(not(windows))]
    { let _ = pid; }
}

#[tauri::command]
fn launch(target: String) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let t = target.trim().to_string();
        let mut c = std::process::Command::new("cmd");
        c.args(["/C", "start", ""]);
        // Liens et "shell:" : entre guillemets, sinon "&" ou "^" dans l'adresse casserait la commande cmd
        if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("shell:") {
            c.raw_arg(format!("\"{}\"", t.replace('"', "")));
        } else {
            c.arg(&t);
        }
        let _ = c.creation_flags(0x0800_0000).spawn();
    }
    #[cfg(target_os = "linux")]
    { let _ = std::process::Command::new("xdg-open").arg(&target).spawn(); }
}


#[tauri::command]
async fn minimize_window(pid: u32) {
    #[cfg(windows)]
    {
        let script = format!("Add-Type -Namespace W -Name U -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr h,int c);'; $h=(Get-Process -Id {pid}).MainWindowHandle; [W.U]::ShowWindowAsync($h,6)|Out-Null");
        let _ = ps(&script, None);
    }
    #[cfg(not(windows))]
    { let _ = pid; }
}

// Fermeture "propre" (comme le bouton X) ; l'Explorateur/shell est protégé
#[tauri::command]
async fn quit_app(pid: u32) {
    #[cfg(windows)]
    {
        let _ = ps(&format!("$p=Get-Process -Id {pid}; if($p.ProcessName -ne 'explorer'){{ $p.CloseMainWindow()|Out-Null }}"), None);
    }
    #[cfg(not(windows))]
    { let _ = pid; }
}

// ---------- Applications en arrière-plan (la petite flèche « icônes cachées » de Windows) ----------
#[derive(Serialize)]
struct BgApp { name: String, path: String, count: u32 }

/// Programmes lancés (hors dossier Windows) qui n'ont aucune fenêtre ouverte : ce sont ceux qui vivent dans la zone de notification
const SKIP_BG: [&str; 3] = ["halo-desktop", "msedgewebview2", "crashpad_handler"];

#[tauri::command]
async fn list_background() -> Vec<BgApp> {
    #[cfg(windows)]
    {
        let script = r#"$all=@(Get-Process | Where-Object { $_.SessionId -ne 0 -and $_.Path });
$win=@($all | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.Path } | Sort-Object -Unique);
$sys=$env:SystemRoot + '\';
$r=@($all | Where-Object { $_.MainWindowTitle -eq '' -and -not $_.Path.StartsWith($sys,[StringComparison]::OrdinalIgnoreCase) -and ($win -notcontains $_.Path) } | Group-Object Path | ForEach-Object { [pscustomobject]@{ Name=$_.Group[0].ProcessName; Path=$_.Name; Count=$_.Count; Desc=[Diagnostics.FileVersionInfo]::GetVersionInfo($_.Name).FileDescription } });
if($r.Count -eq 0){'[]'}else{ConvertTo-Json -InputObject $r -Compress}"#;
        let out = ps(script, None).unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap_or(serde_json::Value::Null);
        let items = match v {
            serde_json::Value::Array(a) => a,
            o @ serde_json::Value::Object(_) => vec![o],
            _ => vec![],
        };
        return items.iter().filter_map(|o| {
            let path = o["Path"].as_str()?.to_string();
            let proc_name = o["Name"].as_str().unwrap_or("");
            if SKIP_BG.contains(&proc_name.to_lowercase().as_str()) { return None; }
            let desc = o["Desc"].as_str().unwrap_or("").trim();
            Some(BgApp {
                name: if desc.is_empty() { proc_name.to_string() } else { desc.to_string() },
                path,
                count: o["Count"].as_u64().unwrap_or(1) as u32,
            })
        }).collect();
    }
    #[cfg(not(windows))]
    { Vec::new() }
}

/// Ferme toutes les instances d'un programme en arrière-plan (jamais l'explorateur, Halo ou un programme du dossier Windows)
#[tauri::command]
async fn quit_background(path: String) -> bool {
    #[cfg(windows)]
    {
        let l = path.to_lowercase();
        let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into()).to_lowercase();
        if path.is_empty() || l.starts_with(&root) || l.ends_with("halo-desktop.exe") || l.ends_with("\\explorer.exe") { return false; }
        let _ = ps("Get-Process | Where-Object { $_.Path -eq $env:HALO_BG } | Stop-Process -Force", Some(("HALO_BG", &path)));
        return true;
    }
    #[cfg(not(windows))]
    { let _ = path; false }
}

#[derive(Serialize)]
struct FileItem { name: String, path: String, dir: bool }

#[tauri::command]
fn list_downloads() -> Vec<FileItem> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    let dir = std::path::Path::new(&home).join("Downloads");
    let mut v: Vec<(std::time::SystemTime, FileItem)> = std::fs::read_dir(dir).into_iter().flatten().flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            let t = m.modified().ok()?;
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with('.') || n.eq_ignore_ascii_case("desktop.ini") { return None; }
            Some((t, FileItem { name: n, path: e.path().to_string_lossy().to_string(), dir: m.is_dir() }))
        }).collect();
    v.sort_by(|a, b| b.0.cmp(&a.0));
    v.into_iter().take(12).map(|x| x.1).collect()
}

// ---------- Statut système et monitoring ----------
#[derive(Serialize)]
struct SystemStatus { network: bool, battery: Option<u8>, charging: bool }

#[tauri::command]
async fn get_system_status() -> SystemStatus {
    #[cfg(windows)]
    {
        let s = ps("$b=Get-CimInstance Win32_Battery|Select-Object -First 1; $n=Get-NetAdapter -Physical|Where-Object{$_.Status -eq 'Up'}|Select-Object -First 1; $bat=if($b){$b.EstimatedChargeRemaining}else{-1}; $chg=if($b -and $b.BatteryStatus -eq 2){1}else{0}; $net=if($n){1}else{0}; \"$bat,$chg,$net\"", None).unwrap_or_default();
        let p: Vec<i32> = s.split(',').filter_map(|x| x.trim().parse().ok()).collect();
        if p.len() == 3 {
            return SystemStatus { network: p[2] == 1, battery: if p[0] >= 0 { Some(p[0] as u8) } else { None }, charging: p[1] == 1 };
        }
    }
    SystemStatus { network: true, battery: None, charging: false }
}

#[derive(Serialize)]
struct Stats { cpu: f32, ram: f32 }

#[tauri::command]
fn system_stats(sys: State<Mutex<System>>) -> Stats {
    let mut s = sys.lock().unwrap();
    s.refresh_cpu_usage();
    s.refresh_memory();
    Stats { cpu: s.global_cpu_usage(), ram: s.used_memory() as f32 / s.total_memory().max(1) as f32 * 100.0 }
}


// ---------- Démon système : audio réel + lecture en cours (Spotify) ----------
// Un seul PowerShell résident (src/sys.ps1) : pic audio / volume (Core Audio) et SMTC (média).
#[allow(dead_code)]
const SYS_SCRIPT: &str = include_str!("sys.ps1");
#[allow(dead_code)]
static SYS_IN: Mutex<Option<std::process::ChildStdin>> = Mutex::new(None);
#[allow(dead_code)]
static SYS_CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);
static SYS_STOP: AtomicBool = AtomicBool::new(false);

#[cfg(windows)]
fn start_sys_daemon(app: AppHandle) {
    use std::io::{BufRead, BufReader};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};
    std::thread::spawn(move || {
        let path = std::env::temp_dir().join("halo-sys.ps1");
        if std::fs::write(&path, SYS_SCRIPT).is_err() { return; }
        for _ in 0..6 {
            if SYS_STOP.load(Ordering::Relaxed) { return; }
            let spawned = Command::new("powershell")
                .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&path)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                .spawn();
            let mut child = match spawned { Ok(c) => c, Err(_) => return };
            let stdout = child.stdout.take();
            // Erreurs de PowerShell (script qui ne démarre pas...) : remontées dans la carte Spotify pour le diagnostic
            if let Some(err) = child.stderr.take() {
                let app2 = app.clone();
                std::thread::spawn(move || {
                    let mut rd = BufReader::new(err);
                    let mut buf: Vec<u8> = Vec::new();
                    let mut sent = 0;
                    loop {
                        buf.clear();
                        match rd.read_until(b'\n', &mut buf) { Ok(0) | Err(_) => break, Ok(_) => {} }
                        let l = String::from_utf8_lossy(&buf).trim().to_string();
                        if l.is_empty() || sent >= 3 { continue; }
                        sent += 1;
                        let msg: String = l.chars().take(140).collect();
                        let j = serde_json::json!({ "on": false, "err": format!("powershell : {msg}") });
                        let _ = app2.emit("halo-media", format!("M|{j}"));
                    }
                });
            }
            *SYS_IN.lock().unwrap() = child.stdin.take();
            *SYS_CHILD.lock().unwrap() = Some(child);
            if let Some(out) = stdout {
                let mut rd = BufReader::new(out);
                let mut buf: Vec<u8> = Vec::new();
                loop {
                    buf.clear();
                    match rd.read_until(b'\n', &mut buf) { Ok(0) | Err(_) => break, Ok(_) => {} }
                    let text = String::from_utf8_lossy(&buf);
                    let l = text.trim().trim_start_matches('\u{feff}').to_string();
                    // Lignes "A|..." (audio), "D|..." (liste des sorties audio) et "M|..." (média) ; le reste est ignoré
                    if l.starts_with("A|") || l.starts_with("D|") { let _ = app.emit("halo-audio", l); }
                    else if l.starts_with("M|") { let _ = app.emit("halo-media", l); }
                }
            }
            *SYS_IN.lock().unwrap() = None;
            std::thread::sleep(std::time::Duration::from_secs(3));
        }
    });
}

fn stop_sys_daemon() {
    SYS_STOP.store(true, Ordering::Relaxed);
    if let Ok(mut c) = SYS_CHILD.lock() {
        if let Some(mut child) = c.take() { let _ = child.kill(); }
    }
}

fn sys_send(line: &str) {
    #[cfg(windows)]
    {
        use std::io::Write;
        if let Ok(mut g) = SYS_IN.lock() {
            if let Some(w) = g.as_mut() { let _ = writeln!(w, "{line}"); let _ = w.flush(); }
        }
    }
    #[cfg(not(windows))]
    { let _ = line; }
}

#[tauri::command]
fn set_volume(level: f64) { sys_send(&format!("vol {:.3}", level.clamp(0.0, 1.0))); }

/// Choisit la sortie audio dont on pilote le volume (vide = sortie par défaut de Windows, "@auto" = Wave Link, ou un bout de nom).
/// Sans nom : demande seulement au démon de renvoyer la liste des sorties.
#[tauri::command]
fn audio_device(name: Option<String>) {
    match name {
        Some(n) => {
            let clean: String = n.chars().filter(|c| !c.is_control()).take(120).collect();
            sys_send(&format!("dev:{}", clean.trim()));
        }
        None => sys_send("devs"),
    }
}

/// Indicateur de son : true = ne suit que la sortie choisie (casque…), false = toutes les sorties actives
#[tauri::command]
fn audio_meter(selected: bool) { sys_send(if selected { "meter:sel" } else { "meter:all" }); }

#[tauri::command]
fn set_mute(mute: bool) { sys_send(&format!("mute {}", if mute { 1 } else { 0 })); }

#[tauri::command]
fn media_control(action: String, value: Option<f64>) {
    #[cfg(target_os = "linux")]
    media_linux::control(&action, value);
    #[cfg(not(target_os = "linux"))]
    {
        let line = match action.as_str() {
            "toggle" | "next" | "prev" | "resend" => action.clone(),
            "seek" => format!("seek {:.1}", value.unwrap_or(0.0).max(0.0)),
            "only" => format!("only {}", if value.unwrap_or(0.0) > 0.5 { 1 } else { 0 }),
            _ => return,
        };
        sys_send(&line);
    }
}

// ---------- Pochette de secours ----------
// Quand le lecteur ne fournit pas de pochette (Spotify sous Windows la donne parfois en retard ou pas du tout),
// on la cherche par artiste + titre dans l'API de recherche d'iTunes (publique, sans clé). Utilise `curl`,
// présent dans Windows 10/11 et sur la plupart des distributions Linux : aucune dépendance en plus.
fn curl_bytes(url: &str, max_secs: u32) -> Option<Vec<u8>> {
    let mut c = std::process::Command::new("curl");
    c.args(["-sL", "--max-time"]).arg(max_secs.to_string()).arg(url)
        .stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = c.output().ok()?;
    if !out.status.success() || out.stdout.is_empty() { return None; }
    Some(out.stdout)
}

fn url_encode(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { o.push(b as char); } else { o.push_str(&format!("%{b:02X}")); }
    }
    o
}

fn norm(s: &str) -> String { s.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect() }

fn b64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut o = String::with_capacity(data.len() * 4 / 3 + 4);
    for ch in data.chunks(3) {
        let n = ((ch[0] as u32) << 16) | ((*ch.get(1).unwrap_or(&0) as u32) << 8) | (*ch.get(2).unwrap_or(&0) as u32);
        o.push(T[((n >> 18) & 63) as usize] as char);
        o.push(T[((n >> 12) & 63) as usize] as char);
        o.push(if ch.len() > 1 { T[((n >> 6) & 63) as usize] as char } else { '=' });
        o.push(if ch.len() > 2 { T[(n & 63) as usize] as char } else { '=' });
    }
    o
}

#[tauri::command]
async fn fetch_cover(artist: String, title: String) -> Option<String> {
    let first_artist = artist.split(&[',', '&', ';'][..]).next().unwrap_or("").trim().to_string();
    let term = format!("{first_artist} {title}");
    let url = format!("https://itunes.apple.com/search?media=music&entity=song&limit=6&term={}", url_encode(&term));
    let body = curl_bytes(&url, 6)?;
    let j: serde_json::Value = serde_json::from_slice(&body).ok()?;
    let (want_t, want_a) = (norm(&title), norm(&first_artist));
    // On n'accepte qu'un résultat dont le titre et l'artiste correspondent : mieux vaut pas de pochette qu'une mauvaise
    let hit = j["results"].as_array()?.iter().find(|r| {
        let t = norm(r["trackName"].as_str().unwrap_or(""));
        let a = norm(r["artistName"].as_str().unwrap_or(""));
        !t.is_empty() && !want_t.is_empty()
            && (t.contains(&want_t) || want_t.contains(&t))
            && (want_a.is_empty() || a.contains(&want_a) || want_a.contains(&a))
    })?;
    let art = hit["artworkUrl100"].as_str()?.replace("100x100", "600x600");
    let img = curl_bytes(&art, 8)?;
    if img.len() < 500 || img.len() > 4_000_000 { return None; }
    Some(format!("data:image/jpeg;base64,{}", b64(&img)))
}

// ---------- Luminosité (écrans de portable uniquement ; None si non supporté) ----------
#[tauri::command]
async fn get_brightness() -> Option<u8> {
    #[cfg(windows)]
    {
        let s = ps("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness", None)?;
        return s.trim().parse().ok();
    }
    #[cfg(not(windows))]
    { None }
}

#[tauri::command]
async fn set_brightness(level: u8) {
    #[cfg(windows)]
    {
        let l = level.min(100);
        let _ = ps(&format!("Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Select-Object -First 1 | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=[uint32]1;Brightness=[byte]{l}}}"), None);
    }
    #[cfg(not(windows))]
    { let _ = level; }
}

// ---------- Réglages persistants (fichier JSON) et fonds d'écran importés ----------
fn cfg_dir(app: &AppHandle) -> Option<std::path::PathBuf> { app.path().app_config_dir().ok() }

fn safe_name(n: &str) -> Option<String> {
    if !n.is_empty() && n.len() < 64 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        Some(n.to_string())
    } else { None }
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Option<String> {
    std::fs::read_to_string(cfg_dir(&app)?.join("settings.json")).ok()
}

#[tauri::command]
fn save_settings(app: AppHandle, json: String) {
    if let Some(d) = cfg_dir(&app) {
        let _ = std::fs::create_dir_all(&d);
        let _ = std::fs::write(d.join("settings.json"), json);
    }
}

// Les images sont stockées sous forme de "data URL" texte : aucune dépendance supplémentaire
#[tauri::command]
fn save_wallpaper(app: AppHandle, name: String, data: String) -> bool {
    let (Some(d), Some(n)) = (cfg_dir(&app), safe_name(&name)) else { return false };
    let dir = d.join("wallpapers");
    std::fs::create_dir_all(&dir).is_ok() && std::fs::write(dir.join(format!("{n}.txt")), data).is_ok()
}

#[tauri::command]
fn read_wallpaper(app: AppHandle, name: String) -> Option<String> {
    let n = safe_name(&name)?;
    std::fs::read_to_string(cfg_dir(&app)?.join("wallpapers").join(format!("{n}.txt"))).ok()
}

#[tauri::command]
fn delete_wallpaper(app: AppHandle, name: String) {
    if let Some(p) = find_media(&app, &name) { let _ = std::fs::remove_file(p); }
    if let (Some(d), Some(n)) = (cfg_dir(&app), safe_name(&name)) {
        let _ = std::fs::remove_file(d.join("wallpapers").join(format!("{n}.txt")));
    }
}

// ---------- Fonds d'écran vidéo (mp4…) et audio (mp3…) ----------
// Les fichiers sont copiés tels quels dans <config>/wallpapers/<nom>.<ext> (par morceaux : pas de limite de taille en mémoire).
const MEDIA_EXTS: [&str; 7] = ["mp4", "m4v", "webm", "mp3", "m4a", "ogg", "wav"];

fn find_media(app: &AppHandle, name: &str) -> Option<std::path::PathBuf> {
    let n = safe_name(name)?;
    let dir = cfg_dir(app)?.join("wallpapers");
    MEDIA_EXTS.iter().map(|e| dir.join(format!("{n}.{e}"))).find(|p| p.is_file())
}

/// Reçoit un morceau du fichier (corps binaire) ; en-têtes : x-name, x-ext, x-first ("1" = on repart de zéro)
#[tauri::command]
fn media_chunk(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<bool, String> {
    use std::io::Write;
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("corps binaire attendu".into()) };
    let hdr = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let name = safe_name(&hdr("x-name")).ok_or("nom invalide")?;
    let ext = hdr("x-ext").to_ascii_lowercase();
    if !MEDIA_EXTS.contains(&ext.as_str()) { return Err("format non pris en charge".into()); }
    let first = hdr("x-first") == "1";
    let dir = cfg_dir(&app).ok_or("dossier introuvable")?.join("wallpapers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut f = std::fs::OpenOptions::new()
        .create(true).write(true).truncate(first).append(!first)
        .open(dir.join(format!("{name}.{ext}"))).map_err(|e| e.to_string())?;
    f.write_all(data).map_err(|e| e.to_string())?;
    Ok(true)
}

/// Chemin complet du fichier (pour le lecteur vidéo, via le protocole asset)
#[tauri::command]
fn media_path(app: AppHandle, name: String) -> Option<String> {
    find_media(&app, &name).map(|p| p.to_string_lossy().into_owned())
}

/// Contenu brut du fichier (pour les fonds audio : lecture + analyse du son côté page)
#[tauri::command]
fn read_media(app: AppHandle, name: String) -> Result<tauri::ipc::Response, String> {
    let p = find_media(&app, &name).ok_or("fichier introuvable")?;
    Ok(tauri::ipc::Response::new(std::fs::read(p).map_err(|e| e.to_string())?))
}

// ---------- Recherche d'applications (loupe) ----------
#[derive(Serialize, Clone)]
struct StartApp { name: String, target: String }

static APPS: Mutex<Option<(std::time::Instant, Vec<StartApp>)>> = Mutex::new(None);
static SEARCH_SHOWN: AtomicU64 = AtomicU64::new(0);
static SEARCH_HIDDEN: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

// Plan B si Get-StartApps est indisponible : raccourcis (.lnk) du menu Démarrer
#[cfg(windows)]
fn scan_start_menu() -> Vec<StartApp> {
    fn walk(dir: &std::path::Path, out: &mut Vec<StartApp>, depth: u8) {
        if depth > 4 { return; }
        for e in std::fs::read_dir(dir).into_iter().flatten().flatten() {
            let p = e.path();
            if p.is_dir() { walk(&p, out, depth + 1); }
            else if p.extension().map(|x| x.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
                if let Some(n) = p.file_stem().and_then(|x| x.to_str()) {
                    out.push(StartApp { name: n.to_string(), target: p.to_string_lossy().to_string() });
                }
            }
        }
    }
    let mut roots: Vec<std::path::PathBuf> = Vec::new();
    for var in ["ProgramData", "APPDATA"] {
        if let Ok(p) = std::env::var(var) { roots.push(std::path::PathBuf::from(p).join(r"Microsoft\Windows\Start Menu\Programs")); }
    }
    let mut out = Vec::new();
    for r in roots { walk(&r, &mut out, 0); }
    out
}

fn load_start_apps() -> Vec<StartApp> {
    #[cfg(windows)]
    {
        // Même liste que le menu Démarrer : applications classiques ET applications du Store
        let out = ps("Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress", None).unwrap_or_default();
        let v: serde_json::Value = serde_json::from_str(out.trim_start_matches('\u{feff}')).unwrap_or(serde_json::Value::Null);
        let items = match v {
            serde_json::Value::Array(a) => a,
            o @ serde_json::Value::Object(_) => vec![o],
            _ => vec![],
        };
        let mut apps: Vec<StartApp> = items.iter().filter_map(|o| {
            let name = o["Name"].as_str()?.trim().to_string();
            let id = o["AppID"].as_str()?.trim().to_string();
            if name.is_empty() || id.is_empty() { return None; }
            Some(StartApp { name, target: format!("shell:AppsFolder\\{id}") })
        }).collect();
        if apps.is_empty() { apps = scan_start_menu(); }
        apps.retain(|a| { let l = a.name.to_lowercase(); !l.contains("uninstall") && !l.contains("désinstall") });
        apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        apps.dedup_by(|a, b| a.name.eq_ignore_ascii_case(&b.name));
        return apps;
    }
    #[cfg(not(windows))]
    { Vec::new() } // Linux : à faire (.desktop)
}

// ---------- Icônes des applications (cache mémoire + fichier app-icons.json) ----------
// Une seule fois par application : un PowerShell (src/icons.ps1) demande à l'Explorateur l'icône de chaque entrée du menu
// Démarrer (applications classiques ET du Store), puis les PNG sont gardés sur disque : les lancements suivants sont instantanés.
#[allow(dead_code)]
const ICON_SCRIPT: &str = include_str!("icons.ps1");
static ICONS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
#[allow(dead_code)]
static ICON_BUSY: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
fn icon_cache_path(app: &AppHandle) -> Option<std::path::PathBuf> { Some(cfg_dir(app)?.join("app-icons.json")) }

/// Charge le cache depuis le disque (une seule fois)
fn ensure_icons_loaded(app: &AppHandle) {
    let Ok(mut g) = ICONS.lock() else { return };
    if g.is_some() { return; }
    let m: HashMap<String, String> = icon_cache_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    *g = Some(m);
}

#[allow(dead_code)]
fn save_icons(app: &AppHandle) {
    let Some(p) = icon_cache_path(app) else { return };
    let json = match ICONS.lock() {
        Ok(g) => match g.as_ref() { Some(m) => serde_json::to_string(m).unwrap_or_default(), None => return },
        Err(_) => return,
    };
    if json.is_empty() { return; }
    if let Some(d) = p.parent() { let _ = std::fs::create_dir_all(d); }
    let _ = std::fs::write(p, json);
}

/// Extrait (en tâche de fond) les icônes des applications qui n'en ont pas encore, puis prévient le front (évènement "halo-icons")
#[cfg(windows)]
fn extract_icons(app: &AppHandle, apps: &[StartApp]) {
    use std::io::{BufRead, BufReader};
    use std::os::windows::process::CommandExt;
    use std::process::{Command, Stdio};

    ensure_icons_loaded(app);
    let missing: Vec<String> = {
        let Ok(g) = ICONS.lock() else { return };
        let list: Vec<String> = apps.iter()
            .filter(|a| !g.as_ref().map_or(false, |m| m.contains_key(&a.target)))
            .map(|a| a.target.clone())
            .collect();
        list
    };
    if missing.is_empty() { return; }
    if ICON_BUSY.swap(true, Ordering::SeqCst) { return; }

    let run = || {
        let dir = std::env::temp_dir();
        let (script, input) = (dir.join("halo-icons.ps1"), dir.join("halo-icons-in.txt"));
        if std::fs::write(&script, ICON_SCRIPT).is_err() || std::fs::write(&input, missing.join("\n")).is_err() { return; }
        let Ok(mut child) = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
            .arg(&script).arg("-In").arg(&input)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null())
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn() else { return };
        let Some(out) = child.stdout.take() else { return };
        let mut rd = BufReader::new(out);
        let mut buf: Vec<u8> = Vec::new();
        let mut done = 0usize;
        loop {
            buf.clear();
            match rd.read_until(b'\n', &mut buf) { Ok(0) | Err(_) => break, Ok(_) => {} }
            let text = String::from_utf8_lossy(&buf);
            let l = text.trim().trim_start_matches('\u{feff}');
            let Some((i, b)) = l.split_once('\t') else { continue };
            let Some(target) = i.trim().parse::<usize>().ok().and_then(|i| missing.get(i)) else { continue };
            if let Ok(mut g) = ICONS.lock() {
                if let Some(m) = g.as_mut() { m.insert(target.clone(), b.trim().to_string()); }
            }
            done += 1;
            // Premier lot vite (la liste se remplit d'icônes), puis par paquets
            if done == 12 || done % 40 == 0 { let _ = app.emit("halo-icons", true); }
        }
        let _ = child.wait();
        let _ = std::fs::remove_file(&input);
    };
    run();
    ICON_BUSY.store(false, Ordering::SeqCst);

    // On ne garde que les icônes des applications encore installées
    if let Ok(mut g) = ICONS.lock() {
        if let Some(m) = g.as_mut() {
            let live: std::collections::HashSet<&str> = apps.iter().map(|a| a.target.as_str()).collect();
            m.retain(|k, _| live.contains(k.as_str()));
        }
    }
    save_icons(app);
    let _ = app.emit("halo-icons", true);
}

#[cfg(not(windows))]
fn extract_icons(_app: &AppHandle, _apps: &[StartApp]) {} // Linux : à faire (icônes des .desktop)

/// Cible → PNG en base64 (les applications sans icône sont omises : le front affiche alors une pastille à initiale)
#[tauri::command]
fn get_app_icons(app: AppHandle) -> HashMap<String, String> {
    ensure_icons_loaded(&app);
    let Ok(g) = ICONS.lock() else { return HashMap::new() };
    let out: HashMap<String, String> = g.as_ref()
        .map(|m| m.iter().filter(|(_, v)| !v.is_empty()).map(|(k, v)| (k.clone(), v.clone())).collect())
        .unwrap_or_default();
    out
}

fn cache_start_apps(app: &AppHandle) -> Vec<StartApp> {
    let v = load_start_apps();
    if !v.is_empty() {
        if let Ok(mut g) = APPS.lock() { *g = Some((std::time::Instant::now(), v.clone())); }
        let (a, list) = (app.clone(), v.clone());
        std::thread::spawn(move || extract_icons(&a, &list));
    }
    v
}

#[tauri::command]
async fn list_start_apps(app: AppHandle, refresh: Option<bool>) -> Vec<StartApp> {
    if !refresh.unwrap_or(false) {
        if let Ok(g) = APPS.lock() {
            if let Some((t, v)) = g.as_ref() {
                if t.elapsed().as_secs() < 600 { return v.clone(); }
            }
        }
    }
    cache_start_apps(&app)
}

/// Écran sous le curseur (la recherche s'ouvre là où tu travailles, pas toujours sur l'écran principal)
fn geo_at_cursor(app: &AppHandle) -> Option<Geo> {
    let p = app.cursor_position().ok()?;
    let (cx, cy) = (p.x as i32, p.y as i32);
    layout(app).into_iter().find(|g| cx >= g.x && cx < g.x + g.w as i32 && cy >= g.y && cy < g.y + g.h as i32)
}

fn show_search(app: &AppHandle) {
    let g = geo_at_cursor(app).or_else(|| geo(app));
    if let (Some(g), Some(w)) = (g, app.get_webview_window("search")) {
        let s = g.s;
        // La recherche se pose juste au-dessus du dock, centrée sur l'écran ; elle grandit vers le haut
        let bar = DOCK_BAR.lock().map(|b| *b).unwrap_or(90.0);
        let bottom = dock_bottom(&g) - ((bar + 10.0) * s) as i32;
        let top_limit = g.y + (32.0 * s) as i32 + (12.0 * s) as i32; // sous la barre du haut
        let width = (640.0 * s).min(g.w as f64 * 0.94);
        let height = (480.0 * s).min((bottom - top_limit).max(200) as f64);
        let x = g.x + ((g.w as f64 - width) / 2.0) as i32;
        let y = bottom - height as i32;
        place_window(&w, x, y, width as u32, height as u32);
        SEARCH_SHOWN.store(now_ms(), Ordering::Relaxed);
        let _ = w.show();
        #[cfg(windows)]
        { if let Ok(h) = w.hwnd() { winpos::strip_frame(h.0 as isize); } } // l'affichage peut avoir remis le cadre Windows
        let _ = w.set_focus();
        let _ = app.emit_to("search", "halo-search-open", true);
    }
}

fn hide_search_win(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("search") {
        if w.is_visible().unwrap_or(false) { SEARCH_HIDDEN.store(now_ms(), Ordering::Relaxed); }
        let _ = w.hide();
    }
}

#[tauri::command]
fn open_search(app: AppHandle) {
    let Some(w) = app.get_webview_window("search") else { return };
    if w.is_visible().unwrap_or(false) { hide_search_win(&app); return; }
    // Clic sur la loupe alors que le panneau vient de se fermer en perdant le focus : on ne le rouvre pas
    if now_ms().saturating_sub(SEARCH_HIDDEN.load(Ordering::Relaxed)) < 350 { return; }
    show_search(&app);
}

#[tauri::command]
fn hide_search(app: AppHandle) { hide_search_win(&app); }

// ---------- Fenêtre Réglages ----------
fn show_settings(app: &AppHandle, page: Option<String>) {
    if let (Some(g), Some(w)) = (geo(app), app.get_webview_window("settings")) {
        let s = g.s;
        let top = 32.0 * s;
        let avail_h = g.h as f64 - top - 120.0 * s; // barre du haut + dock
        let width = (1040.0 * s).min(g.w as f64 * 0.94);
        let height = (700.0 * s).min(avail_h - 16.0 * s);
        let x = g.x + ((g.w as f64 - width) / 2.0) as i32;
        let y = g.y + (top + (avail_h - height) / 2.0) as i32;
        let _ = w.set_size(PhysicalSize::new(width as u32, height as u32));
        let _ = w.set_position(PhysicalPosition::new(x, y));
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = app.emit_to("settings", "halo-visible", true);
        if let Some(p) = page { let _ = app.emit_to("settings", "halo-nav", p); }
    }
}

fn hide_settings_win(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("settings") { let _ = w.hide(); }
    let _ = app.emit_to("settings", "halo-visible", false);
}

#[tauri::command]
fn open_settings(app: AppHandle, page: Option<String>) { show_settings(&app, page); }

#[tauri::command]
fn hide_settings(app: AppHandle) { hide_settings_win(&app); }

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .manage(Mutex::new(System::new()))
        .invoke_handler(tauri::generate_handler![
            fit_dock, set_shell_mode, set_topbar_expanded, quit, list_windows, app_icon,
            focus_window, minimize_window, quit_app, list_downloads, launch, get_system_status, system_stats,
            set_volume, set_mute, audio_device, audio_meter, media_control, fetch_cover, get_brightness, set_brightness,
            load_settings, save_settings, save_wallpaper, read_wallpaper, delete_wallpaper, media_chunk, media_path, read_media, power_action, list_background, quit_background,
            open_settings, hide_settings, list_start_apps, get_app_icons, open_search, hide_search, set_fullscreen_hide, set_hide_maximized
        ])
        .on_window_event(|window, event| {
            // La fenêtre Réglages se masque au lieu de se fermer (réouverture instantanée)
            if window.label() == "settings" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    hide_settings_win(window.app_handle());
                }
            }
            // La recherche se referme dès qu'elle perd le focus (sauf juste après son ouverture)
            if window.label() == "search" {
                if let tauri::WindowEvent::Focused(false) = event {
                    if now_ms().saturating_sub(SEARCH_SHOWN.load(Ordering::Relaxed)) > 400 {
                        hide_search_win(window.app_handle());
                    }
                }
            }
        })
        .setup(|app| {
            let h = app.handle();
            if let Some(m) = h.primary_monitor().ok().flatten() {
                let wa = m.work_area();
                let _ = ORIG.set((wa.position.x, wa.position.y, wa.position.x + wa.size.width as i32, wa.position.y + wa.size.height as i32));
            }
            // Garde-fou « pas de barre de titre » posé avant que la moindre fenêtre ne s'affiche
            // (setup tourne dans le thread principal : le sous-classement peut se faire directement)
            #[cfg(windows)]
            {
                for base in FRAMELESS {
                    for w in windows_of(h, base) {
                        if let Ok(x) = w.hwnd() { winpos::guard(x.0 as isize); }
                    }
                }
            }
            place_desktop(h);
            place_topbar(h, 32.0);
            place_dock(h, 720.0, 150.0);
            for label in ["desktop", "topbar", "dock"] {
                if let Some(w) = h.get_webview_window(label) { let _ = w.show(); }
            }
            heal_frames(h);
            #[cfg(windows)]
            winkey::start(); // touche Windows désactivée tant que Halo tourne
            let hh = h.clone();
            std::thread::spawn(move || apply_shell(&hh, true));
            start_monitor_watch(h.clone());
            start_frame_watch(h.clone());
            start_fullscreen_watch(h.clone());
            #[cfg(windows)]
            start_sys_daemon(h.clone());
            #[cfg(target_os = "linux")]
            media_linux::start(h.clone());
            let ha = h.clone();
            std::thread::spawn(move || { let _ = cache_start_apps(&ha); }); // la loupe (et ses icônes) est prête dès la première ouverture
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur au lancement de Halo")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event { stop_sys_daemon(); shell_restore(); }
        });
}
