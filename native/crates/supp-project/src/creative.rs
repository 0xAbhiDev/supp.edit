//! Persisted AI provenance is bounded descriptive data, never executable commands.
use crate::{ensure, range, Error};
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevisionRecord {
    pub id: String,
    pub request: String,
    pub summary: String,
    pub created_at: String,
    pub changed_layer_ids: Vec<String>,
}
impl RevisionRecord {
    pub fn validate(&self) -> Result<(), Error> {
        ensure(
            crate::valid_id(&self.id)
                && !self.request.trim().is_empty()
                && self.request.chars().count() <= 4000
                && !self.summary.is_empty()
                && self.summary.chars().count() <= 2000
                && (20..=40).contains(&self.created_at.len())
                && self.created_at.contains('T')
                && self.created_at.ends_with('Z')
                && self.changed_layer_ids.len() <= 512
                && self.changed_layer_ids.iter().all(|id| crate::valid_id(id)),
            "Invalid sequence revision",
        )
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditBrief {
    pub prompt: String,
    pub profile: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    pub duration_seconds: f64,
    pub aspect: String,
    pub pacing: String,
    pub beat_sync: String,
    pub captions: bool,
    pub speed_ramps: String,
    pub prioritize: Vec<String>,
}
#[cfg(test)]
mod tests {
    use crate::{read, save, Project};
    #[test]
    fn ai_sequence_roundtrip_preserves_provenance_and_markers() {
        let mut p: Project =
            serde_json::from_str(include_str!("../../../../tests/fixtures/project.supp")).unwrap();
        p.schema_version = 10;
        let mut track = serde_json::to_value(&p.tracks[0]).unwrap();
        track["id"] = "ai-track".into();
        let c = serde_json::json!({"id":"ai-sequence","name":"AI Gym Edit 01","settings":p.settings,"duration":90,"background":"#000000","tracks":[track],"layers":[],"markers":[{"id":"hook","frame":0,"name":"HOOK"}],"ai":{"plannerVersion":"rough-cut-1","createdAt":"2026-10-30T00:00:00.000Z","brief":{"prompt":"Pick my best gym lifts and sync cuts to the music.","profile":"gym","durationSeconds":30,"aspect":"9:16","pacing":"balanced","beatSync":"balanced","captions":false,"speedRamps":"off","prioritize":[]},"evidence":[],"warnings":[]}});
        p.compositions.push(serde_json::from_value(c).unwrap());
        p.compositions[0].ai.as_mut().unwrap().brief.style = Some("dark-aesthetic".into());
        for index in 1..=2 {
            p.compositions[0].revisions.push(serde_json::from_value(serde_json::json!({"id":format!("revision-{index}"),"request":"Make it shorter.","summary":"Trim existing clip ranges","createdAt":"2026-11-01T00:00:00.000Z","changedLayerIds":["legacy-clip"]})).unwrap());
        }
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("gym.supp");
        save(&path, &p).unwrap();
        let loaded = read(&path).unwrap();
        assert_eq!(
            serde_json::to_value(&loaded).unwrap(),
            serde_json::to_value(&p).unwrap()
        );
        p.compositions[0].markers[0].id = p.tracks[0].id.clone();
        assert!(p.validate().is_err());
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Evidence {
    pub asset_id: String,
    pub fingerprint: String,
    pub cache_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventLink {
    pub layer_id: String,
    pub visual: String,
    pub relation: String,
    pub offset_ms: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MappingReasons {
    pub r#type: f64,
    pub section: f64,
    pub phrase: f64,
    pub strength: f64,
    pub position: f64,
}
/// Where a reference visual event went when the audio structure was recreated, and why.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioMappingEntry {
    pub visual: String,
    pub reference_ms: u64,
    pub adapted_ms: u64,
    pub anchor: String,
    pub replacement: String,
    pub relation: String,
    pub offset_ms: i64,
    pub confidence: f64,
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasons: Option<MappingReasons>,
}
/// A reference audio event placed as a marker, and the generated layers it drives.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReferenceEvent {
    pub marker_id: String,
    pub anchor_kind: String,
    pub anchor_ms: u64,
    pub confidence: f64,
    pub links: Vec<EventLink>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiEditMetadata {
    pub planner_version: String,
    pub created_at: String,
    pub brief: EditBrief,
    pub evidence: Vec<Evidence>,
    pub warnings: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated: Option<Vec<crate::generated::Treatment>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference_events: Option<Vec<ReferenceEvent>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_mapping: Option<Vec<AudioMappingEntry>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_event_frames: Option<Vec<u64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_notes: Option<Vec<String>>,
}
impl AiEditMetadata {
    pub fn validate(&self) -> Result<(), Error> {
        let b = &self.brief;
        if let Some(events) = &self.reference_events {
            ensure(
                events.len() <= 2000
                    && events.iter().all(|e| {
                        crate::valid_id(&e.marker_id)
                            && (1..=32).contains(&e.anchor_kind.len())
                            && e.anchor_ms <= 2_000_000_000
                            && (0. ..=1.).contains(&e.confidence)
                            && e.links.len() <= 16
                            && e.links.iter().all(|l| {
                                crate::valid_id(&l.layer_id)
                                    && (1..=32).contains(&l.visual.len())
                                    && ["on", "before", "after", "offbeat"].contains(&l.relation.as_str())
                                    && (-10000..=10000).contains(&l.offset_ms)
                            })
                    }),
                "Invalid reference event links",
            )?;
        }
        let unit = |v: f64| (0. ..=1.).contains(&v);
        ensure(
            self.audio_mapping.as_ref().is_none_or(|m| {
                m.len() <= 400
                    && m.iter().all(|e| {
                        (1..=32).contains(&e.visual.len())
                            && (1..=32).contains(&e.anchor.len())
                            && (1..=32).contains(&e.replacement.len())
                            && (1..=16).contains(&e.relation.len())
                            && (-10000..=10000).contains(&e.offset_ms)
                            && unit(e.confidence)
                            && ["anchored", "no-replacement", "free"].contains(&e.status.as_str())
                            && e.reasons.as_ref().is_none_or(|r| [r.r#type, r.section, r.phrase, r.strength, r.position].into_iter().all(unit))
                    })
            }) && self.audio_event_frames.as_ref().is_none_or(|f| f.len() <= 4000),
            "Invalid audio mapping",
        )?;
        ensure(
            self.audio_mode.as_deref().is_none_or(|m| ["music", "reference", "recreate"].contains(&m))
                && self.audio_notes.as_ref().is_none_or(|n| n.len() <= 64 && n.iter().all(|s| s.chars().count() <= 400)),
            "Invalid audio plan notes",
        )?;
        if let Some(values) = &self.generated {
            crate::generated::validate(values)?;
        }
        ensure(
            matches!(
                self.planner_version.as_str(),
                "rough-cut-1" | "reference-edit-1"
            ) && (20..=40).contains(&self.created_at.len())
                && self.created_at.contains('T')
                && self.created_at.ends_with('Z'),
            "Invalid creative plan provenance",
        )?;
        ensure(
            !b.prompt.trim().is_empty()
                && b.prompt.chars().count() <= 4000
                && ["gym", "general"].contains(&b.profile.as_str())
                && b.style.as_ref().is_none_or(|s| {
                    [
                        "dark-aesthetic",
                        "clean-aesthetic",
                        "cinematic",
                        "hardcore",
                        "physique",
                        "powerlifting",
                        "minimal",
                    ]
                    .contains(&s.as_str())
                })
                && range(b.duration_seconds, 3., 300.)
                && ["9:16", "16:9", "1:1", "4:5"].contains(&b.aspect.as_str())
                && ["cinematic", "balanced", "energetic", "aggressive"]
                    .contains(&b.pacing.as_str())
                && ["off", "loose", "balanced", "tight"].contains(&b.beat_sync.as_str())
                && ["off", "subtle", "dynamic"].contains(&b.speed_ramps.as_str())
                && b.prioritize.len() <= 16
                && b.prioritize.iter().all(|p| p.chars().count() <= 128),
            "Invalid edit brief",
        )?;
        ensure(
            self.evidence.len() <= 512
                && self.evidence.iter().all(|e| {
                    crate::valid_id(&e.asset_id)
                        && !e.fingerprint.is_empty()
                        && e.fingerprint.chars().count() <= 8192
                        && e.cache_key.len() == 64
                        && e.cache_key
                            .bytes()
                            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
                }),
            "Invalid creative analysis provenance",
        )?;
        ensure(
            self.warnings.len() <= 64 && self.warnings.iter().all(|w| w.chars().count() <= 1000),
            "Invalid creative plan warnings",
        )
    }
}
