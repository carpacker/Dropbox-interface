use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DropboxEntry {
    /// "folder" or "file"
    pub kind: EntryKind,
    pub name: String,
    /// Dropbox path (lowercased) — what we use to navigate further.
    pub path: String,
    /// Display path preserving case, when Dropbox returns one.
    pub display_path: String,
    /// File size in bytes (None for folders).
    pub size: Option<u64>,
    /// Server-side modification time as RFC3339 (None for folders).
    pub server_modified: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Folder,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DropboxAccount {
    pub account_id: String,
    pub display_name: String,
    pub email: String,
}

/// Raw `/files/list_folder` response shape (subset).
#[derive(Debug, Deserialize)]
pub(crate) struct ListFolderResponse {
    pub entries: Vec<RawEntry>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct RawEntry {
    #[serde(rename = ".tag")]
    pub tag: String,
    pub name: String,
    #[serde(default)]
    pub path_lower: Option<String>,
    #[serde(default)]
    pub path_display: Option<String>,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub server_modified: Option<String>,
}

/// Convert a single raw API entry to our typed shape, or `None` if the
/// `.tag` is anything other than `file` or `folder` (e.g. `deleted`).
pub(crate) fn entry_from_raw(r: RawEntry) -> Option<DropboxEntry> {
    let kind = match r.tag.as_str() {
        "folder" => EntryKind::Folder,
        "file" => EntryKind::File,
        _ => return None,
    };
    let path = r.path_lower.unwrap_or_default();
    let display_path = r.path_display.unwrap_or_else(|| path.clone());
    let size = match kind {
        EntryKind::File => r.size,
        EntryKind::Folder => None,
    };
    let server_modified = match kind {
        EntryKind::File => r.server_modified,
        EntryKind::Folder => None,
    };
    Some(DropboxEntry {
        kind,
        name: r.name,
        path,
        display_path,
        size,
        server_modified,
    })
}

/// Convert raw API entries to our typed shape, dropping deleted/unknown tags
/// and sorting folders-first then by case-insensitive name.
pub(crate) fn entries_from_raw(raw: Vec<RawEntry>) -> Vec<DropboxEntry> {
    let mut out: Vec<DropboxEntry> = raw.into_iter().filter_map(entry_from_raw).collect();
    out.sort_by(|a, b| match (a.kind, b.kind) {
        (EntryKind::Folder, EntryKind::File) => std::cmp::Ordering::Less,
        (EntryKind::File, EntryKind::Folder) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    out
}

/// Shared response shape for `/files/move_v2` and `/files/create_folder_v2`,
/// both of which return `{ "metadata": <RawEntry> }`.
#[derive(Debug, Deserialize)]
pub(crate) struct MetadataEnvelope {
    pub metadata: RawEntry,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AccountResponse {
    pub account_id: String,
    pub email: String,
    pub name: AccountName,
}

#[derive(Debug, Deserialize)]
pub(crate) struct AccountName {
    pub display_name: String,
}

impl From<AccountResponse> for DropboxAccount {
    fn from(r: AccountResponse) -> Self {
        Self {
            account_id: r.account_id,
            email: r.email,
            display_name: r.name.display_name,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_from_raw_keeps_files_and_folders_drops_deleted() {
        let body = r#"{
            "entries": [
                {".tag": "folder", "name": "Photos", "path_lower": "/photos", "path_display": "/Photos"},
                {".tag": "file", "name": "a.txt", "path_lower": "/a.txt", "path_display": "/a.txt", "size": 12, "server_modified": "2025-01-02T03:04:05Z"},
                {".tag": "deleted", "name": "old", "path_lower": "/old"}
            ]
        }"#;
        let parsed: ListFolderResponse = serde_json::from_str(body).unwrap();
        let entries = entries_from_raw(parsed.entries);
        assert_eq!(entries.len(), 2);
        assert!(entries.iter().all(|e| e.name != "old"));
    }

    #[test]
    fn entries_from_raw_sorts_folders_first_then_by_case_insensitive_name() {
        let body = r#"{
            "entries": [
                {".tag": "file", "name": "zeta.txt", "path_lower": "/zeta.txt"},
                {".tag": "folder", "name": "Beta", "path_lower": "/beta"},
                {".tag": "folder", "name": "alpha", "path_lower": "/alpha"},
                {".tag": "file", "name": "Apple.png", "path_lower": "/apple.png", "size": 5}
            ]
        }"#;
        let parsed: ListFolderResponse = serde_json::from_str(body).unwrap();
        let entries = entries_from_raw(parsed.entries);
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "Beta", "Apple.png", "zeta.txt"]);
    }

    #[test]
    fn entries_from_raw_strips_size_and_modified_for_folders() {
        let body = r#"{
            "entries": [
                {".tag": "folder", "name": "X", "path_lower": "/x", "size": 99, "server_modified": "2025-01-02T03:04:05Z"}
            ]
        }"#;
        let parsed: ListFolderResponse = serde_json::from_str(body).unwrap();
        let e = &entries_from_raw(parsed.entries)[0];
        assert_eq!(e.kind, EntryKind::Folder);
        assert!(e.size.is_none());
        assert!(e.server_modified.is_none());
    }

    #[test]
    fn entries_from_raw_handles_missing_path_display() {
        let body = r#"{
            "entries": [
                {".tag": "file", "name": "a.txt", "path_lower": "/a.txt"}
            ]
        }"#;
        let parsed: ListFolderResponse = serde_json::from_str(body).unwrap();
        let e = &entries_from_raw(parsed.entries)[0];
        assert_eq!(e.path, "/a.txt");
        assert_eq!(e.display_path, "/a.txt");
    }

    #[test]
    fn account_response_maps_to_dropbox_account() {
        let body = r#"{
            "account_id": "dbid:42",
            "email": "x@example.com",
            "name": {"display_name": "X Y", "given_name": "X", "surname": "Y"}
        }"#;
        let parsed: AccountResponse = serde_json::from_str(body).unwrap();
        let a: DropboxAccount = parsed.into();
        assert_eq!(a.account_id, "dbid:42");
        assert_eq!(a.email, "x@example.com");
        assert_eq!(a.display_name, "X Y");
    }
}
