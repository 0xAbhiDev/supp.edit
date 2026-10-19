//! Deterministic PNG frame stream + original audio -> an atomic MP4 output.
use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Stdio},
    thread::JoinHandle,
};
use supp_project::Project;
pub struct Encoder {
    child: Child,
    stdin: Option<ChildStdin>,
    log: Option<JoinHandle<String>>,
    temp: Option<tempfile::TempPath>,
    output: PathBuf,
    width: u32,
    height: u32,
    expected: u32,
    received: u32,
}
impl Encoder {
    pub fn start(p: &Project, output: PathBuf) -> Result<Self, String> {
        p.validate().map_err(|e| e.to_string())?;
        if p.duration() == 0 {
            return Err("Add clips before exporting".into());
        }
        if !p.settings.width.is_multiple_of(2) || !p.settings.height.is_multiple_of(2) {
            return Err("H.264 requires even output dimensions".into());
        }
        let temp = tempfile::Builder::new()
            .prefix(".supp-render-")
            .suffix(".mp4")
            .tempfile_in(output.parent().ok_or("Output has no parent")?)
            .map_err(|e| e.to_string())?
            .into_temp_path();
        let mut cmd = supp_media::command("ffmpeg");
        cmd.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-f",
            "image2pipe",
            "-framerate",
            &format!("{}/{}", p.settings.fps.num, p.settings.fps.den),
            "-vcodec",
            "png",
            "-i",
            "pipe:0",
        ]);
        let solo = p.tracks.iter().any(|t| t.solo);
        let rate = p.settings.fps.value();
        let mut filters = vec![];
        let mut audio = vec![];
        for c in &p.clips {
            let t = p.tracks.iter().find(|t| t.id == c.track_id).unwrap();
            if t.muted || (solo && !t.solo) || (t.kind == "video" && t.hidden) {
                continue;
            }
            let Some(a) = p
                .assets
                .iter()
                .find(|a| Some(&a.id) == c.asset_id.as_ref())
                .filter(|a| a.has_audio)
            else {
                continue;
            };
            if audio.len() >= 128 {
                return Err("This exporter supports at most 128 audible clips per render".into());
            }
            let path = supp_media::validate_path(std::path::Path::new(&a.path))?;
            let i = audio.len() + 1;
            cmd.args([
                "-ss",
                &format!("{:.9}", c.source_in as f64 / rate),
                "-t",
                &format!("{:.9}", c.duration as f64 / rate),
                "-protocol_whitelist",
                "file,pipe",
                "-i",
            ])
            .arg(path);
            filters.push(format!(
                "[{i}:a:0]aresample=48000,asetpts=PTS-STARTPTS,volume={}dB,adelay={}:all=1[a{i}]",
                c.gain,
                (c.start as f64 / rate * 1000.).round() as u64
            ));
            audio.push(format!("[a{i}]"));
        }
        if audio.is_empty() {
            cmd.args([
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=48000:cl=stereo",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
            ]);
        } else {
            filters.push(format!("{}amix=inputs={}:normalize=0:duration=longest,alimiter=limit=0.95:latency=1,apad[aout]",audio.join(""),audio.len()));
            cmd.args([
                "-filter_complex",
                &filters.join(";"),
                "-map",
                "0:v:0",
                "-map",
                "[aout]",
            ]);
        }
        cmd.args([
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-t",
            &format!("{:.9}", p.duration() as f64 / rate),
            "-movflags",
            "+faststart",
        ])
        .arg(&*temp)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Cannot start FFmpeg: {e}"))?;
        let stdin = child.stdin.take();
        let mut stderr = child.stderr.take().ok_or("No encoder stderr")?;
        let log = std::thread::spawn(move || {
            let mut tail = Vec::new();
            let mut chunk = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut chunk) {
                if n == 0 {
                    break;
                }
                tail.extend_from_slice(&chunk[..n]);
                if tail.len() > 65536 {
                    tail.drain(..tail.len() - 65536);
                }
            }
            String::from_utf8_lossy(&tail).into_owned()
        });
        Ok(Self {
            child,
            stdin,
            log: Some(log),
            temp: Some(temp),
            output,
            width: p.settings.width,
            height: p.settings.height,
            expected: p.duration(),
            received: 0,
        })
    }
    pub fn frame(&mut self, png: &[u8]) -> Result<(), String> {
        if png.len() < 24 || png.len() > 128 * 1024 * 1024 || &png[..8] != b"\x89PNG\r\n\x1a\n" {
            return Err("Invalid PNG frame".into());
        }
        if u32::from_be_bytes(png[16..20].try_into().unwrap()) != self.width
            || u32::from_be_bytes(png[20..24].try_into().unwrap()) != self.height
        {
            return Err("Frame dimensions differ from project".into());
        }
        if self.received >= self.expected {
            return Err("Too many frames".into());
        }
        self.stdin
            .as_mut()
            .ok_or("Encoder is closed")?
            .write_all(png)
            .map_err(|e| format!("Encoder stopped accepting frames: {e}"))?;
        self.received += 1;
        Ok(())
    }
    pub fn finish(mut self) -> Result<PathBuf, String> {
        if self.received != self.expected {
            return Err(format!(
                "Incomplete render: {}/{} frames",
                self.received, self.expected
            ));
        }
        self.stdin.take();
        let status = self.child.wait().map_err(|e| e.to_string())?;
        let log = self
            .log
            .take()
            .and_then(|h| h.join().ok())
            .unwrap_or_default();
        if !status.success() {
            return Err(format!("FFmpeg failed: {log}"));
        }
        let temp = self.temp.take().ok_or("Missing render file")?;
        if fs::metadata(&*temp).map_err(|e| e.to_string())?.len() == 0 {
            return Err("Encoder produced an empty file".into());
        }
        temp.persist(&self.output).map_err(|e| e.to_string())?;
        Ok(self.output.clone())
    }
}
impl Drop for Encoder {
    fn drop(&mut self) {
        self.stdin.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(h) = self.log.take() {
            let _ = h.join();
        }
    }
}
