//! Détection du plein écran (« plein écran fenêtré » compris), commune à Windows et Linux.
//!
//! Ancienne méthode : on ne regardait que la fenêtre AU PREMIER PLAN. Au moindre changement de focus (clic sur la barre ou le dock,
//! fenêtre d'un autre écran, notification, écran de chargement d'un jeu…) les barres réapparaissaient par-dessus l'application, et une
//! vidéo en plein écran sur le 2e écran ne les masquait jamais tant que le focus était ailleurs.
//!
//! Nouvelle méthode : pour CHAQUE écran, on parcourt les fenêtres de haut en bas (ordre Z) et la première fenêtre « dominante »
//! (qui occupe l'essentiel de l'écran) décide :
//!  - elle recouvre tout l'écran (ou, si elle n'a ni titre ni bordure, toute la zone de travail) → plein écran : barre et dock masqués ;
//!  - c'est une fenêtre ordinaire (agrandie avec sa barre de titre, ou simplement grande) → les barres restent.
//! Les petites fenêtres au-dessus (lecteur flottant, info-bulle, overlay) ne comptent pas ; les fenêtres de Halo, les fenêtres
//! invisibles / réduites / sur un autre bureau virtuel, le bureau Windows et les overlays « transparents aux clics » sont ignorés.
//!
//! Option « fenêtres agrandies » : une fenêtre agrandie (bouton □, titre et bordures conservés) masque aussi les barres. Dans ce
//! cas les barres reviennent en poussant la souris contre le bord du haut (maintenu ~0,6 s) ou du bas de l'écran (`Reveal`).

use std::collections::HashMap;
use std::fmt::Write as _;

/// Même disposition que le RECT de Windows
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Rect { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }

impl Rect {
    pub fn new(left: i32, top: i32, right: i32, bottom: i32) -> Rect { Rect { left, top, right, bottom } }
    fn width(&self) -> i32 { (self.right - self.left).max(0) }
    fn height(&self) -> i32 { (self.bottom - self.top).max(0) }
    fn area(&self) -> i64 { self.width() as i64 * self.height() as i64 }
    fn overlap(&self, o: &Rect) -> i64 {
        let w = (self.right.min(o.right) - self.left.max(o.left)).max(0) as i64;
        let h = (self.bottom.min(o.bottom) - self.top.max(o.top)).max(0) as i64;
        w * h
    }
    /// `self` recouvre `o` à `tol` pixels près
    fn covers(&self, o: &Rect, tol: i32) -> bool {
        self.left <= o.left + tol && self.top <= o.top + tol && self.right >= o.right - tol && self.bottom >= o.bottom - tol
    }
    fn contains(&self, x: i32, y: i32) -> bool { x >= self.left && x < self.right && y >= self.top && y < self.bottom }
    fn center(&self) -> (i32, i32) { ((self.left + self.right) / 2, (self.top + self.bottom) / 2) }
}

/// Un écran : sa surface totale et sa zone de travail (surface moins les barres réservées par Halo / Windows)
#[derive(Clone, Copy, Debug)]
pub struct Mon { pub rect: Rect, pub work: Rect }

/// Une fenêtre candidate, telle que la voit le système (les fenêtres à ignorer ne sont jamais construites)
#[derive(Clone, Debug)]
pub struct Win {
    pub rect: Rect,
    /// Le système / l'application a déclaré le plein écran (X11 : _NET_WM_STATE_FULLSCREEN)
    pub declared_fs: bool,
    /// La fenêtre peut être du plein écran. Faux pour une fenêtre agrandie classique (avec titre / bordure) : elle ne l'est jamais,
    /// mais elle compte comme fenêtre dominante (elle masque ce qu'il y a dessous).
    pub can_be_fs: bool,
    /// Sans titre ni bordure : le plein écran fenêtré qui s'arrête à la zone de travail (au lieu de l'écran) compte aussi
    pub frameless: bool,
    /// Fenêtre agrandie (bouton □), avec ou sans titre
    pub maximized: bool,
    /// Identité courte (classe) : sert à détecter un changement
    pub key: String,
    /// Description complète (classe, titre, taille, styles) : pour le journal
    pub desc: String,
}

/// Pourquoi les barres d'un écran sont masquées
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hide { No, Fullscreen, Maximized }

/// Réglages de la décision
#[derive(Clone, Copy, Debug, Default)]
pub struct Opts {
    /// Une fenêtre simplement agrandie masque aussi les barres
    pub hide_maximized: bool,
}

pub struct MonVerdict {
    pub rect: Rect,
    pub hide: Hide,
    pub by: Option<Win>,
}

impl MonVerdict {
    pub fn origin(&self) -> (i32, i32) { (self.rect.left, self.rect.top) }
}

/// Un écran dont les barres sont masquées. `soft` : seulement parce qu'une fenêtre est agrandie (les barres peuvent alors être
/// rappelées avec la souris, ce qui est exclu en vrai plein écran : un jeu utilise les bords de l'écran).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Hidden { pub origin: (i32, i32), pub soft: bool }

/// Tolérance (px) : certains lecteurs / navigateurs / jeux s'arrêtent à 1-2 px du bord ou le débordent
const TOL: i32 = 3;
/// Part minimale de l'écran qu'une fenêtre doit occuper pour décider du plein écran
const DOMINANT_PCT: i64 = 60;

/// Fenêtre assez grande pour être « celle qui occupe l'écran » ?
pub fn is_dominant(w: &Win, m: &Mon) -> bool {
    if m.rect.area() == 0 { return false; }
    if w.declared_fs { let (cx, cy) = w.rect.center(); return m.rect.contains(cx, cy); }
    w.rect.overlap(&m.rect) * 100 >= m.rect.area() * DOMINANT_PCT
}

fn is_fullscreen(w: &Win, m: &Mon) -> bool {
    if w.declared_fs { return true; }
    if !w.can_be_fs { return false; }
    w.rect.covers(&m.rect, TOL) || (w.frameless && w.rect.covers(&m.work, TOL))
}

fn decide(w: &Win, m: &Mon, o: Opts) -> Hide {
    if is_fullscreen(w, m) { Hide::Fullscreen }
    else if o.hide_maximized && w.maximized { Hide::Maximized }
    else { Hide::No }
}

/// `wins` : fenêtres de la plus haute à la plus basse dans l'ordre Z
pub fn evaluate(wins: &[Win], mons: &[Mon], o: Opts) -> Vec<MonVerdict> {
    mons.iter().map(|m| match wins.iter().find(|w| is_dominant(w, m)) {
        Some(w) => MonVerdict { rect: m.rect, hide: decide(w, m, o), by: Some(w.clone()) },
        None => MonVerdict { rect: m.rect, hide: Hide::No, by: None },
    }).collect()
}

/// Chaque écran a-t-il déjà sa fenêtre dominante ? (inutile d'examiner les fenêtres plus basses)
pub fn all_decided(wins: &[Win], mons: &[Mon]) -> bool {
    mons.iter().all(|m| wins.iter().any(|w| is_dominant(w, m)))
}

/// (écrans à masquer, clé de changement, texte du journal)
pub fn summarize(v: &[MonVerdict]) -> (Vec<Hidden>, String, String) {
    let mut hidden = Vec::new();
    let (mut key, mut text) = (String::new(), String::new());
    for (i, m) in v.iter().enumerate() {
        if m.hide != Hide::No { hidden.push(Hidden { origin: m.origin(), soft: m.hide == Hide::Maximized }); }
        let head = format!("écran {} ({},{} {}x{})", i, m.rect.left, m.rect.top, m.rect.width(), m.rect.height());
        let verdict = match m.hide {
            Hide::Fullscreen => "PLEIN ÉCRAN (barres masquées)",
            Hide::Maximized => "fenêtre agrandie (barres masquées, rappel par le bord de l'écran)",
            Hide::No => "fenêtre ordinaire (barres visibles)",
        };
        match &m.by {
            Some(w) => {
                let _ = write!(key, "{}:{:?}:{}|", i, m.hide, w.key);
                let _ = writeln!(text, "{} : {} <- {}", head, verdict, w.desc);
            }
            None => {
                let _ = write!(key, "{}:none|", i);
                let _ = writeln!(text, "{} : aucune fenêtre dominante (barres visibles)", head);
            }
        }
    }
    (hidden, key, text)
}

/// Anti-clignotement : un écran est masqué tout de suite, mais ne retrouve ses barres qu'après `release` relevés consécutifs sans
/// plein écran (changement de focus, écran de chargement d'un jeu, fenêtre qui se recrée…).
pub struct Tracker { applied: Vec<Hidden>, misses: HashMap<(i32, i32), u32>, release: u32 }

impl Tracker {
    pub fn new(release: u32) -> Tracker { Tracker { applied: Vec::new(), misses: HashMap::new(), release } }
    pub fn applied(&self) -> &[Hidden] { &self.applied }
    /// Intègre un relevé ; renvoie vrai si l'ensemble des écrans masqués a changé. `enabled` faux : tout est réaffiché sans délai.
    pub fn update(&mut self, now: &[Hidden], enabled: bool) -> bool {
        let mut next: Vec<Hidden> = if enabled { now.to_vec() } else { Vec::new() };
        if enabled {
            for a in &self.applied {
                if !now.iter().any(|h| h.origin == a.origin) {
                    let c = self.misses.entry(a.origin).or_insert(0);
                    *c += 1;
                    if *c < self.release { next.push(*a); }
                }
            }
        }
        // on ne garde de compteur que pour les écrans « en sursis »
        self.misses.retain(|o, _| next.iter().any(|h| h.origin == *o) && !now.iter().any(|h| h.origin == *o));
        next.sort();
        next.dedup();
        let changed = next != self.applied;
        self.applied = next;
        changed
    }
}

/// Position de la souris par rapport à un écran dont les barres sont masquées parce qu'une fenêtre est agrandie
#[derive(Clone, Copy, Debug, Default)]
pub struct Edge { pub at_top: bool, pub at_bottom: bool, pub in_top_bar: bool, pub in_dock: bool }

/// Rappel des barres par le bord de l'écran. Barre du haut : souris sur la toute première ligne de pixels pendant 0,6 s (ni les
/// boutons de la fenêtre, ni les onglets ne la déclenchent en passant) ; dock : bord du bas pendant 0,25 s. Une barre rappelée
/// reste affichée tant que la souris est dessus, puis repart après 0,45 s.
#[derive(Clone, Copy, Debug, Default)]
pub struct Reveal { pub top: bool, pub bottom: bool, top_dwell: u32, bottom_dwell: u32, top_out: u32, bottom_out: u32 }

const TOP_DWELL_MS: u32 = 600;
const BOTTOM_DWELL_MS: u32 = 250;
const RELEASE_MS: u32 = 450;

fn step_one(shown: &mut bool, dwell: &mut u32, out: &mut u32, dt: u32, at_edge: bool, inside: bool, need: u32) {
    if !*shown {
        if at_edge { *dwell += dt; if *dwell >= need { *shown = true; *out = 0; } } else { *dwell = 0; }
    } else if inside || at_edge {
        *out = 0;
    } else {
        *out += dt;
        if *out >= RELEASE_MS { *shown = false; *dwell = 0; }
    }
}

impl Reveal {
    /// `dt` : millisecondes écoulées depuis le relevé précédent
    pub fn step(&mut self, dt: u32, e: Edge) {
        step_one(&mut self.top, &mut self.top_dwell, &mut self.top_out, dt, e.at_top, e.in_top_bar, TOP_DWELL_MS);
        step_one(&mut self.bottom, &mut self.bottom_dwell, &mut self.bottom_out, dt, e.at_bottom, e.in_dock, BOTTOM_DWELL_MS);
    }
}

/// La souris touche-t-elle le bord du haut / du bas de l'écran ?
pub fn edge_of(cursor: (i32, i32), screen: &Rect) -> (bool, bool) {
    let (x, y) = cursor;
    if x < screen.left || x >= screen.right { return (false, false); }
    (y <= screen.top + 1 && y >= screen.top - 2, y >= screen.bottom - 2 && y <= screen.bottom + 2)
}

// ======================================================================================================================
// Windows : EnumWindows donne les fenêtres de haut en bas
// ======================================================================================================================
#[cfg(windows)]
pub mod win {
    use super::*;
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct Point { x: i32, y: i32 }

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct MonitorInfo { cb: u32, monitor: Rect, work: Rect, flags: u32 }

    type EnumWinProc = unsafe extern "system" fn(isize, isize) -> i32;
    type EnumMonProc = unsafe extern "system" fn(isize, isize, *mut Rect, isize) -> i32;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(f: EnumWinProc, lparam: isize) -> i32;
        fn EnumDisplayMonitors(hdc: isize, clip: *const Rect, f: EnumMonProc, lparam: isize) -> i32;
        fn GetMonitorInfoW(mon: isize, info: *mut MonitorInfo) -> i32;
        fn GetForegroundWindow() -> isize;
        fn GetCursorPos(p: *mut Point) -> i32;
        fn IsWindowVisible(hwnd: isize) -> i32;
        fn IsIconic(hwnd: isize) -> i32;
        fn IsZoomed(hwnd: isize) -> i32;
        fn GetWindowRect(hwnd: isize, r: *mut Rect) -> i32;
        fn GetWindowLongW(hwnd: isize, index: i32) -> i32;
        fn GetWindowThreadProcessId(hwnd: isize, pid: *mut u32) -> u32;
        fn GetClassNameW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
        fn GetWindowTextW(hwnd: isize, buf: *mut u16, max: i32) -> i32;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmGetWindowAttribute(hwnd: isize, attr: u32, out: *mut c_void, size: u32) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentProcessId() -> u32;
    }

    const GWL_STYLE: i32 = -16;
    const GWL_EXSTYLE: i32 = -20;
    const WS_CAPTION: u32 = 0x00C0_0000;
    const WS_THICKFRAME: u32 = 0x0004_0000;
    const WS_EX_TRANSPARENT: u32 = 0x0000_0020; // clics qui traversent : overlay
    const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;  // fenêtre d'outils / overlay / info-bulle
    const WS_EX_NOACTIVATE: u32 = 0x0800_0000;  // ne prend jamais le focus : overlay
    const DWMWA_CLOAKED: u32 = 14;              // fenêtre « cachée » : autre bureau virtuel, application UWP suspendue…

    unsafe extern "system" fn push_win(h: isize, lp: isize) -> i32 {
        (*(lp as *mut Vec<isize>)).push(h);
        1
    }

    unsafe extern "system" fn push_mon(m: isize, _dc: isize, _r: *mut Rect, lp: isize) -> i32 {
        let mut mi = MonitorInfo::default();
        mi.cb = std::mem::size_of::<MonitorInfo>() as u32;
        if GetMonitorInfoW(m, &mut mi) != 0 { (*(lp as *mut Vec<Mon>)).push(Mon { rect: mi.monitor, work: mi.work }); }
        1
    }

    fn monitors() -> Vec<Mon> {
        let mut v: Vec<Mon> = Vec::new();
        unsafe { EnumDisplayMonitors(0, std::ptr::null(), push_mon, &mut v as *mut Vec<Mon> as isize); }
        v
    }

    fn text(f: impl Fn(*mut u16, i32) -> i32) -> String {
        let mut b = [0u16; 128];
        let n = f(b.as_mut_ptr(), 128).clamp(0, 128) as usize;
        String::from_utf16_lossy(&b[..n])
    }

    /// Fenêtre du système qui couvre l'écran sans être une application
    fn is_shell_class(c: &str) -> bool {
        matches!(c, "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "XamlExplorerHostIslandWindow"
            | "MultitaskingViewFrame" | "TaskSwitcherWnd" | "ForegroundStaging" | "NotifyIconOverflowWindow")
    }

    /// Position de la souris (pixels physiques)
    pub fn cursor() -> Option<(i32, i32)> {
        let mut p = Point::default();
        if unsafe { GetCursorPos(&mut p) } != 0 { Some((p.x, p.y)) } else { None }
    }

    fn candidate(h: isize, mons: &[Mon], me: u32, fg: isize) -> Option<Win> {
        unsafe {
            if IsWindowVisible(h) == 0 || IsIconic(h) != 0 { return None; }
            let mut r = Rect::default();
            if GetWindowRect(h, &mut r) == 0 { return None; }
            // Test bon marché d'abord : une fenêtre qui n'occupe l'essentiel d'aucun écran ne décide de rien
            if !mons.iter().any(|m| r.overlap(&m.rect) * 100 >= m.rect.area() * DOMINANT_PCT) { return None; }
            // Fenêtre « cachée » par le système (autre bureau virtuel, application suspendue) : visible pour IsWindowVisible, pas à l'écran
            let mut cloaked: u32 = 0;
            if DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, 4) == 0 && cloaked != 0 { return None; }
            // Overlays (fenêtres d'outils, transparentes aux clics, qui ne prennent pas le focus) : ignorés, SAUF si c'est la fenêtre au
            // premier plan (alors c'est bien une application : certains lecteurs / jeux se déclarent « fenêtre d'outils »)
            let ex = GetWindowLongW(h, GWL_EXSTYLE) as u32;
            if h != fg && ex & (WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE) != 0 { return None; }
            let mut pid = 0u32;
            GetWindowThreadProcessId(h, &mut pid);
            if pid == me { return None; } // les fenêtres de Halo (barre, dock, fond d'écran, recherche…) ne comptent pas
            let class = text(|b, n| GetClassNameW(h, b, n));
            if is_shell_class(&class) { return None; }
            let style = GetWindowLongW(h, GWL_STYLE) as u32;
            let caption = style & WS_CAPTION == WS_CAPTION;
            let frame = style & WS_THICKFRAME != 0;
            let zoomed = IsZoomed(h) != 0;
            // Fenêtre agrandie classique (titre ou bordure de redimensionnement) : jamais du plein écran.
            // Agrandie SANS titre ni bordure (kiosque, lecteur vidéo…), ou non agrandie : plein écran si elle recouvre l'écran.
            let can_be_fs = !(zoomed && (caption || frame));
            let title: String = text(|b, n| GetWindowTextW(h, b, n)).chars().take(40).collect();
            let desc = format!("{} « {} » {}x{} en ({},{}) zoomed={} titre={} bordure={}",
                class, title, r.right - r.left, r.bottom - r.top, r.left, r.top, zoomed, caption, frame);
            Some(Win { rect: r, declared_fs: false, can_be_fs, frameless: !caption && !frame, maximized: zoomed, key: class, desc })
        }
    }

    /// État de chaque écran. `reserved` : zone de travail que Halo réserve sur l'écran principal (entre la barre du haut et le dock).
    /// On la connaît d'avance au lieu de la lire dans Windows : quand les barres sont masquées, Halo agrandit la zone de travail
    /// jusqu'à l'écran entier, et la détection ne doit pas en dépendre (sinon elle se contredirait en boucle).
    pub fn detect(opts: Opts, reserved: Option<Rect>) -> Vec<MonVerdict> {
        let mut mons = monitors();
        if mons.is_empty() { return Vec::new(); }
        if let Some(rv) = reserved {
            let (cx, cy) = ((rv.left + rv.right) / 2, (rv.top + rv.bottom) / 2);
            for m in mons.iter_mut() { if m.rect.contains(cx, cy) { m.work = rv; } }
        }
        let mut hs: Vec<isize> = Vec::new();
        unsafe { EnumWindows(push_win, &mut hs as *mut Vec<isize> as isize); } // de la fenêtre la plus haute à la plus basse
        let me = unsafe { GetCurrentProcessId() };
        let fg = unsafe { GetForegroundWindow() };
        let mut wins: Vec<Win> = Vec::new();
        for h in hs {
            if let Some(w) = candidate(h, &mons, me, fg) {
                wins.push(w);
                if all_decided(&wins, &mons) { break; }
            }
        }
        evaluate(&wins, &mons, opts)
    }
}

// ======================================================================================================================
// Linux (X11 / XWayland) : _NET_CLIENT_LIST_STACKING donne les fenêtres de bas en haut
// Sans dépendance supplémentaire : xprop / xwininfo (paquet x11-utils). Sous Wayland pur, seules les applications XWayland sont vues.
// ======================================================================================================================
#[cfg(target_os = "linux")]
pub mod x11 {
    use super::*;
    use std::process::Command;

    /// On n'examine jamais plus de fenêtres que cela par relevé (chaque fenêtre coûte deux petits processus)
    const MAX_WINDOWS: usize = 14;

    fn run(prog: &str, args: &[&str]) -> Option<String> {
        let o = Command::new(prog).args(args).env("LC_ALL", "C").output().ok()?;
        if !o.status.success() { return None; }
        Some(String::from_utf8_lossy(&o.stdout).to_string())
    }

    /// Premier nombre (décimal ou 0x…) d'une ligne xprop : « PROP(CARDINAL) = 123 » ou « PROP(WINDOW): window id # 0x3e00003 »
    fn first_num(line: &str) -> Option<u64> {
        let rest = line.rsplit(|c: char| c == '=' || c == '#').next()?;
        let v = rest.trim().split(|c: char| c == ',' || c == ' ').next()?.trim();
        if let Some(h) = v.strip_prefix("0x") { u64::from_str_radix(h, 16).ok() } else { v.parse().ok() }
    }

    fn hex(v: &str) -> u64 {
        let v = v.trim();
        match v.strip_prefix("0x") { Some(h) => u64::from_str_radix(h, 16).unwrap_or(0), None => v.parse().unwrap_or(0) }
    }

    /// Identifiants des fenêtres, de la plus haute à la plus basse
    fn stacking() -> Vec<String> {
        let mut ids: Vec<String> = run("xprop", &["-root", "_NET_CLIENT_LIST_STACKING"])
            .map(|o| o.rsplit('#').next().unwrap_or("").split(',').map(|s| s.trim().to_string()).filter(|s| s.starts_with("0x")).collect())
            .unwrap_or_default();
        ids.reverse();
        if ids.is_empty() {
            // Gestionnaire de fenêtres sans liste d'empilement : on se contente de la fenêtre active
            if let Some(n) = run("xprop", &["-root", "_NET_ACTIVE_WINDOW"]).and_then(|o| o.lines().next().and_then(first_num)) {
                if n != 0 { ids.push(format!("0x{:x}", n)); }
            }
        }
        ids
    }

    /// (x, y, largeur, hauteur) d'une fenêtre X en coordonnées écran absolues ; None si elle n'est pas affichée
    fn geometry(id: &str) -> Option<(i32, i32, i32, i32)> {
        let out = run("xwininfo", &["-id", id])?;
        if let Some(l) = out.lines().find(|l| l.trim().starts_with("Map State:")) {
            if !l.contains("IsViewable") { return None; }
        }
        let get = |k: &str| -> Option<i32> {
            out.lines().find_map(|l| l.trim().strip_prefix(k).and_then(|v| v.trim().parse::<i32>().ok()))
        };
        Some((get("Absolute upper-left X:")?, get("Absolute upper-left Y:")?, get("Width:")?, get("Height:")?))
    }

    fn candidate(id: &str, me: u64) -> Option<Win> {
        let props = run("xprop", &["-id", id, "_NET_WM_PID", "_NET_WM_STATE", "_NET_WM_WINDOW_TYPE", "_MOTIF_WM_HINTS", "WM_CLASS"])?;
        let (mut pid, mut state, mut wtype, mut motif, mut class) = (0u64, String::new(), String::new(), String::new(), String::new());
        for l in props.lines() {
            if l.starts_with("_NET_WM_PID") { pid = first_num(l).unwrap_or(0); }
            else if l.starts_with("_NET_WM_STATE") { state = l.to_string(); }
            else if l.starts_with("_NET_WM_WINDOW_TYPE") { wtype = l.to_string(); }
            else if l.starts_with("_MOTIF_WM_HINTS") { motif = l.to_string(); }
            else if l.starts_with("WM_CLASS") { class = l.split('=').nth(1).unwrap_or("").trim().replace('"', ""); }
        }
        if pid != 0 && pid == me { return None; } // fenêtres de Halo
        let full = state.contains("_NET_WM_STATE_FULLSCREEN");
        // Bureau, panneaux, menus, info-bulles, palettes d'outils : jamais du « plein écran »
        if ["_DESKTOP", "_DOCK", "_SPLASH", "_NOTIFICATION", "_TOOLTIP", "_MENU", "_COMBO", "_DND", "_UTILITY"].iter().any(|t| wtype.contains(t)) { return None; }
        if state.contains("_NET_WM_STATE_HIDDEN") { return None; } // réduite
        if state.contains("_NET_WM_STATE_SKIP_TASKBAR") && !full { return None; } // overlay
        let (x, y, w, h) = geometry(id)?;
        // _MOTIF_WM_HINTS = flags, functions, decorations, … : flag « decorations » posé et decorations = 0 → fenêtre sans décoration
        let undecorated = {
            let v: Vec<&str> = motif.split('=').nth(1).unwrap_or("").split(',').map(|s| s.trim()).collect();
            v.len() >= 3 && hex(v[0]) & 0x2 != 0 && hex(v[2]) == 0
        };
        let maximized = state.contains("_NET_WM_STATE_MAXIMIZED_VERT") && state.contains("_NET_WM_STATE_MAXIMIZED_HORZ");
        // Fenêtre agrandie normale (avec ses décorations, y compris celles que l'application dessine elle-même) : jamais du plein écran
        let can_be_fs = full || undecorated;
        let key = if class.is_empty() { id.to_string() } else { class.clone() };
        let desc = format!("{} {}x{} en ({},{}) plein-ecran={} agrandie={} sans-decoration={}", key, w, h, x, y, full, maximized, undecorated);
        Some(Win { rect: Rect::new(x, y, x + w, y + h), declared_fs: full, can_be_fs, frameless: undecorated, maximized, key, desc })
    }

    /// État de chaque écran
    pub fn detect(mons: &[Mon], opts: Opts) -> Vec<MonVerdict> {
        if mons.is_empty() { return Vec::new(); }
        let me = std::process::id() as u64;
        let mut wins: Vec<Win> = Vec::new();
        for id in stacking().iter().take(MAX_WINDOWS) {
            if let Some(w) = candidate(id, me) {
                wins.push(w);
                if all_decided(&wins, mons) { break; }
            }
        }
        evaluate(&wins, mons, opts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const M0: Rect = Rect { left: 0, top: 0, right: 1920, bottom: 1080 };
    const M1: Rect = Rect { left: 1920, top: 0, right: 3840, bottom: 1080 };
    // écran principal : zone de travail réduite par la barre du haut (32) et le dock (96) ; 2e écran : zone de travail = écran
    fn mons() -> Vec<Mon> {
        vec![
            Mon { rect: M0, work: Rect::new(0, 32, 1920, 1080 - 96) },
            Mon { rect: M1, work: M1 },
        ]
    }
    fn w(r: Rect, can: bool, frameless: bool, key: &str) -> Win {
        Win { rect: r, declared_fs: false, can_be_fs: can, frameless, maximized: false, key: key.into(), desc: key.into() }
    }
    /// fenêtre agrandie avec titre et bordures
    fn maxed(r: Rect, key: &str) -> Win {
        Win { rect: r, declared_fs: false, can_be_fs: false, frameless: false, maximized: true, key: key.into(), desc: key.into() }
    }
    const OFF: Opts = Opts { hide_maximized: false };
    const ON: Opts = Opts { hide_maximized: true };
    fn fs(v: &[MonVerdict]) -> Vec<bool> { v.iter().map(|m| m.hide == Hide::Fullscreen).collect() }
    fn hid(v: &[MonVerdict]) -> Vec<Hide> { v.iter().map(|m| m.hide).collect() }

    #[test]
    fn borderless_game_hides_bars() {
        assert_eq!(fs(&evaluate(&[w(M0, true, true, "game")], &mons(), OFF)), vec![true, false]);
    }

    #[test]
    fn maximized_window_with_title_never_counts_even_on_second_monitor() {
        // sur l'écran 2 il n'y a pas de zone réservée : une fenêtre agrandie couvre tout l'écran, mais reste « ordinaire »
        assert_eq!(fs(&evaluate(&[w(M1, false, false, "browser")], &mons(), OFF)), vec![false, false]);
    }

    #[test]
    fn maximized_window_in_work_area_is_not_fullscreen() {
        let wa = Rect::new(-8, 32, 1928, 1080 - 96 + 8); // fenêtre agrandie : déborde de 8 px, mais s'arrête aux barres
        assert_eq!(fs(&evaluate(&[w(wa, false, false, "app")], &mons(), OFF)), vec![false, false]);
    }

    #[test]
    fn covering_window_on_top_of_game_wins() {
        // un navigateur agrandi au-dessus d'un jeu fenêtré sans bordure : les barres reviennent
        let wins = [w(M0, false, false, "browser"), w(M0, true, true, "game")];
        assert_eq!(fs(&evaluate(&wins, &mons(), OFF)), vec![false, false]);
    }

    #[test]
    fn small_floating_window_over_game_does_not_matter() {
        let pip = Rect::new(1500, 700, 1900, 950);
        let wins = [w(pip, true, true, "pip"), w(M0, true, true, "game")];
        assert_eq!(fs(&evaluate(&wins, &mons(), OFF)), vec![true, false]);
    }

    #[test]
    fn fullscreen_video_on_other_monitor_while_working_on_first() {
        // le focus est sur l'écran 1 (fenêtre agrandie), la vidéo en plein écran est sur l'écran 2 : seul l'écran 2 masque ses barres
        let wins = [w(Rect::new(-8, 32, 1928, 1000), false, false, "editor"), w(M1, true, true, "video")];
        let v = evaluate(&wins, &mons(), OFF);
        assert_eq!(fs(&v), vec![false, true]);
        let (hidden, _, _) = summarize(&v);
        assert_eq!(hidden, vec![Hidden { origin: (1920, 0), soft: false }]);
    }

    #[test]
    fn two_half_snapped_windows_decide_nothing() {
        let wins = [w(Rect::new(0, 32, 960, 984), true, false, "a"), w(Rect::new(960, 32, 1920, 984), true, false, "b")];
        assert_eq!(fs(&evaluate(&wins, &mons(), OFF)), vec![false, false]);
    }

    #[test]
    fn one_or_two_pixels_short_still_counts() {
        let almost = Rect::new(0, 0, 1919, 1078);
        assert_eq!(fs(&evaluate(&[w(almost, true, true, "player")], &mons(), OFF)), vec![true, false]);
    }

    #[test]
    fn ten_pixels_short_does_not_count() {
        // fenêtre avec titre non agrandie, à 10 px du bas : une simple grande fenêtre, pas du plein écran
        let short = Rect::new(0, 0, 1920, 1070);
        assert_eq!(fs(&evaluate(&[w(short, true, false, "app")], &mons(), OFF)), vec![false, false]);
    }

    #[test]
    fn borderless_sized_to_work_area_counts() {
        // « plein écran fenêtré » qui respecte la zone de travail (entre la barre du haut et le dock)
        let wa = Rect::new(0, 32, 1920, 1080 - 96);
        assert_eq!(fs(&evaluate(&[w(wa, true, true, "game")], &mons(), OFF)), vec![true, false]);
    }

    #[test]
    fn framed_window_sized_to_work_area_does_not_count() {
        let wa = Rect::new(0, 32, 1920, 1080 - 96);
        assert_eq!(fs(&evaluate(&[w(wa, true, false, "app")], &mons(), OFF)), vec![false, false]);
    }

    #[test]
    fn declared_fullscreen_wins_even_if_geometry_is_off() {
        let mut g = w(Rect::new(0, 0, 1900, 1000), false, false, "mpv");
        g.declared_fs = true;
        assert_eq!(fs(&evaluate(&[g], &mons(), OFF)), vec![true, false]);
    }

    #[test]
    fn nothing_dominant_means_visible_bars() {
        let v = evaluate(&[], &mons(), OFF);
        assert_eq!(fs(&v), vec![false, false]);
        assert!(v.iter().all(|m| m.by.is_none()));
    }

    #[test]
    fn all_decided_stops_early() {
        let ms = mons();
        assert!(!all_decided(&[w(M0, true, true, "game")], &ms));
        assert!(all_decided(&[w(M0, true, true, "game"), w(M1, false, false, "b")], &ms));
    }

    #[test]
    fn maximized_window_hides_bars_only_when_option_is_on() {
        let wa = Rect::new(-8, 32, 1928, 1080 - 96 + 8);
        let wins = [maxed(wa, "browser")];
        assert_eq!(hid(&evaluate(&wins, &mons(), OFF)), vec![Hide::No, Hide::No]);
        assert_eq!(hid(&evaluate(&wins, &mons(), ON)), vec![Hide::Maximized, Hide::No]);
    }

    #[test]
    fn maximized_on_second_monitor_with_option() {
        assert_eq!(hid(&evaluate(&[maxed(Rect::new(1912, -8, 3848, 1088), "app")], &mons(), ON)), vec![Hide::No, Hide::Maximized]);
    }

    #[test]
    fn maximized_window_under_small_dialog_still_hides() {
        let dlg = Rect::new(600, 300, 1200, 700);
        let wins = [w(dlg, true, false, "dialog"), maxed(Rect::new(-8, 32, 1928, 992), "app")];
        assert_eq!(hid(&evaluate(&wins, &mons(), ON)), vec![Hide::Maximized, Hide::No]);
    }

    #[test]
    fn restored_window_brings_bars_back_even_with_option() {
        let normal = Rect::new(300, 200, 1500, 900);
        assert_eq!(hid(&evaluate(&[w(normal, true, false, "app")], &mons(), ON)), vec![Hide::No, Hide::No]);
    }

    #[test]
    fn real_fullscreen_wins_over_maximized_label() {
        let mut g = w(M0, true, true, "game");
        g.maximized = true; // jeu « agrandi » sans titre : reste du vrai plein écran (pas de rappel par le bord)
        assert_eq!(hid(&evaluate(&[g], &mons(), ON)), vec![Hide::Fullscreen, Hide::No]);
    }

    #[test]
    fn window_spanning_both_monitors() {
        let both = Rect::new(0, 0, 3840, 1080);
        assert_eq!(fs(&evaluate(&[w(both, true, true, "wall")], &mons(), OFF)), vec![true, true]);
    }

    fn h(x: i32, soft: bool) -> Hidden { Hidden { origin: (x, 0), soft } }

    #[test]
    fn tracker_hides_at_once_and_releases_after_delay() {
        let mut t = Tracker::new(3);
        assert!(t.update(&[h(0, false)], true));          // masqué tout de suite
        assert!(!t.update(&[h(0, false)], true));         // rien de nouveau
        assert!(!t.update(&[], true));                    // 1er relevé sans plein écran : on attend
        assert!(!t.update(&[], true));                    // 2e : on attend encore
        assert_eq!(t.applied(), &[h(0, false)]);
        assert!(t.update(&[], true));                     // 3e : les barres reviennent
        assert!(t.applied().is_empty());
    }

    #[test]
    fn tracker_gap_shorter_than_delay_is_ignored() {
        let mut t = Tracker::new(3);
        t.update(&[h(0, false)], true);
        t.update(&[], true);
        t.update(&[], true);
        assert!(!t.update(&[h(0, false)], true));         // le plein écran est revenu à temps : aucun clignotement
        assert!(!t.update(&[], true));                    // et le compteur est reparti de zéro
        assert!(!t.update(&[], true));
        assert!(t.update(&[], true));
    }

    #[test]
    fn tracker_switches_soft_to_hard_immediately_and_disabling_clears() {
        let mut t = Tracker::new(3);
        t.update(&[h(0, true)], true);
        assert!(t.update(&[h(0, false)], true));
        assert_eq!(t.applied(), &[h(0, false)]);
        assert!(t.update(&[h(0, false)], false));         // option désactivée : tout revient sans délai
        assert!(t.applied().is_empty());
    }

    #[test]
    fn tracker_handles_two_monitors_independently() {
        let mut t = Tracker::new(2);
        t.update(&[h(0, false), h(1920, true)], true);
        assert!(!t.update(&[h(1920, true)], true));       // écran 0 en sursis
        assert!(t.update(&[h(1920, true)], true));        // écran 0 libéré, écran 1 toujours masqué
        assert_eq!(t.applied(), &[h(1920, true)]);
    }

    fn edge(top: bool, bottom: bool, in_top: bool, in_dock: bool) -> Edge { Edge { at_top: top, at_bottom: bottom, in_top_bar: in_top, in_dock } }

    #[test]
    fn top_bar_needs_a_deliberate_dwell_at_the_edge() {
        let mut r = Reveal::default();
        for _ in 0..3 { r.step(150, edge(true, false, false, false)); }   // 450 ms : pas encore
        assert!(!r.top);
        r.step(150, edge(true, false, false, false));                      // 600 ms
        assert!(r.top && !r.bottom);
    }

    #[test]
    fn crossing_the_edge_quickly_does_not_reveal() {
        let mut r = Reveal::default();
        r.step(150, edge(true, false, false, false));
        r.step(150, edge(false, false, false, false));                     // la souris repart : le compteur retombe à zéro
        for _ in 0..3 { r.step(150, edge(true, false, false, false)); }
        assert!(!r.top);
    }

    #[test]
    fn dock_reveals_fast_and_stays_while_mouse_is_on_it() {
        let mut r = Reveal::default();
        r.step(150, edge(false, true, false, false));
        r.step(150, edge(false, true, false, false));
        assert!(r.bottom);
        for _ in 0..10 { r.step(150, edge(false, false, false, true)); }   // sur le dock : il reste
        assert!(r.bottom);
        for _ in 0..2 { r.step(150, edge(false, false, false, false)); }   // 300 ms hors du dock : il reste encore
        assert!(r.bottom);
        r.step(150, edge(false, false, false, false));                     // 450 ms : il repart
        assert!(!r.bottom);
    }

    #[test]
    fn edge_detection_uses_first_and_last_rows_of_the_screen() {
        let s = Rect::new(1920, 0, 3840, 1080);
        assert_eq!(edge_of((2500, 0), &s), (true, false));
        assert_eq!(edge_of((2500, 1079), &s), (false, true));
        assert_eq!(edge_of((2500, 40), &s), (false, false));
        assert_eq!(edge_of((100, 0), &s), (false, false));                 // autre écran
    }
}
