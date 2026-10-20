use std::{
    io::Read,
    process::{Command, Output, Stdio},
    time::{Duration, Instant},
};
/// Bound both process lifetime and captured output, including malformed-media probes.
pub fn capture(
    command: &mut Command,
    timeout: Duration,
    max_stdout: usize,
) -> Result<Output, String> {
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("Missing process stdout")?;
    let err = child.stderr.take().ok_or("Missing process stderr")?;
    let stdout = std::thread::spawn(move || {
        let mut data = Vec::new();
        out.take(max_stdout as u64 + 1)
            .read_to_end(&mut data)
            .map(|_| data)
    });
    let stderr = std::thread::spawn(move || {
        let mut data = Vec::new();
        err.take(65536).read_to_end(&mut data).map(|_| data)
    });
    let start = Instant::now();
    let status = loop {
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
