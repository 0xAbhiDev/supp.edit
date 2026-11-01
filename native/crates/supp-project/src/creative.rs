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
        p.schema_version = 9;
        let mut track = serde_json::to_value(&p.tracks[0]).unwrap();
        track["id"] = "ai-track".into();
        let c = serde_json::json!({"id":"ai-sequence","name":"AI Gym Edit 01","settings":p.settings,"duration":90,"background":"#000000","tracks":[track],"layers":[],"markers":[{"id":"hook","frame":0,"name":"HOOK"}],"ai":{"plannerVersion":"rough-cut-1","createdAt":"2026-10-30T00:00:00.000Z","brief":{"prompt":"Pick my best gym lifts and sync cuts to the music.","profile":"gym","durationSeconds":30,"aspect":"9:16","pacing":"balanced","beatSync":"balanced","captions":false,"speedRamps":"off","prioritize":[]},"evidence":[],"warnings":[]}});
        p.compositions.push(serde_json::from_value(c).unwrap());
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
pub struct AiEditMetadata {
    pub planner_version: String,
    pub created_at: String,
    pub brief: EditBrief,
    pub evidence: Vec<Evidence>,
    pub warnings: Vec<String>,
}
impl AiEditMetadata {
    pub fn validate(&self) -> Result<(), Error> {
        let b = &self.brief;
        ensure(
            self.planner_version == "rough-cut-1"
                && (20..=40).contains(&self.created_at.len())
                && self.created_at.contains('T')
                && self.created_at.ends_with('Z'),
            "Invalid creative plan provenance",
        )?;
        ensure(
            !b.prompt.trim().is_empty()
                && b.prompt.chars().count() <= 4000
                && ["gym", "general"].contains(&b.profile.as_str())
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
