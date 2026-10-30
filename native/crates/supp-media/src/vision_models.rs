//! Explicit local vision pack; URLs are fixed artifacts, never media upload endpoints.
use crate::models::{download, Download, ModelStatus, Progress};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
pub const MODEL_ID: &str = "mobileclip-s0-yolox-nano";
pub const VERSION: &str = "mobileclip-757d59c9-fp32-yolox-0.1.1rc0-ort1.31.1";
const HF: &str =
    "https://huggingface.co/Xenova/mobileclip_s0/resolve/757d59c9c6870a76a4b0306f05f5061bca15c39f";
// Filename, URL or pinned-repository suffix, exact bytes, SHA-256.
const FILES: &[(&str, &str, u64, &str)] = &[
    ("vision_model.onnx", "onnx/vision_model.onnx", 45543630, "17d3c037b1d488c10c50e09f6009ea5a198caef4e0e8f4ea5617b7cb2d067ac0"),
    ("text_model.onnx", "onnx/text_model_quantized.onnx", 42799238, "b8557b10e5c23a0126c6d2e6eba48d240484979007917d128953b31618a04211"),
    ("tokenizer.json", "tokenizer.json", 2224081, "72ed5c96db5729294468543e4bc75fce14ca63f58e37300290189ba1c1e52b85"),
    ("MobileCLIP-LICENSE", "LICENSE", 2671, "18e4e6b95d7272051fabdad125ba0467549c181ef20b7fa0eafbac3825471483"),
    ("yolox_nano.onnx", "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx", 3659407, "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d"),
    ("YOLOX-LICENSE", "https://raw.githubusercontent.com/Megvii-BaseDetection/YOLOX/0.1.1rc0/LICENSE", 11352, "577c03d505ec80f667ebf96ebd0cc4f6825c817ca1088ee348c48aaabd51bd92"),
    ("runtime.zip", "https://github.com/microsoft/onnxruntime/releases/download/v1.31.1/onnxruntime-win-x64-1.31.1.zip", 82929944, "5869e26bb25314375f2d5ef1877e3ea06b1543d6c710e6e4a1ec2f7177ab4b2c"),
];
pub fn location(root: &Path) -> PathBuf {
    root.join(VERSION)
}
pub fn runtime(root: &Path) -> PathBuf {
    root.join("runtime/onnxruntime-win-x64-1.31.1/lib/onnxruntime.dll")
}
pub fn status(root: &Path) -> ModelStatus {
    let base = location(root);
    ModelStatus {
        id: MODEL_ID,
        name: "MobileCLIP S0 + YOLOX Nano",
        version: VERSION,
        size_bytes: FILES[..6].iter().map(|f| f.2).sum(),
        download_bytes: FILES.iter().map(|f| f.2).sum(),
        installed: FILES[..6]
            .iter()
            .all(|f| base.join(f.0).metadata().is_ok_and(|m| m.len() == f.2))
            && runtime(root).is_file()
            && base.join("verified.json").is_file(),
        install_supported: cfg!(all(target_os = "windows", target_arch = "x86_64")),
        device: "CPU",
    }
}
pub fn install(
    root: &Path,
    cancel: &AtomicBool,
    report: impl Fn(Progress),
) -> Result<ModelStatus, String> {
    let state = status(root);
    if state.installed {
        return Ok(state);
    }
    if !state.install_supported {
        return Err("Vision installer currently supports Windows x64 CPU".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = tempfile::tempdir_in(root).map_err(|e| e.to_string())?;
    let mut offset = 0;
    for (name, source, bytes, hash) in FILES {
        let url = if source.starts_with("https://") {
            source.to_string()
        } else {
            format!("{HF}/{source}")
        };
        download(
            Download {
                url: &url,
                bytes: *bytes,
                sha256: hash,
            },
            &temp.path().join(name),
            offset,
            state.download_bytes,
            cancel,
            &report,
        )?;
        offset += bytes;
    }
    let mut zip = zip::ZipArchive::new(
        fs::File::open(temp.path().join("runtime.zip")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let mut expanded = 0;
    for i in 0..zip.len() {
        crate::analysis::check(cancel)?;
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        expanded += entry.size();
        if expanded > 512 * 1024 * 1024 || entry.is_symlink() {
            return Err("Invalid vision runtime archive".into());
        }
        let out = temp
            .path()
            .join("runtime")
            .join(entry.enclosed_name().ok_or("Invalid runtime path")?);
        if entry.is_dir() {
            fs::create_dir_all(out).map_err(|e| e.to_string())?;
        } else {
            fs::create_dir_all(out.parent().ok_or("Invalid runtime directory")?)
                .map_err(|e| e.to_string())?;
            std::io::copy(
                &mut entry,
                &mut fs::File::create(out).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
        }
    }
    drop(zip);
    fs::remove_file(temp.path().join("runtime.zip")).map_err(|e| e.to_string())?;
    fs::write(
        temp.path().join("verified.json"),
        serde_json::to_vec(FILES).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    crate::analysis::check(cancel)?;
    let dest = location(root);
    if dest.exists() {
        return Err("Incomplete vision installation exists; remove it before installing".into());
    }
    // Keep the shared loaded DLL separate so installed weights can be removed on Windows.
    let runtime_folder = "onnxruntime-win-x64-1.31.1";
    let shared = root.join("runtime").join(runtime_folder);
    if !shared.exists() {
        fs::create_dir_all(root.join("runtime")).map_err(|e| e.to_string())?;
        fs::rename(temp.path().join("runtime").join(runtime_folder), shared)
            .map_err(|e| e.to_string())?;
    }
    fs::rename(temp.path(), dest).map_err(|e| format!("Publish vision model: {e}"))?;
    Ok(status(root))
}
