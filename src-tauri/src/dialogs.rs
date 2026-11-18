//! Native file dialogs run on one long-lived thread that keeps COM initialised for the life of
//! the app.
//!
//! The Windows shell dialog (explorerframe.dll) leaves worker threads behind that may call back
//! into it after the dialog closes. When the dialog ran on a short-lived blocking-pool thread,
//! that thread's final `CoUninitialize` (or its exit) unloaded the shell components while those
//! callbacks were pending, and the app crashed with an access violation in the unloaded
//! `explorerframe.dll` well after the dialog had closed (seen during a Deliver export). Here
//! the dialog thread holds its own STA initialisation forever, so the shell's components stay
//! loaded, and dialogs are shown one at a time.
use std::sync::{mpsc, Mutex, OnceLock};

type Job = Box<dyn FnOnce() + Send>;
static SENDER: OnceLock<Mutex<mpsc::Sender<Job>>> = OnceLock::new();

fn sender() -> mpsc::Sender<Job> {
    SENDER
        .get_or_init(|| {
            let (tx, rx) = mpsc::channel::<Job>();
            std::thread::Builder::new()
                .name("file-dialogs".into())
                .spawn(move || {
                    #[cfg(windows)]
                    unsafe {
                        // Deliberately never balanced: the apartment lives as long as the process.
                        windows_sys::Win32::System::Com::CoInitializeEx(
                            std::ptr::null(),
                            windows_sys::Win32::System::Com::COINIT_APARTMENTTHREADED as u32,
                        );
                    }
                    for job in rx {
                        job();
                    }
                })
                .expect("Could not start the file dialog thread");
            Mutex::new(tx)
        })
        .lock()
        .expect("File dialog thread lock poisoned")
        .clone()
}

/// Show a file dialog (or run any shell UI call) on the dialog thread and wait for its result.
pub fn run<T: Send + 'static>(dialog: impl FnOnce() -> T + Send + 'static) -> T {
    let (tx, rx) = mpsc::channel();
    sender()
        .send(Box::new(move || {
            let _ = tx.send(dialog());
        }))
        .expect("The file dialog thread stopped");
    rx.recv().expect("The file dialog thread stopped")
}
