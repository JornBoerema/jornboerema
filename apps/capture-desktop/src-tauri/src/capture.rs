//! Taking screenshots. Everything platform-specific stays behind these functions,
//! so the capture backend (xcap today) can be swapped per OS later.

use xcap::image::{codecs::png::{CompressionType, FilterType, PngEncoder}, ImageEncoder, RgbaImage};
use xcap::Monitor;

pub struct Capture {
    pub image: RgbaImage,
    /// PNG of `image`, encoded once and reused for the editor, saving and the clipboard.
    pub png: Vec<u8>,
    /// Physical pixels per logical point of the captured monitor (2.0 on Retina).
    pub scale_factor: f32,
}

/// The monitor under a point in global screen coordinates (logical points on
/// macOS, physical pixels on Windows; see `screen_point` in lib.rs), or the
/// primary one.
fn monitor_at(x: f64, y: f64) -> Result<Monitor, String> {
    let monitors = Monitor::all().map_err(|e| e.to_string())?;
    let contains = |m: &Monitor| -> bool {
        let (Ok(mx), Ok(my), Ok(w), Ok(h)) = (m.x(), m.y(), m.width(), m.height()) else { return false };
        x >= mx as f64 && y >= my as f64 && x < (mx as f64 + w as f64) && y < (my as f64 + h as f64)
    };
    monitors
        .iter()
        .find(|m| contains(m))
        .or_else(|| monitors.iter().find(|m| m.is_primary().unwrap_or(false)))
        .or_else(|| monitors.first())
        .cloned()
        .ok_or_else(|| "No monitor found".to_string())
}

pub fn encode_png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::Adaptive)
        .write_image(image.as_raw(), image.width(), image.height(), xcap::image::ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(png)
}

fn capture_monitor(monitor: &Monitor) -> Result<Capture, String> {
    let scale_factor = monitor.scale_factor().unwrap_or(1.0);
    let image = monitor.capture_image().map_err(|e| e.to_string())?;
    let png = encode_png(&image)?;
    Ok(Capture { image, png, scale_factor })
}

/// Captures the whole monitor the cursor is on (global screen coordinates).
pub fn fullscreen(cursor: (f64, f64)) -> Result<Capture, String> {
    capture_monitor(&monitor_at(cursor.0, cursor.1)?)
}

/// Captures the monitor at a point (e.g. the centre of a Tauri monitor).
pub fn monitor_containing(x: f64, y: f64) -> Result<Capture, String> {
    capture_monitor(&monitor_at(x, y)?)
}

/// Cuts a region (in the capture's own pixels) out of a capture.
pub fn crop(capture: &Capture, x: u32, y: u32, width: u32, height: u32) -> Result<Capture, String> {
    let (w, h) = (capture.image.width(), capture.image.height());
    let x = x.min(w.saturating_sub(1));
    let y = y.min(h.saturating_sub(1));
    let width = width.clamp(1, w - x);
    let height = height.clamp(1, h - y);
    let image = xcap::image::imageops::crop_imm(&capture.image, x, y, width, height).to_image();
    let png = encode_png(&image)?;
    Ok(Capture { image, png, scale_factor: capture.scale_factor })
}

/// A window that can be picked, in the OS's global screen coordinates
/// (logical points on macOS, physical pixels on Windows).
#[derive(Clone, Debug)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub app: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// System surfaces that are "windows" to the OS but not to people.
const SYSTEM_APPS: &[&str] = &["Window Server", "Dock", "Control Center", "SystemUIServer", "Notification Center", "WindowManager"];
const MIN_WINDOW_SIZE: u32 = 40;

/// Visible application windows, front to back, excluding our own.
pub fn list_windows() -> Vec<WindowInfo> {
    let own_pid = std::process::id();
    let Ok(windows) = xcap::Window::all() else { return Vec::new() };
    windows
        .iter()
        .filter_map(|window| {
            let (id, pid, app) = (window.id().ok()?, window.pid().ok()?, window.app_name().unwrap_or_default());
            let (width, height) = (window.width().ok()?, window.height().ok()?);
            let hidden = window.is_minimized().unwrap_or(false);
            if pid == own_pid || hidden || SYSTEM_APPS.contains(&app.as_str()) || width < MIN_WINDOW_SIZE || height < MIN_WINDOW_SIZE {
                return None;
            }
            Some(WindowInfo {
                id,
                title: window.title().unwrap_or_default(),
                app,
                x: window.x().ok()? as f64,
                y: window.y().ok()? as f64,
                width: width as f64,
                height: height as f64,
            })
        })
        .collect()
}

/// Captures one window by id, including the parts hidden behind other windows.
#[cfg_attr(target_os = "macos", allow(dead_code))]
pub fn window(id: u32) -> Result<Capture, String> {
    let windows = xcap::Window::all().map_err(|e| e.to_string())?;
    let window = windows.into_iter().find(|w| w.id().ok() == Some(id)).ok_or("Window not found")?;
    let scale_factor = window.current_monitor().and_then(|m| m.scale_factor()).unwrap_or(1.0);
    let image = window.capture_image().map_err(|e| e.to_string())?;
    let png = encode_png(&image)?;
    Ok(Capture { image, png, scale_factor })
}

/// macOS asks for "Screen Recording" permission; without it captures are blank.
#[cfg(target_os = "macos")]
pub mod permission {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }
    pub fn granted() -> bool {
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    /// Shows the system prompt the first time; afterwards it only returns false.
    pub fn request() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }
}

#[cfg(not(target_os = "macos"))]
pub mod permission {
    pub fn granted() -> bool {
        true
    }
    pub fn request() -> bool {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{crop, encode_png, Capture};
    use xcap::image::{Rgba, RgbaImage};

    fn sample(width: u32, height: u32) -> Capture {
        let image = RgbaImage::from_fn(width, height, |x, y| Rgba([x as u8, y as u8, 0, 255]));
        let png = encode_png(&image).unwrap();
        Capture { image, png, scale_factor: 2.0 }
    }

    #[test]
    fn crops_the_requested_region() {
        let cropped = crop(&sample(100, 80), 10, 20, 30, 40).unwrap();
        assert_eq!((cropped.image.width(), cropped.image.height()), (30, 40));
        assert_eq!(cropped.image.get_pixel(0, 0), &Rgba([10, 20, 0, 255]));
        assert_eq!(cropped.scale_factor, 2.0);
    }

    #[test]
    fn clamps_selections_that_run_off_the_image() {
        let cropped = crop(&sample(100, 80), 90, 70, 50, 50).unwrap();
        assert_eq!((cropped.image.width(), cropped.image.height()), (10, 10));
        let outside = crop(&sample(100, 80), 500, 500, 10, 10).unwrap();
        assert_eq!((outside.image.width(), outside.image.height()), (1, 1));
    }

    /// Needs a real display (and Screen Recording permission on macOS):
    /// `cargo test -- --ignored` writes the capture to the temp folder.
    /// Prints the pickable windows (front to back); needs a real display.
    #[test]
    #[ignore]
    fn lists_windows() {
        for w in super::list_windows().iter().take(8) {
            println!("{:>6} {:<24} {:>6.0},{:>6.0} {:>5.0}x{:<5.0}", w.id, w.app, w.x, w.y, w.width, w.height);
        }
    }

    #[test]
    #[ignore]
    fn captures_the_primary_monitor() {
        let capture = super::fullscreen((0.0, 0.0)).expect("capture");
        assert!(capture.image.width() > 0 && capture.image.height() > 0);
        assert!(capture.png.starts_with(&[0x89, b'P', b'N', b'G']));
        let path = std::env::temp_dir().join("even-vastleggen-test.png");
        std::fs::write(&path, &capture.png).unwrap();
        println!("{}x{} @{} -> {}", capture.image.width(), capture.image.height(), capture.scale_factor, path.display());
    }
}
