use std::path::PathBuf;
use std::sync::mpsc;

use tauri::WebviewWindow;

pub fn hide_offscreen(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    if let Ok(ns_window) = window.ns_window() {
        let ns_window = ns_window as *mut objc2::runtime::AnyObject;
        unsafe {
            let _: () = objc2::msg_send![ns_window, setAlphaValue: 0.0f64];
            let _: () = objc2::msg_send![ns_window, setIgnoresMouseEvents: true];
        }
    }
    #[cfg(target_os = "linux")]
    if let Ok(gtk_window) = window.gtk_window() {
        use gtk::prelude::{GtkWindowExt, WidgetExt};
        gtk_window.set_opacity(0.0);
        gtk_window.set_accept_focus(false);
    }
}

pub fn capture(window: &WebviewWindow, target: PathBuf) -> Result<(), String> {
    let (done, finished) = mpsc::channel::<Result<(), String>>();
    window
        .with_webview(move |webview| platform_capture(webview, target, done))
        .map_err(|e| format!("cannot reach the render window: {e}"))?;
    finished
        .recv()
        .map_err(|_| "the screenshot never finished".to_string())?
}

#[cfg(target_os = "macos")]
fn platform_capture(
    webview: tauri::webview::PlatformWebview,
    target: PathBuf,
    done: mpsc::Sender<Result<(), String>>,
) {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    let view: &WKWebView = unsafe { &*(webview.inner() as *const WKWebView) };
    let handler = block2::RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
        let result = unsafe { image.as_ref() }
            .ok_or_else(|| "WebKit returned no screenshot".to_string())
            .and_then(|image| {
                let tiff = image
                    .TIFFRepresentation()
                    .ok_or("the screenshot has no pixels")?;
                let bitmap =
                    NSBitmapImageRep::imageRepWithData(&tiff).ok_or("cannot read the screenshot")?;
                let png = unsafe {
                    bitmap.representationUsingType_properties(
                        NSBitmapImageFileType::PNG,
                        &NSDictionary::new(),
                    )
                }
                .ok_or("cannot encode the screenshot")?;
                std::fs::write(&target, png.to_vec())
                    .map_err(|e| format!("cannot write {}: {e}", target.display()))
            });
        let _ = done.send(result);
    });
    unsafe { view.takeSnapshotWithConfiguration_completionHandler(None, &handler) };
}

#[cfg(target_os = "linux")]
fn platform_capture(
    webview: tauri::webview::PlatformWebview,
    target: PathBuf,
    done: mpsc::Sender<Result<(), String>>,
) {
    use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};

    webview.inner().snapshot(
        SnapshotRegion::Visible,
        SnapshotOptions::NONE,
        None::<&webkit2gtk::gio::Cancellable>,
        move |result| {
            let written = result
                .map_err(|e| format!("WebKit returned no screenshot: {e}"))
                .and_then(|surface| {
                    let mut file = std::fs::File::create(&target)
                        .map_err(|e| format!("cannot write {}: {e}", target.display()))?;
                    surface
                        .write_to_png(&mut file)
                        .map_err(|e| format!("cannot encode the screenshot: {e}"))
                });
            let _ = done.send(written);
        },
    );
}
