//! Lecture en cours sous Linux.
//!
//! Spotify (et VLC, navigateurs, mpv, Rhythmbox…) exposent leur lecture via MPRIS (D-Bus).
//! On l'interroge avec `playerctl` (paquet « playerctl » de toutes les distributions) : aucune clé API, aucun compte.
//! Les messages envoyés à l'interface ont exactement le même format que ceux du démon PowerShell de Windows
//! (évènement "halo-media", ligne "M|{json}"), donc le front est identique sur les deux systèmes.
//!
//! La pochette (`mpris:artUrl`) est téléchargée ici (https://… pour Spotify, file://… pour VLC et les navigateurs)
//! et envoyée en base64 : le front peut ainsi en extraire les couleurs sans problème de CORS.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Séparateur de champs dans la sortie de playerctl (caractère de contrôle : jamais présent dans un titre)
const SEP: &str = "\u{1f}";
const POLL_STEP_MS: u64 = 100;
const POLL_STEPS: u32 = 8; // une mise à jour toutes les ~800 ms, ou tout de suite après une commande
const MAX_ART_BYTES: u64 = 4 * 1024 * 1024;

static ONLY_SPOTIFY: AtomicBool = AtomicBool::new(false);
static RESEND_ART: AtomicBool = AtomicBool::new(false);
static KICK: AtomicBool = AtomicBool::new(false);
/// Instance MPRIS actuellement affichée (cible des boutons précédent / pause / suivant)
static CURRENT: Mutex<String> = Mutex::new(String::new());

struct Player {
    inst: String,
    status: String,
    pos: f64,
    dur: f64,
    title: String,
    artist: String,
    album: String,
    art_url: String,
}

// ---------- Interrogation de playerctl ----------

fn query() -> Result<Vec<Player>, String> {
    let fmt = [
        "{{playerInstance}}", "{{status}}", "{{position}}", "{{mpris:length}}",
        "{{xesam:title}}", "{{xesam:artist}}", "{{xesam:album}}", "{{mpris:artUrl}}",
    ].join(SEP);
    let out = Command::new("playerctl")
        .args(["-a", "metadata", "--format"])
        .arg(&fmt)
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();
    let out = match out {
        Ok(o) => o,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err("playerctl introuvable : installe-le (sudo apt install playerctl · pacman -S playerctl · dnf install playerctl)".into());
        }
        Err(e) => return Err(format!("playerctl : {e}")),
    };
    // Code de sortie 1 + rien sur stdout = aucun lecteur ouvert : ce n'est pas une erreur
    let text = String::from_utf8_lossy(&out.stdout);
    let mut list = Vec::new();
    for line in text.lines() {
        let f: Vec<&str> = line.split(SEP).collect();
        if f.len() < 8 { continue; }
        let micros = |s: &str| s.trim().parse::<f64>().unwrap_or(0.0) / 1_000_000.0;
        list.push(Player {
            inst: f[0].trim().to_string(),
            status: f[1].trim().to_string(),
            pos: micros(f[2]),
            dur: micros(f[3]),
            title: f[4].trim().to_string(),
            artist: f[5].trim().to_string(),
            album: f[6].trim().to_string(),
            art_url: f[7].trim().to_string(),
        });
    }
    Ok(list)
}

fn is_spotify(p: &Player) -> bool { p.inst.to_lowercase().contains("spotify") }

/// Plus petit = prioritaire : Spotify qui joue, puis tout ce qui joue, puis Spotify en pause, puis le reste en pause
fn rank(p: &Player) -> u8 {
    match (p.status.as_str(), is_spotify(p)) {
        ("Playing", true) => 0,
        ("Playing", false) => 1,
        ("Paused", true) => 2,
        ("Paused", false) => 3,
        (_, true) => 4,
        _ => 5,
    }
}

// ---------- Pochette ----------

struct ArtSlot { url: String, done: bool, mime: String, b64: String }
static ART: Mutex<Option<ArtSlot>> = Mutex::new(None);

/// Some((mime, base64)) quand la pochette de `url` est prête (base64 vide = introuvable) ; None tant qu'elle se télécharge.
/// Le téléchargement se fait dans un thread à part pour ne jamais bloquer la mise à jour du titre et de la position.
fn art_ready(url: &str) -> Option<(String, String)> {
    let mut g = ART.lock().ok()?;
    if let Some(s) = g.as_ref() {
        if s.url == url {
            return if s.done { Some((s.mime.clone(), s.b64.clone())) } else { None };
        }
    }
    *g = Some(ArtSlot { url: url.to_string(), done: false, mime: String::new(), b64: String::new() });
    drop(g);
    let u = url.to_string();
    std::thread::spawn(move || {
        let r = fetch_art(&u);
        if let Ok(mut g) = ART.lock() {
            if let Some(s) = g.as_mut() {
                if s.url == u {
                    s.done = true;
                    if let Some((m, b)) = r { s.mime = m; s.b64 = b; }
                }
            }
        }
    });
    None
}

fn fetch_art(url: &str) -> Option<(String, String)> {
    let (bytes, ctype): (Vec<u8>, Option<String>) = if let Some(path) = url.strip_prefix("file://") {
        (std::fs::read(percent_decode(path)).ok()?, None)
    } else if url.starts_with("http://") || url.starts_with("https://") {
        let resp = ureq::get(url).timeout(Duration::from_secs(8)).call().ok()?;
        let ct = resp.content_type().to_string();
        let mut buf = Vec::new();
        resp.into_reader().take(MAX_ART_BYTES).read_to_end(&mut buf).ok()?;
        (buf, Some(ct))
    } else {
        return None;
    };
    if bytes.is_empty() || bytes.len() as u64 >= MAX_ART_BYTES { return None; }
    let mime = sniff_mime(&bytes)
        .map(|m| m.to_string())
        .or_else(|| ctype.filter(|c| c.starts_with("image/")))
        .unwrap_or_else(|| "image/jpeg".to_string());
    Some((mime, STANDARD.encode(&bytes)))
}

/// Type réel de l'image d'après ses premiers octets (les serveurs et les lecteurs se trompent parfois)
fn sniff_mime(b: &[u8]) -> Option<&'static str> {
    if b.starts_with(&[0x89, b'P', b'N', b'G']) { Some("image/png") }
    else if b.starts_with(&[0xFF, 0xD8, 0xFF]) { Some("image/jpeg") }
    else if b.starts_with(b"GIF8") { Some("image/gif") }
    else if b.len() > 12 && &b[0..4] == b"RIFF" && &b[8..12] == b"WEBP" { Some("image/webp") }
    else { None }
}

/// "file:///home/moi/Ma%20musique/cover.jpg" → chemin lisible
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = ((b[i + 1] as char).to_digit(16), (b[i + 2] as char).to_digit(16)) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

// ---------- Boucle principale ----------

pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let mut art_sent_for = String::new(); // adresse de la pochette déjà envoyée au front
        let mut art_sent_key = String::new(); // morceau auquel elle correspond
        loop {
            let msg = match query() {
                Err(e) => serde_json::json!({ "on": false, "err": e, "sessions": [] }),
                Ok(all) => {
                    let sessions: Vec<String> = all.iter().map(|p| p.inst.clone()).collect();
                    let only = ONLY_SPOTIFY.load(Ordering::Relaxed);
                    let best = all.iter()
                        .filter(|p| !(p.title.is_empty() && p.status == "Stopped"))
                        .filter(|p| !only || is_spotify(p))
                        .min_by_key(|p| rank(p));
                    match best {
                        None => {
                            if let Ok(mut c) = CURRENT.lock() { c.clear(); }
                            serde_json::json!({ "on": false, "err": "", "sessions": sessions })
                        }
                        Some(p) => {
                            if let Ok(mut c) = CURRENT.lock() { *c = p.inst.clone(); }
                            let key = format!("{}|{}|{}", p.title, p.artist, p.album);
                            if RESEND_ART.swap(false, Ordering::Relaxed) { art_sent_for.clear(); }
                            if key != art_sent_key { art_sent_key = key.clone(); art_sent_for.clear(); }
                            let mut j = serde_json::json!({
                                "on": true,
                                "app": p.inst,
                                "key": key,
                                "title": p.title,
                                "artist": p.artist,
                                "album": p.album,
                                "playing": p.status == "Playing",
                                "pos": (p.pos * 10.0).round() / 10.0,
                                "dur": (p.dur * 10.0).round() / 10.0,
                            });
                            // La pochette n'est envoyée qu'une fois par morceau (le front la garde ensuite)
                            if art_sent_for != p.art_url {
                                if p.art_url.is_empty() {
                                    j["art"] = serde_json::json!("");
                                    art_sent_for = p.art_url.clone();
                                } else if let Some((mime, b64)) = art_ready(&p.art_url) {
                                    j["art"] = serde_json::json!(b64);
                                    j["mime"] = serde_json::json!(mime);
                                    art_sent_for = p.art_url.clone();
                                }
                            }
                            j
                        }
                    }
                }
            };
            let _ = app.emit("halo-media", format!("M|{msg}"));
            for _ in 0..POLL_STEPS {
                if KICK.swap(false, Ordering::Relaxed) { break; }
                std::thread::sleep(Duration::from_millis(POLL_STEP_MS));
            }
        }
    });
}

// ---------- Commandes (précédent / pause / suivant / position) ----------

pub fn control(action: &str, value: Option<f64>) {
    match action {
        "only" => {
            ONLY_SPOTIFY.store(value.unwrap_or(0.0) > 0.5, Ordering::Relaxed);
            KICK.store(true, Ordering::Relaxed);
            return;
        }
        "resend" => {
            RESEND_ART.store(true, Ordering::Relaxed);
            KICK.store(true, Ordering::Relaxed);
            return;
        }
        _ => {}
    }
    let args: Vec<String> = match action {
        "toggle" => vec!["play-pause".into()],
        "next" => vec!["next".into()],
        "prev" => vec!["previous".into()],
        "seek" => vec!["position".into(), format!("{:.1}", value.unwrap_or(0.0).max(0.0))],
        _ => return,
    };
    let inst = CURRENT.lock().map(|g| (*g).clone()).unwrap_or_default();
    std::thread::spawn(move || {
        let mut c = Command::new("playerctl");
        if !inst.is_empty() { c.arg("-p").arg(&inst); }
        c.args(&args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        let _ = c.status();
        KICK.store(true, Ordering::Relaxed); // rafraîchit l'affichage tout de suite
    });
}
