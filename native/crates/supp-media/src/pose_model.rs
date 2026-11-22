//! MediaPipe body pose from the OpenCV model zoo (Apache 2.0): a person detector and a 33-joint
//! landmark model, pinned by commit, size and SHA-256. Installation is explicit and local inference
//! never uploads media.
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
pub const MODEL_ID: &str = "mediapipe-pose-2023mar";
struct Pinned {
    url: &'static str,
    file: &'static str,
    bytes: u64,
    sha256: &'static str,
}
const FILES: [Pinned; 4] = [
    Pinned {
        url: "https://huggingface.co/opencv/person_detection_mediapipe/resolve/531b6da87204aa40aa5cc680b4d032dd09b5055e/person_detection_mediapipe_2023mar.onnx",
        file: "person_detection.onnx",
        bytes: 11_990_159,
        sha256: "47fd5599d6fa17608f03e0eb0ae230baa6e597d7e8a2c8199fe00abea55a701f",
    },
    Pinned {
        url: "https://huggingface.co/opencv/person_detection_mediapipe/resolve/531b6da87204aa40aa5cc680b4d032dd09b5055e/LICENSE",
        file: "LICENSE-person-detection",
        bytes: 11_358,
        sha256: "cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30",
    },
    Pinned {
        url: "https://huggingface.co/opencv/pose_estimation_mediapipe/resolve/8cd55743af63a8578effaf144a68cb58f6450fe9/pose_estimation_mediapipe_2023mar.onnx",
        file: "pose_landmarks.onnx",
        bytes: 5_557_238,
        sha256: "9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f",
    },
    Pinned {
        url: "https://huggingface.co/opencv/pose_estimation_mediapipe/resolve/8cd55743af63a8578effaf144a68cb58f6450fe9/LICENSE",
        file: "LICENSE-pose",
        bytes: 11_357,
        sha256: "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd",
    },
];
pub fn location(root: &Path) -> PathBuf {
    root.join(MODEL_ID)
}
/// Both models present with their pinned size and hash (licences are checked at install).
pub fn verified(root: &Path) -> bool {
    FILES.iter().filter(|f| f.file.ends_with(".onnx")).all(|f| {
        let path = location(root).join(f.file);
        path.metadata().is_ok_and(|m| m.len() == f.bytes)
            && fs::read(&path).is_ok_and(|bytes| format!("{:x}", Sha256::digest(bytes)) == f.sha256)
    })
}
pub fn status(root: &Path) -> ModelStatus {
    let total: u64 = FILES.iter().map(|f| f.bytes).sum();
    ModelStatus {
        id: MODEL_ID,
        name: "MediaPipe Pose · body joints",
        version: "2023mar-9d89c599",
        size_bytes: total,
        download_bytes: total,
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
    let mut done = 0;
    for f in &FILES {
        download(
            Download { url: f.url, bytes: f.bytes, sha256: f.sha256 },
            &temp.path().join(f.file),
            done,
            state.download_bytes,
            cancel,
            &report,
        )?;
        done += f.bytes;
    }
    let dest = location(root);
    if dest.exists() {
        return Err("Remove the incomplete pose model through model management first".into());
    }
    fs::rename(temp.path(), dest).map_err(|e| e.to_string())?;
    Ok(status(root))
}
