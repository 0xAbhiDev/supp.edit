//! Deterministic PNG frame stream + original audio -> an atomic MP4 output.
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Stdio},
    thread::JoinHandle,
};
use supp_project::{Asset, Clip, Composition, Project, Track};
mod remap_audio;

#[derive(Debug)]
struct AudioSegment<'a> {
    asset: &'a Asset,
    source_start: f64,
    duration: f64,
    output_start: f64,
    gain: f64,
    remap: Option<(&'a Clip, f64, f64)>,
}

#[derive(Clone, Copy)]
struct AudioWindow {
    // All times are seconds. origin maps this scene's zero to root time;
    // start/end are the visible interval in root time after ancestor trimming.
    origin: f64,
    start: f64,
    end: f64,
    gain: f64,
}

struct AudioCollector<'a> {
    assets: HashMap<&'a str, &'a Asset>,
    compositions: HashMap<&'a str, &'a Composition>,
    segments: Vec<AudioSegment<'a>>,
    visited: usize,
}
impl<'a> AudioCollector<'a> {
    fn scene(
        &mut self,
        tracks: &[Track],
        layers: &'a [Clip],
        rate: f64,
        window: AudioWindow,
        depth: usize,
    ) -> Result<(), String> {
        if depth > 16 {
            return Err("Composition audio nesting exceeds 16 levels".into());
        }
        let solo = tracks.iter().any(|t| t.solo);
        let tracks: HashMap<_, _> = tracks.iter().map(|t| (t.id.as_str(), t)).collect();
        for c in layers {
            self.visited += 1;
            // A bounded source DAG can still expand into exponentially many
            // instances. Fail explicitly instead of hanging or dropping audio.
            if self.visited > 100000 {
                return Err("Nested audio exceeds 100000 expanded layers per render".into());
            }
            let track = tracks
                .get(c.track_id.as_str())
                .ok_or("Audio layer references missing track")?;
            if track.muted || (solo && !track.solo) || (track.kind == "video" && track.hidden) {
                continue;
            }
            let clip_start = window.origin + c.start as f64 / rate;
            let start = window.start.max(clip_start);
            let end = window.end.min(clip_start + c.duration as f64 / rate);
            if end <= start {
                continue;
            }
            let gain = window.gain + c.gain;
            if c.kind == "composition" {
                let composition = c
                    .composition_id
                    .as_deref()
                    .and_then(|id| self.compositions.get(id).copied())
                    .ok_or("Audio layer references missing composition")?;
                // sourceIn is measured in the containing scene's frames, not
                // the source composition's frames. Seconds preserve mixed FPS.
                let origin = clip_start - c.source_in as f64 / rate;
                let child_rate = composition.settings.fps.value();
                let end = end.min(origin + composition.duration as f64 / child_rate);
                if end > start {
                    self.scene(
                        &composition.tracks,
                        &composition.layers,
                        child_rate,
                        AudioWindow {
                            origin,
                            start,
                            end,
                            gain,
                        },
                        depth + 1,
                    )?;
                }
            } else if c.kind == "media" {
                let asset = c
                    .asset_id
                    .as_deref()
                    .and_then(|id| self.assets.get(id).copied())
                    .ok_or("Audio layer references missing asset")?;
                if !asset.has_audio || asset.kind == "image" {
                    continue;
                }
                let local_start = (start - clip_start) * rate;
                let source_start = c.source_frame(local_start) / rate;
                let duration = if c.time_remap.is_some() {
                    end - start
                } else {
                    (end - start).min(asset.duration - source_start)
                };
                if duration <= 0. {
                    continue;
                }
                if self.segments.len() >= 128 {
                    return Err("This exporter supports at most 128 audible clips per render (including nested compositions)".into());
                }
                self.segments.push(AudioSegment {
                    asset,
                    source_start,
                    duration,
                    output_start: start,
                    gain,
                    remap: c.time_remap.as_ref().map(|_| (c, local_start, rate)),
                });
            }
        }
        Ok(())
    }
}

fn collect_audio(p: &Project) -> Result<Vec<AudioSegment<'_>>, String> {
    let mut collector = AudioCollector {
        assets: p.assets.iter().map(|a| (a.id.as_str(), a)).collect(),
        compositions: p.compositions.iter().map(|c| (c.id.as_str(), c)).collect(),
        segments: Vec::new(),
        visited: 0,
    };
    let rate = p.settings.fps.value();
    collector.scene(
        &p.tracks,
        &p.clips,
        rate,
        AudioWindow {
            origin: 0.,
            start: 0.,
            end: p.duration() as f64 / rate,
            gain: 0.,
        },
        0,
    )?;
    Ok(collector.segments)
}

fn audio_filter(index: usize, segment: &AudioSegment<'_>) -> String {
    // FFmpeg's S suffix delays by samples rather than rounded milliseconds.
    let delay = (segment.output_start * 48000.).round() as u64;
    format!("[{index}:a:0]aresample=48000,asetpts=PTS-STARTPTS,atrim=duration={:.9},volume={:.9}dB,adelay={delay}S:all=1[a{index}]", segment.duration, segment.gain)
}
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
    _audio_temps: Vec<tempfile::TempPath>,
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
        let rate = p.settings.fps.value();
        let mut filters = vec![];
        let mut audio = vec![];
        let mut audio_temps = vec![];
        for segment in collect_audio(p)? {
            let path = supp_media::validate_path(std::path::Path::new(&segment.asset.path))?;
            let i = audio.len() + 1;
            if let Some((clip, local_start, rate)) = segment.remap {
                let path = remap_audio::render(&path, clip, local_start, rate, segment.duration)?;
                cmd.args(["-f", "f32le", "-ar", "48000", "-ac", "2", "-i"])
                    .arg(&path);
                audio_temps.push(path);
            } else {
                cmd.args([
                    "-ss",
                    &format!("{:.9}", segment.source_start),
                    "-t",
                    &format!("{:.9}", segment.duration),
                    "-protocol_whitelist",
                    "file,pipe",
                    "-i",
                ])
                .arg(path);
            }
            filters.push(audio_filter(i, &segment));
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
            _audio_temps: audio_temps,
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

#[cfg(test)]
mod audio_tests {
    use super::*;
    #[test]
    fn nested_audio_preserves_seconds_trims_and_gain() {
        let p: Project = serde_json::from_str(include_str!(
            "../../supp-project/tests/fixtures/compositor-v3.supp"
        ))
        .unwrap();
        p.validate().unwrap();
        let segments = collect_audio(&p).unwrap();
        assert_eq!(segments.len(), 1);
        let s = &segments[0];
        assert!((s.source_start - 1.).abs() < 1e-8);
        assert!((s.output_start - 1.).abs() < 1e-8);
        assert!((s.duration - 2.5).abs() < 1e-8);
        assert!((s.gain + 9.).abs() < 1e-8);
        assert!(audio_filter(1, s).contains("adelay=48000S"));
    }
    #[test]
    fn ancestor_mute_and_solo_suppress_nested_audio() {
        let mut p: Project = serde_json::from_str(include_str!(
            "../../supp-project/tests/fixtures/compositor-v3.supp"
        ))
        .unwrap();
        p.tracks
            .iter_mut()
            .find(|t| t.id == p.clips[0].track_id)
            .unwrap()
            .muted = true;
        assert!(collect_audio(&p).unwrap().is_empty());
        p.tracks.iter_mut().for_each(|t| {
            t.muted = false;
            t.solo = t.id != p.clips[0].track_id;
        });
        assert!(collect_audio(&p).unwrap().is_empty());
    }
}
