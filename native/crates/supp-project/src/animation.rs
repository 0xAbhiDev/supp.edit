//! Scalar animation shared with the frontend's ordinary keyframe model.
use crate::Keyframe;

fn cubic(a: f64, b: f64, c: f64, d: f64, t: f64) -> f64 {
    (1. - t).powi(3) * a + 3. * (1. - t).powi(2) * t * b + 3. * (1. - t) * t * t * c + t.powi(3) * d
}
fn slope(keys: &[Keyframe], i: usize) -> f64 {
    if i == 0 || i == keys.len() - 1 {
        return 0.;
    }
    let (a, b, c) = (&keys[i - 1], &keys[i], &keys[i + 1]);
    let (h0, h1) = ((b.frame - a.frame) as f64, (c.frame - b.frame) as f64);
    let (left, right) = ((b.value - a.value) / h0, (c.value - b.value) / h1);
    if left * right <= 0. {
        return 0.;
    }
    let (w0, w1) = (2. * h1 + h0, h1 + 2. * h0);
    (w0 + w1) / (w0 / left + w1 / right)
}
/// Keys must be sorted by frame. Callers sort once before rendering audio.
pub fn evaluate(keys: &[Keyframe], frame: f64, base: f64) -> f64 {
    if keys.is_empty() {
        return base;
    }
    if frame <= keys[0].frame as f64 {
        return keys[0].value;
    }
    let hi = keys.partition_point(|k| k.frame as f64 <= frame);
    if hi == keys.len() {
        return keys[hi - 1].value;
    }
    let (a, b) = (&keys[hi - 1], &keys[hi]);
    let dt = (b.frame - a.frame) as f64;
    let mut t = (frame - a.frame as f64) / dt;
    match a.easing.as_str() {
        "hold" => return a.value,
        "ease-in" => t = t.powi(3),
        "ease-out" => t = 1. - (1. - t).powi(3),
        "ease-in-out" => t = t * t * (3. - 2. * t),
        e if e.contains("bezier") => {
            let delta = b.value - a.value;
            let ((mut ox, oy), (mut ix, iy)) = if e == "auto-bezier" {
                (
                    (1. / 3., slope(keys, hi - 1) * dt / 3.),
                    (1. / 3., -slope(keys, hi) * dt / 3.),
                )
            } else {
                (
                    a.out_handle
                        .as_ref()
                        .map_or((1. / 3., delta / 3.), |h| (h.x, h.y)),
                    b.in_handle
                        .as_ref()
                        .map_or((1. / 3., -delta / 3.), |h| (h.x, h.y)),
                )
            };
            if ox + ix > 1. {
                let sum = ox + ix;
                ox /= sum;
                ix /= sum;
            }
            let (mut lo, mut hi) = (0., 1.);
            for _ in 0..32 {
                let m = (lo + hi) / 2.;
                if cubic(0., ox, 1. - ix, 1., m) < t {
                    lo = m;
                } else {
                    hi = m;
                }
            }
            return cubic(a.value, a.value + oy, b.value + iy, b.value, (lo + hi) / 2.);
        }
        _ => {}
    }
    a.value + (b.value - a.value) * t
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn interpolation_matches_frontend() {
        for (easing, expected) in [
            ("linear", -15.),
            ("hold", -20.),
            ("ease-in", -19.6875),
            ("ease-out", -8.4375),
            ("ease-in-out", -16.875),
            ("bezier", -15.),
            ("continuous-bezier", -15.),
            ("auto-bezier", -16.875),
        ] {
            let keys: Vec<Keyframe> = serde_json::from_value(serde_json::json!([
                {"frame":0,"value":-20.,"easing":easing},{"frame":100,"value":0.,"easing":"linear"}
            ]))
            .unwrap();
            assert!(
                (evaluate(&keys, 25., 0.) - expected).abs() < 1e-7,
                "{easing}"
            );
        }
    }
}
