# Pipelines

State-aware folder views for review workflows. A *pipeline* is an ordered
list of *states*, each backed by one direct child folder of a parent. An
*item* (file or sub-folder) is in exactly one state at a time, defined by
which state folder is its direct parent. **Promotion** = moving an item
from its current state folder to the next one in pipeline order.

## Status

**v1 architecture landed.** Model layer, validator, pure helpers, and the
read seam (`PipelineSource`) are in place with exhaustive tests. No UI, no
Rust commands, no write ops yet — those land in follow-up rounds against
this contract.

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

## What we explicitly do not support yet

- **Inheritance from ancestor folders.** Add later behind a flag.
- **Multiple pipelines per parent.** One config, one `kind`.
- **Recursive item counting.** Counts reflect direct children only.
- **Server-side rules.** This is purely a client-side projection of the
  folder structure; Dropbox itself doesn't know about pipelines.
- **Branching workflows.** The model is a strict ordered list. No DAGs.
  If we ever need a back-edge ("send back to processing"), it's a
  separate feature on top, not a schema change.

## Roadmap sketch

The model layer (this round) is the contract. Each future round plugs in
without touching the pipeline lib:

1. **Dropbox source.** `DropboxPipelineSource` implements `PipelineSource`
   against the existing `dropbox_list_folder` + a new
   `dropbox_read_text_file` (or `dropbox_read_pipeline_config`) command.
   Validates the bytes through `parseConfig`.
2. **Pipeline UI.** A `PipelineView` component that takes
   `(config, classification, perStateListings)` and renders the bucket
   strip + per-state lists, reusing the existing entry rows (thumbnails,
   preview-on-click, Save).
3. **Promote action.** `dropbox_move_v2` Tauri command, wired to a
   "Promote" button on each entry that uses `nextState` to figure out the
   destination. Refresh the affected listings on success.
4. **Discovery.** When `DropboxApp` opens a folder, it asks the source
   for `.dropbox-interface.json`; if present and valid, it switches to
   `PipelineView`; otherwise the existing flat browser.
5. **Local backend** (optional, later). Same interface, mirroring the
   local file browser.

## Updating this doc

Pipeline-shape changes (new fields, new `kind` values, semantic shifts in
how states/folders relate) update this doc + bump `version` in the
schema. Bumps are accompanied by a migration note here.
