use std::{
    io::Read,
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
/// Bound both process lifetime and captured output, including malformed-media probes.
pub fn capture(
    command: &mut Command,
    timeout: Duration,
    max_stdout: usize,
) -> Result<Output, String> {
    capture_cancel(command, timeout, max_stdout, &AtomicBool::new(false))
}
pub fn capture_cancel(
    command: &mut Command,
    timeout: Duration,
    max_stdout: usize,
    cancelled: &AtomicBool,
) -> Result<Output, String> {
    if cancelled.load(Ordering::Relaxed) {
        return Err("Analysis cancelled".into());
    }
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("Missing process stdout")?;
    let err = child.stderr.take().ok_or("Missing process stderr")?;
    let stdout = std::thread::spawn(move || drain(out, max_stdout + 1));
    let stderr = std::thread::spawn(move || drain(err, 65536));
    let start = Instant::now();
    let status = loop {
        if cancelled.load(Ordering::Relaxed) {
            break Err("Analysis cancelled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(e) => break Err(e.to_string()),
            _ => {}
        }
        if start.elapsed() >= timeout {
            break Err(format!(
                "Media operation exceeded {} seconds",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let _ = child.kill();
    let _ = child.wait();
    let stdout = stdout
        .join()
        .map_err(|_| "Output reader failed")?
        .map_err(|e| e.to_string())?;
    let stderr = stderr
        .join()
        .map_err(|_| "Diagnostic reader failed")?
        .map_err(|e| e.to_string())?;
    if stdout.len() > max_stdout {
        return Err("Media metadata exceeded the output budget".into());
    }
    Ok(Output {
        status: status?,
        stdout,
        stderr,
    })
}
// Always drain the pipes, even once the capture limit is reached. Otherwise a
// verbose child blocks on a full pipe and cannot exit normally.
fn drain(mut input: impl Read, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut data = Vec::new();
    let mut buffer = [0u8; 8192];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            return Ok(data);
        }
        let keep = count.min(limit.saturating_sub(data.len()));
        data.extend_from_slice(&buffer[..keep]);
    }
}
