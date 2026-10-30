//! Provider registration is tried in order, and failure is explicit before CPU fallback.
use ort::{
    ep::{self, ExecutionProvider},
    session::Session,
};
use serde::Serialize;
use std::path::Path;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSelection {
    pub requested: String,
    pub available: Vec<String>,
    pub active: String,
    pub fallback_reasons: Vec<String>,
}
pub fn session(path: &Path) -> Result<(Session, ProviderSelection), String> {
    let requested = std::env::var("SUPP_AI_EXECUTION_PROVIDER").unwrap_or_else(|_| "auto".into());
    let mut available = Vec::new();
    if ep::CUDA::default().is_available().unwrap_or(false) {
        available.push("CUDA".into());
    }
    if ep::DirectML::default().is_available().unwrap_or(false) {
        available.push("DirectML".into());
    }
    available.push("CPU".into());
    let mut report = ProviderSelection {
        requested: requested.clone(),
        available,
        active: "CPU".into(),
        fallback_reasons: Vec::new(),
    };
    let order = match requested.as_str() {
        "auto" => vec!["CUDA", "DirectML", "CPU"],
        "CUDA" => vec!["CUDA", "DirectML", "CPU"],
        "DirectML" => vec!["DirectML", "CPU"],
        "CPU" => vec!["CPU"],
        _ => return Err("Unknown vision execution provider preference".into()),
    };
    for name in order {
        if !report.available.iter().any(|p| p == name) {
            if requested == name {
                report.fallback_reasons.push(format!(
                    "{name} is not included in the installed ONNX Runtime"
                ));
            }
            continue;
        }
        let build = || -> ort::Result<Session> {
            let mut builder = Session::builder()?.with_intra_threads(4)?;
            if name == "CUDA" {
                builder = builder
                    .with_execution_providers([ep::CUDA::default().build().error_on_failure()])?;
            } else if name == "DirectML" {
                builder = builder
                    .with_memory_pattern(false)?
                    .with_parallel_execution(false)?
                    .with_execution_providers([ep::DirectML::default()
                        .build()
                        .error_on_failure()])?;
            }
            builder.commit_from_file(path)
        };
        match build() {
            Ok(session) => {
                report.active = name.into();
                return Ok((session, report));
            }
            Err(e) => report.fallback_reasons.push(format!("{name}: {e}")),
        }
    }
    Err(format!(
        "No execution provider could load this model: {}",
        report.fallback_reasons.join("; ")
    ))
}
