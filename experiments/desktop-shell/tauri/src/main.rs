// The smallest Tauri shell around an unmodified Stims: one window on a local URL,
// plus a Core Audio tap whose PCM answers the page's Microphone request. The
// control port and probe exist for the spike and need STIMS_SPIKE_* to be set.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod system_audio;

use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use tauri::utils::config::BackgroundThrottlingPolicy;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let page = env("STIMS_URL").unwrap_or("http://localhost:5991/?agent=true".into());

            // The tap comes first: the page's shim needs its sample rate.
            let (pcm_sender, pcm_receiver) = std::sync::mpsc::channel::<(f64, String)>();
            let rate = if env("STIMS_SPIKE_NO_AUDIO").is_some() {
                48000.0
            } else {
                system_audio::start(move |at, pcm| {
                    let _ = pcm_sender.send((at, pcm));
                })
                .unwrap_or_else(|error| {
                    eprintln!("system audio unavailable: {error}");
                    48000.0
                })
            };

            let mut script = format!("window.__STIMS_NATIVE_RATE__ = {rate};\n");
            if let Some(collector) = env("STIMS_SPIKE_COLLECTOR") {
                let shell = env("STIMS_SPIKE_SHELL").unwrap_or("tauri".into());
                script += &format!(
                    "window.__STIMS_SPIKE__ = {{collector: '{collector}', shell: '{shell}'}};\n"
                );
                let probe = env("STIMS_SPIKE_PROBE").expect("STIMS_SPIKE_PROBE must be its path");
                script += &std::fs::read_to_string(probe).expect("cannot read the probe");
            }
            script += include_str!("../../shared/pcm-shim.js");

            let mut builder = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(page.parse().expect("STIMS_URL must be a URL")),
            )
            .title("Stims (Tauri spike)")
            .inner_size(800.0, 472.0)
            .focused(false)
            .initialization_script(&script);
            if let (Some(x), Some(y)) = (env("STIMS_SPIKE_X"), env("STIMS_SPIKE_Y")) {
                builder = builder.position(x.parse().unwrap(), y.parse().unwrap());
            }
            if env("STIMS_SPIKE_ON_TOP").as_deref() == Some("1") {
                builder = builder.always_on_top(true);
            }
            if env("STIMS_SPIKE_KEEP_RENDERING").as_deref() == Some("1") {
                builder = builder.background_throttling(BackgroundThrottlingPolicy::Disabled);
            }
            if let Some(agent) = env("STIMS_SPIKE_USER_AGENT") {
                builder = builder.user_agent(&agent);
            }
            let window = builder.build()?;

            // WKWebView stops scheduling frames for a covered window unless this
            // private switch is off. Spike-only: a private API cannot ship.
            if env("STIMS_SPIKE_NO_OCCLUSION").is_some() {
                let _ = window.with_webview(|webview| unsafe {
                    let view = webview.inner() as *mut objc2::runtime::AnyObject;
                    let selector = objc2::sel!(_setWindowOcclusionDetectionEnabled:);
                    let supported: bool = objc2::msg_send![view, respondsToSelector: selector];
                    eprintln!("occlusion switch available: {supported}");
                    if supported {
                        let _: () =
                            objc2::msg_send![view, _setWindowOcclusionDetectionEnabled: false];
                    }
                });
            }

            let pcm_window = window.clone();
            std::thread::spawn(move || {
                for (at, pcm) in pcm_receiver {
                    let _ = pcm_window.eval(format!("window.__stimsNativePcm?.({at},'{pcm}')"));
                }
            });

            if let Some(port) = env("STIMS_SPIKE_CONTROL") {
                let handle = app.handle().clone();
                std::thread::spawn(move || control(handle, port.parse().unwrap()));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run the shell");
}

/// Spike-only window control, answering the same routes as the Electron shell.
fn control(app: AppHandle, port: u16) {
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("control port taken");
    for stream in listener.incoming().flatten() {
        let mut reader = BufReader::new(stream);
        let mut request_line = String::new();
        if reader.read_line(&mut request_line).is_err() {
            continue;
        }
        let path = request_line.split_whitespace().nth(1).unwrap_or("/").to_string();
        let mut length = 0usize;
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header).is_err() || header.trim().is_empty() {
                break;
            }
            let lower = header.to_lowercase();
            if let Some(value) = lower.strip_prefix("content-length:") {
                length = value.trim().parse().unwrap_or(0);
            }
        }
        let mut body = vec![0u8; length];
        let _ = reader.read_exact(&mut body);
        let window = app.get_webview_window("main").expect("no window");
        let mut result = String::from("ok");
        match path.as_str() {
            "/show" => drop(window.show()),
            "/hide" => drop(window.hide()),
            "/minimize" => drop(window.minimize()),
            "/restore" => {
                let _ = window.unminimize();
                let _ = window.show();
            }
            "/app-hide" => drop(app.hide()),
            "/app-show" => drop(app.show()),
            "/gesture-eval" => {
                let _ = window.eval(String::from_utf8_lossy(&body).to_string());
            }
            "/versions" => {
                result = format!("{{\"tauri\":\"{}\"}}", tauri::VERSION);
            }
            "/quit" => {
                let mut stream = reader.into_inner();
                let _ = write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\nbye");
                app.exit(0);
                return;
            }
            _ => result = "unknown".into(),
        }
        let mut stream = reader.into_inner();
        let _ = write!(
            stream,
            "HTTP/1.1 200 OK\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
            result.len(),
            result
        );
    }
}
