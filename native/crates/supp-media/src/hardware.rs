//! Inventory and bounded, real codec smoke probes. Advertised != usable.
use serde::Serialize;
use std::{
    io::Read,
    process::Stdio,
    time::{Duration, Instant},
};
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Machine {
    pub gpus: Vec<Gpu>,
    pub ram_bytes: Option<u64>,
    pub probes: Vec<Probe>,
    pub inventory_error: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub dedicated_bytes: u64,
    pub shared_bytes: u64,
    pub software: bool,
}
#[derive(Clone, Serialize)]
pub struct Probe {
    pub name: String,
    pub kind: String,
    pub advertised: bool,
    pub available: bool,
    pub detail: String,
}
#[cfg(windows)]
fn inventory() -> Machine {
    use windows::Win32::{
        Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE},
        System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX},
    };
    let mut machine = Machine::default();
    // DXGI returns adapter-owned descriptors by value; no raw interface pointers escape.
    unsafe {
        let mut memory = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        if GlobalMemoryStatusEx(&mut memory).is_ok() {
            machine.ram_bytes = Some(memory.ullTotalPhys);
        }
        match CreateDXGIFactory1::<IDXGIFactory1>() {
            Ok(factory) => {
                let mut i = 0;
                while let Ok(adapter) = factory.EnumAdapters1(i) {
                    match adapter.GetDesc1() {
                        Ok(d) => machine.gpus.push(Gpu {
                            name: String::from_utf16_lossy(&d.Description)
                                .trim_end_matches('\0')
                                .into(),
                            dedicated_bytes: d.DedicatedVideoMemory as u64,
                            shared_bytes: d.SharedSystemMemory as u64,
                            software: d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0,
                        }),
                        Err(e) => machine.inventory_error = Some(e.to_string()),
                    }
                    i += 1;
                }
            }
            Err(e) => machine.inventory_error = Some(e.to_string()),
        }
    }
    machine
}
#[cfg(not(windows))]
fn inventory() -> Machine {
    Machine {
        inventory_error: Some(
            "Native GPU inventory is currently implemented on Windows only".into(),
        ),
        ..Default::default()
    }
}

fn run(args: &[&str]) -> Result<(), String> {
    let mut child = crate::command("ffmpeg")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stderr = child.stderr.take().ok_or("No diagnostic stream")?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = stderr.take(32768).read_to_string(&mut text);
        text
    });
    let start = Instant::now();
    let result = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("Codec probe failed".to_string())
                }
            }
            Err(e) => break Err(e.to_string()),
            _ => {}
        }
        if start.elapsed() > Duration::from_secs(8) {
            let _ = child.kill();
            let _ = child.wait();
            break Err("Timed out after 8 seconds".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let _ = child.kill();
    let _ = child.wait();
    let log = reader.join().unwrap_or_default();
    result.map_err(|error| {
        if log.trim().is_empty() {
            error
        } else {
            format!(
                "{error}: {}",
                log.trim().chars().take(1600).collect::<String>()
            )
        }
    })
}
pub fn probe(encoders: &[String], apis: &[String]) -> Machine {
    let mut machine = inventory();
    for codec in ["h264_nvenc", "h264_qsv", "h264_amf"] {
        let advertised = encoders.iter().any(|c| c == codec);
        let result = if advertised {
            run(&[
                "-v",
                "error",
                "-nostdin",
                "-f",
                "lavfi",
                "-i",
                "color=c=black:s=320x180:r=30",
                "-frames:v",
                "3",
                "-an",
                "-c:v",
                codec,
                "-f",
                "null",
                "-",
            ])
        } else {
            Err("Not compiled into this FFmpeg build".into())
        };
        machine.probes.push(Probe {
            name: codec.into(),
            kind: "encode".into(),
            advertised,
            available: result.is_ok(),
            detail: result
                .err()
                .unwrap_or_else(|| "Encoded three H.264 test frames on this machine".into()),
        });
    }
    let temp = tempfile::Builder::new().suffix(".mp4").tempfile();
    if let Ok(temp) = temp {
        let file = temp.path().to_string_lossy().to_string();
        let prepared = run(&[
            "-v",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=s=320x180:r=30",
            "-frames:v",
            "3",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            &file,
        ]);
        for (api, format, decoder) in [
            ("cuda", "cuda", "h264"),
            ("qsv", "qsv", "h264_qsv"),
            ("d3d11va", "d3d11", "h264"),
        ] {
            let advertised = apis.iter().any(|v| v == api);
            let result = if !advertised {
                Err("Not compiled into this FFmpeg build".into())
            } else if prepared.is_err() {
                Err("Decode fixture could not be encoded with libx264".into())
            } else {
                run(&[
                    "-v",
                    "error",
                    "-nostdin",
                    "-hwaccel",
                    api,
                    "-hwaccel_output_format",
                    format,
                    "-c:v",
                    decoder,
                    "-i",
                    &file,
                    "-vf",
                    "hwdownload,format=nv12",
                    "-frames:v",
                    "3",
                    "-an",
                    "-f",
                    "null",
                    "-",
                ])
            };
            machine.probes.push(Probe{name:api.into(),kind:"decode".into(),advertised,available:result.is_ok(),detail:result.err().unwrap_or_else(||"Decoded and downloaded three H.264 hardware frames; other codecs/resolutions are not certified".into())});
        }
    } else {
        machine.inventory_error = Some("Could not create hardware decode test fixture".into());
    }
    machine
}
