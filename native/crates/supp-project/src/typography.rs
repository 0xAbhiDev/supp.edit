use crate::{color, ensure, range, Error, Text};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Typography {
    pub tracking: f64,
    pub line_spacing: f64,
    pub reveal: f64,
    pub reveal_unit: String,
    pub highlight: f64,
    pub highlight_color: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub word_starts: Option<Vec<u32>>,
    pub highlight_scale: f64,
    pub direction: String,
    pub stroke_width: f64,
    pub stroke_color: String,
    pub shadow_blur: f64,
    pub shadow_x: f64,
    pub shadow_y: f64,
    pub shadow_color: String,
    pub background_color: String,
    pub background_opacity: f64,
    pub background_radius: f64,
    pub padding: f64,
    pub max_width: f64,
    pub emphasis: Vec<Emphasis>,
    pub role: String,
    pub safe_zone: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Emphasis {
    pub word: u32,
    pub scale: f64,
    pub color: String,
    pub weight: String,
}
impl Default for Typography {
    fn default() -> Self {
        Self {
            tracking: 0.,
            line_spacing: 1.2,
            reveal: 1.,
            reveal_unit: "words".into(),
            highlight: -1.,
            highlight_color: "#C9FF69".into(),
            word_starts: None,
            highlight_scale: 1.,
            direction: "left".into(),
            stroke_width: 0.,
            stroke_color: "#000000".into(),
            shadow_blur: 0.,
            shadow_x: 0.,
            shadow_y: 0.,
            shadow_color: "#000000".into(),
            background_color: "#000000".into(),
            background_opacity: 0.,
            background_radius: 0.,
            padding: 12.,
            max_width: 0.,
            emphasis: vec![],
            role: "overlay".into(),
            safe_zone: true,
        }
    }
}
pub fn validate(text: &Text) -> Result<(), Error> {
    let t = &text.typography;
    ensure(
        range(t.tracking, -10., 100.)
            && t.word_starts.as_ref().is_none_or(|keys| keys.len() <= 256 && keys.iter().all(|k| *k <= 2_000_000_000) && keys.windows(2).all(|pair| pair[0] < pair[1]))
            && range(t.line_spacing, 0.5, 3.)
            && range(t.reveal, 0., 1.)
            && range(t.highlight, -1., 10000.)
            && range(t.highlight_scale, 1., 1.5)
            && range(t.stroke_width, 0., 40.)
            && range(t.shadow_blur, 0., 100.)
            && range(t.shadow_x, -100., 100.)
            && range(t.shadow_y, -100., 100.)
            && range(t.background_opacity, 0., 1.)
            && range(t.background_radius, 0., 1000.)
            && range(t.padding, 0., 100.)
            && range(t.max_width, 0., 8192.),
        "Invalid text layout",
    )?;
    ensure(
        [
            &t.highlight_color,
            &t.stroke_color,
            &t.shadow_color,
            &t.background_color,
        ]
        .iter()
        .all(|c| color(c))
            && ["words", "characters", "phrases"].contains(&t.reveal_unit.as_str())
            && ["left", "right", "up", "down"].contains(&t.direction.as_str())
            && ["overlay", "background"].contains(&t.role.as_str()),
        "Invalid text decoration",
    )?;
    ensure(
        t.emphasis.len() <= 256
            && t.emphasis.iter().all(|e| {
                e.word <= 10000
                    && range(e.scale, 0.5, 2.)
                    && color(&e.color)
                    && ["normal", "bold", "900"].contains(&e.weight.as_str())
            }),
        "Invalid word emphasis",
    )
}

#[cfg(test)]
mod tests {
    use crate::{read, save, Project};
    #[test]
    fn decorated_animated_text_survives_native_io_and_rejects_invalid_values() {
        let mut p: Project =
            serde_json::from_str(include_str!("../tests/fixtures/parenting-v4.supp")).unwrap();
        p.schema_version = 10;
        p.clips[0].kind = "text".into();
        p.clips[0].composition_id = None;
        let t = &mut p.clips[0].text;
        t.content = "ONE MORE REP".into();
        t.font = "Arial Black".into();
        t.weight = "900".into();
        t.typography=serde_json::from_value(serde_json::json!({"tracking":2.5,"lineSpacing":1.4,"strokeWidth":1.25,"shadowBlur":4,"backgroundOpacity":0.2,"backgroundRadius":12,"highlightScale":1.2,"direction":"up","revealUnit":"phrases","reveal":0.4,"highlight":1,"emphasis":[{"word":1,"scale":1.3,"color":"#C9FF69","weight":"900"}]})).unwrap();
        p.clips[0].keyframes.extra.insert("reveal".into(),serde_json::from_value(serde_json::json!([{"frame":0,"value":0,"easing":"linear"},{"frame":20,"value":1,"easing":"linear"}])).unwrap());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("type.supp");
        save(&path, &p).unwrap();
        let q = read(&path).unwrap();
        assert_eq!(
            serde_json::to_value(&q).unwrap(),
            serde_json::to_value(&p).unwrap()
        );
        p.clips[0].text.typography.line_spacing = 0.;
        assert!(p.validate().is_err());
    }
}
