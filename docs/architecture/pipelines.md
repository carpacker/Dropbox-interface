# Pipelines

State-aware folder views for review workflows. A *pipeline* is an ordered
list of *states*, each backed by one direct child folder of a parent. An
*item* (file or sub-folder) is in exactly one state at a time, defined by
which state folder is its direct parent. **Promotion** = moving an item
from its current state folder to the next one in pipeline order.

## Status

**Review-day round shipped.** On top of the previous workflow round,
the team can now run the actual review verbs without leaving the
pipeline view:

- **Auto-discovery.** A folder containing
  `.dropbox-interface.json` swaps `DropboxApp` into `PipelineView`;
  otherwise the flat browser.
- **Promote** from a state bucket → next state, or from **Inbox** →
  first state. Click the button or drag the row onto another
  bucket chip — both routes land in the same `performMove`
  plumbing.
- **Bulk Promote.** Each row carries a checkbox; selection is kept
  per-bucket so you can flip between buckets without losing it.
  When ≥1 item is selected, a toolbar above the list shows
  `Promote N to <next>` plus Clear. Bulk moves run in parallel
  (`Promise.allSettled`); partial failure surfaces a count but
  successful moves still queue up under a single batch Undo entry.
- **Drag-and-drop.** Same plumbing as button-Promote.
- **Undo toast** is now batch-aware: `UndoableMove.moves[]` always
  has at least one entry; the toast text adapts (single vs N items).
  Reversal also uses `Promise.allSettled` so partial undo failures
  are reported without silently leaving items behind.
- **Pinning.** `pipeline-recents` gained a per-entry `pinned` flag
  that's never evicted by the unpinned cap. The dashboard card
  shows pinned rows first (with a stronger border) and offers a
  pin toggle per row; the pipeline view itself has a pin button in
  the header so you can flag a pipeline you're actively reviewing.
- **Local-only notes.** `pipeline-notes.ts` (new) keeps
  per-row review notes in `localStorage`, keyed by Dropbox path. A
  Note button on each row opens a small modal editor; saving an
  empty note clears it. **Local to each user's machine** — see
  THREAT_MODEL §D8d for why we didn't request
  `files.content.write` to round-trip notes through Dropbox.
- **Create-folder** affordance on each missing-state warning row.
- **Recent pipelines** quick-launch card on the dashboard.

`delete_v2` is intentionally still not shipped — see THREAT_MODEL §D8c.

## Why this exists

Reviewing creative content for the team means walking it through stages —
intake → processing → ready → published, or some variation. The team
already encodes this in folder names like `1__Processing`, `2__ready`. The
goal is to make the app understand that convention so it can render a
pipeline view, count items per state, and (later) move items between
states with one click.

The model is intentionally **declarative + per-folder**. Each parent that
wants the pipeline view ships a small JSON config; folders without one
keep working in the existing flat browser. Tooling stays out of the way
unless explicitly invited in.

## Config: `.dropbox-interface.json`

Lives at the parent folder. Schema:

```json
{
  "version": 1,
  "kind": "pipeline",
  "name": "Artist content review",
  "description": "Per-artist intake, edit, and publish.",
  "states": [
    { "id": "processing", "folder": "1__Processing", "name": "Processing" },
    { "id": "ready",      "folder": "2__ready",      "name": "Ready"      },
    { "id": "published",  "folder": "3__published",  "name": "Published",
      "terminal": true }
  ],
  "inbox": { "show": true, "name": "Unfiled" }
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `version` | yes | Must be `1`. Bumped on breaking changes. |
| `kind` | yes | Must be `"pipeline"`. Reserves the keyword for future kinds (`"library"`, `"review-board"` etc). |
| `name` / `description` | no | Team-facing labels for the pipeline as a whole. |
| `states` | yes | Non-empty ordered list. State `id` slugs and `folder` names are each unique. |
| `states[].id` | yes | Slug: `^[a-z0-9][a-z0-9_-]*$`. Used as React key, query param, future Promote command. |
| `states[].folder` | yes | Exact basename of the subfolder. **Case-sensitive** match against the listing. |
| `states[].name` | yes | Human label. |
| `states[].description` | no | Hover text / details panel copy. |
| `states[].terminal` | no | If `true`, no Promote action is offered out of this state. The last state in `states` is also a natural sink regardless of this flag. |
| `inbox` | no | Defaults to `{ "show": true }` when absent. |
| `inbox.show` | no (default `true`) | Whether to render the Inbox bucket at all. |
| `inbox.name` | no (default `"Inbox"`) | Override the bucket label. |

The validator (`parseConfig`) collects **all** issues in one pass and
returns either `{ ok: true, config }` or `{ ok: false, issues }`. A
hypothetical config editor can light up every problem at once.

## Module layout

```
src/lib/pipeline/
├── schema.ts        ← types + parseConfig validator (no I/O)
├── pipeline.ts      ← findState, nextState, classifyParentListing
├── source.ts        ← PipelineSource interface + InMemoryPipelineSource
└── *.test.ts        ← 56 tests
```

The pipeline lib is pure and backend-agnostic. Adding a Dropbox or local
filesystem source is a separate, small module that implements
`PipelineSource`.

```
   +---------------------+
   |   PipelineView UI   |    (built later, against the helpers)
   +----------+----------+
              |
              v
   +---------------------+      +-------------------+
   |  helpers (pipeline) |  +-->|  parseConfig      |
   |  classifyParent…    |  |   |  (schema.ts)      |
   |  nextState          |  |   +-------------------+
   |  findState          |  |
   +---------------------+  |
              |             |
              v             |
   +---------------------+  |
   |   PipelineSource    |--+   read seam (interface only)
   +----------+----------+
              |
   +----------+--------------+----------------------+
   |          |              |                      |
   v          v              v                      v
 Memory     Dropbox       (later) Local FS    (later) other
 (tests)    (next round)
```

## Decisions

### D-P1. Per-folder config, no inheritance.
A folder is a pipeline iff it directly contains
`.dropbox-interface.json`. Predictable, one extra API call per
navigation, no surprising parent-of-parent lookups. We can add an
`inherits: true` flag and a documented walk-up later without breaking the
v1 contract.

### D-P2. Items outside state folders go in an Inbox bucket.
Default-visible. Configurable on/off and renamable via the JSON. Mirrors
how teams already use a top-level dump for newly-arrived content. The
config file itself is filtered out of the inbox.

### D-P3. Direct children only, no recursion.
`classifyParentListing` and the eventual UI consume the immediate
contents of each state folder. Subfolders inside a state render as
folder rows; clicking one drops back into the regular browser at that
path. Avoids per-folder N×M API call counts and ambiguity when state
folders themselves contain pipelines.

### D-P4. Strict slug ids, permissive folder names.
State `id` matches `^[a-z0-9][a-z0-9_-]*$` (programmatic identity).
`folder` is any non-empty string compared case-sensitively against
listings (whatever the human typed in Dropbox). This split keeps URLs /
React keys clean while letting the user keep their existing folder
naming convention.

### D-P5. PipelineSource is the only seam to backends.
Two methods: `loadConfig(parentPath)` and `listChildren(parentPath)`.
The library never imports a backend module directly; tests use
`InMemoryPipelineSource`. Keeping the surface minimal makes adding a
local-FS backend trivial later.

### D-P6. Multi-issue validator.
`parseConfig` accumulates all issues before returning. Future config
editor doesn't have to play whack-a-mole; CI / lint can list every
problem at once.

### D-P7. View mode is a thin presentational toggle, not a config knob.
Whether a pipeline renders as a list or a thumbnail gallery is a
local UI preference, not part of `.dropbox-interface.json`. Two
reasons:

1. The team-shared config should describe the *workflow* (states,
   names, ordering). The same pipeline might be image-heavy for
   one operator's review session and doc-heavy for another's;
   forcing a global per-pipeline default would be wrong.
2. Persisting per *path* under `dropbox-interface:pipeline-view-mode:v1`
   keeps the seam local to the renderer — `PipelineView` only renders
   gallery when the caller supplies a `renderEntryTile`, so a
   future local-FS pipeline view can opt in (or out) without the
   model layer noticing. Schema stays untouched.

### D-P8. Keyboard nav lives at the panel, not on individual rows.
The active bucket panel is `tabIndex={0}` and owns the keydown
handler; rows don't manage their own focus. This avoids a forest of
arrow-key listeners and stays compatible with virtualized lists if
we ever add them. The handler bails out when the keydown originated
in an `<input>`, `<textarea>`, or contenteditable so the filter chip
and note editor keep working without a special bypass.

## What we explicitly do not support yet

- **Inheritance from ancestor folders.** Add later behind a flag.
- **Multiple pipelines per parent.** One config, one `kind`.
- **Recursive item counting.** Counts reflect direct children only.
- **Server-side rules.** This is purely a client-side projection of the
  folder structure; Dropbox itself doesn't know about pipelines.
- **Branching workflows.** The model is a strict ordered list. No DAGs.
  If we ever need a back-edge ("send back to processing"), it's a
  separate feature on top, not a schema change.

## Roadmap

Done:

1. ✅ **Pipeline lib.** `parseConfig`, helpers, `PipelineSource` interface.
2. ✅ **Dropbox source.** `dropbox_read_text_file` Rust command + frontend
   `DropboxPipelineSource` implementing the interface against
   `dropbox_list_folder` + the new text-read command. Reads are
   size-capped (256KB default) and `path/not_found` becomes `null`.
3. ✅ **Pipeline UI.** `PipelineView` (Dropbox-specific for v1)
   classifies the parent listing, renders a tab-strip of present states
   plus an Inbox bucket, lazy-loads each state folder's contents on
   selection, surfaces missing-folder warnings, and delegates row
   rendering back to `DropboxApp` so thumbnails / preview / Save still
   work.
4. ✅ **Discovery.** `DropboxApp` parallel-fetches the listing and the
   config on every navigation. Valid config → `PipelineView`, invalid
   config → flat browser + issue banner, missing config → flat browser.

5. ✅ **Promote action.** `dropbox_move_v2` + Promote button + Undo
   toast.
6. ✅ **`dropbox_create_folder_v2`** for the missing-state affordance.
7. ✅ **Inbox → first-state Promote** verb (button + drag-drop
   target).
8. ✅ **Drag-and-drop promote** between any two buckets, including
   Inbox-as-target (un-file an item back to the parent root).
9. ✅ **Recent pipelines** quick-launch card on the dashboard
   (`pipeline-recents.ts` + `DropboxApp.initialPath`).
10. ✅ **Pinning** for recents (per-entry `pinned` flag, dashboard
    + in-pipeline-view toggle).
11. ✅ **Bulk Promote** (per-bucket selection, parallel moves with
    `Promise.allSettled`, batch Undo).
12. ✅ **Local-only notes** keyed by Dropbox path
    (`pipeline-notes.ts` + Note button + editor modal).
13. ✅ **`delete_v2`** with confirm modal. See THREAT_MODEL §D8e.
14. ✅ **Filter chip per bucket** (`lib/filter.ts`) and global
    settings panel (theme + dashboard layout) for the shell.
15. ✅ **Gallery view + keyboard nav.** Per-pipeline list/gallery
    toggle (`view-mode.ts`); `GalleryTile` mirrors the row
    affordances; panel owns j/k/Enter/Space/p/Esc/?.

Next:
16. **Team-shared notes** if/when policy flips on
    `files.content.write` — the helper is shaped so the storage
    backend can swap from `localStorage` to a Dropbox sidecar
    file (`.dropbox-interface-notes.json`) without touching the UI.
17. **Local backend** (optional). Mirror `DropboxPipelineSource` for
    the local FS so the existing `FileBrowser` can host pipelines too.

## Updating this doc

Pipeline-shape changes (new fields, new `kind` values, semantic shifts in
how states/folders relate) update this doc + bump `version` in the
schema. Bumps are accompanied by a migration note here.
