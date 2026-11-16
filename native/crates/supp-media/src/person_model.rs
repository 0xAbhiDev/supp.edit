//! Small, pinned human-only segmentation model. Installation is explicit and local inference never uploads media.
use crate::{
    models::{download, Download, ModelStatus, Progress},
    vision_models,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::AtomicBool,
};
pub const MODEL_ID: &str = "pphumanseg-2023mar";
const HASH: &str = "552d8a984054e59b5d773d24b9b12022b22046ceb2bbc4c9aaeaceb36a9ddf24";
const BYTES: u64 = 6_163_938;
const LICENSE_BYTES: u64 = 11_437;
const URL: &str = "https://huggingface.co/opencv/human_segmentation_pphumanseg/resolve/e876e63603f6c65c1a22576bfd5fc7c07ecf9eb9";
pub fn location(root: &Path) -> PathBuf {
    root.join(MODEL_ID)
}
pub fn verified(root: &Path) -> bool {
    let model = location(root).join("model.onnx");
    model.metadata().is_ok_and(|m| m.len() == BYTES)
        && fs::read(model).is_ok_and(|bytes| format!("{:x}", Sha256::digest(bytes)) == HASH)
}
pub fn status(root: &Path) -> ModelStatus {
    ModelStatus {
        id: MODEL_ID,
        name: "PP-HumanSeg · people",
        version: "2023mar-552d8a98",
        size_bytes: BYTES,
        download_bytes: BYTES + LICENSE_BYTES,
        installed: verified(root) && vision_models::runtime(root).is_file(),
        install_supported: cfg!(all(target_os = "windows", target_arch = "x86_64"))
            && vision_models::runtime(root).is_file(),
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
        return Err("Install the local vision runtime first".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let temp = tempfile::tempdir_in(root).map_err(|e| e.to_string())?;
    download(
        Download {
            url: &format!("{URL}/human_segmentation_pphumanseg_2023mar.onnx"),
            bytes: BYTES,
            sha256: HASH,
        },
        &temp.path().join("model.onnx"),
        0,
        state.download_bytes,
        cancel,
        &report,
    )?;
    download(
        Download {
            url: &format!("{URL}/LICENSE"),
            bytes: LICENSE_BYTES,
            sha256: "d9cf3b547fa4232fb9285f2db52e909f10f00781aaf64a6d0bb90c55149f1363",
        },
        &temp.path().join("LICENSE"),
        BYTES,
        state.download_bytes,
        cancel,
        &report,
    )?;
    let dest = location(root);
    if dest.exists() {
        return Err("Remove the incomplete person model through model management first".into());
    }
    fs::rename(temp.path(), dest).map_err(|e| e.to_string())?;
    Ok(status(root))
}
