# Upcoming apps — architecture sketches

This doc lays out the *shape* of three apps the user has called out as
next-up, plus one cross-cutting feature ("Metadata Guards") that
touches the pipeline arch. None of this is built yet. The point is to
decide structure on paper before writing code, so a later round can
implement against a settled design.

Pull requests that implement any of these MUST update this file with
the actual final shape (and link back to the round that landed it).

---

## A. Metadata Guards (pipeline extension)

**Problem statement.** Routine workflows have preconditions: a photo
isn't "Processed" until certain metadata is attached. Today Promote
blindly moves an item to the next state regardless. We want pipeline
states to declare required metadata for entry/exit, and have the UI
block Promote (with a clear "what's missing" message) until those
fields are present.

### Where it lives

- **Schema** (`src/lib/pipeline/schema.ts`): `PipelineState` grows an
  optional `requires` field:
  ```ts
  type RequiredField = {
    /** Stable id used as the metadata-table key. */
    id: string;
    /** Display label. */
    name: string;
    /** Free-text by default; future: enum, date, number. */
    type?: "text";
  };
  type PipelineState = {
    // ...existing...
    /**
     * Fields that must be present on a row's metadata for the row
     * to leave THIS state via Promote. Validated by `nextState`
     * helpers; the UI reads the same predicate to decide whether
     * to render the Promote button.
     */
    requires?: RequiredField[];
  };
  ```

- **Storage**: sidecar JSON `<parent>/.dropbox-interface-meta.json`
  living next to the pipeline config. Shape:
  ```json
  {
    "version": 1,
    "byEntry": {
      "<filename or relative path>": {
        "approved_by": "Carson",
        "credit": "@photog"
      }
    }
  }
  ```
  Stored per-pipeline-parent (not per-item) so a single read populates
  every row's metadata. Capped at 256KB by the same read path as the
  pipeline config.

- **Read seam**: `PipelineSource` grows a sibling `loadMetadata` method
  (parallel to `loadConfig`) returning the same `null | unknown` shape.
  Validator (`parseMetadata`) is analogous to `parseConfig`.

- **Write seam**: `PipelineOperator` grows `writeMetadata(parent, body)`.
  Dropbox impl would need `files.content.write` — see THREAT_MODEL
  §D8b. Local impl uses `local_write_text_file` (already exists).

### UI

- A per-row "Metadata complete?" computation runs in `PipelineView`'s
  `renderEntryList`. Result drives the row's Promote button's
  `disabled` + a small badge ("2 missing") next to the entry name.
- Clicking the badge opens an inline editor (modal, same pattern as
  `CrmRowEditor`) populated with the declared fields. Save writes
  through `operator.writeMetadata`.

### Why this is a guard, not an action

Promoting an item without metadata is a routine *mistake* the workflow
should prevent — not a *capability* the user opts into. Following the
threat-model pattern (D8c: reversibility, D8e: confirm-gated delete),
guards are pre-flight; nothing destructive happens automatically.

### Threat model

Adding a write surface to the Dropbox operator is the gate that flips
§D8b. **Do not ship Dropbox metadata writes without an explicit
discussion of the new scope.** The local-FS implementation is fine
under the existing D-L1/D-L2 caps.

### Test surface

- `parseMetadata` accumulates issues like `parseConfig`.
- `PipelineView` Promote button renders `disabled + missingCount` when
  the row's metadata is incomplete; renders enabled when complete.
- Editor modal writes through the operator with the right path.
- Sidecar JSON survives a round-trip.

---

## B. Job Tracker

**Problem statement.** Track jobs from inquiry → close. Each job has a
status (Inquiry / Booked / Shooting / Editing / Delivered / Closed,
configurable), a primary client (links to CRM), and sidecar files +
threads + project-management notes. Multiple teammates open the
dashboard, click into a job, do work, leave a note.

### Shape

Structurally, this is **CRM + grouping by a status column**:

- One root folder per "Job Manager" instance (mirrors CRM):
  ```
  <root>/jobs.csv                    ← rows = jobs
  <root>/files/<rowKey>/             ← per-job attachments
  <root>/threads/<rowKey>.jsonl      ← append-only event log per job
  ```

- Status column is one of the CSV columns. The Job Tracker view
  groups rows by status into a **board view** (kanban-ish, one column
  per status). Reuse the apps-registry seam.

### Reuse vs. new code

- `parseCsv` / `serializeCsv` — same.
- `crm-config.ts` shape — clone as `job-tracker-config.ts` with the
  same persistence pattern.
- `crm-row-key.ts` — share verbatim (just import).
- Row editor (modal w/ per-column inputs) — share or duplicate. v1:
  duplicate (fork it cheap), de-dupe in a follow-up if the columns
  diverge.

### New code

- **Status column picker.** Job Tracker config stores which CSV column
  is the status column. Defaults to a column named `status`
  (case-insensitive). Falls back to a single-column "Backlog" board.
- **Status values list.** Either declared in a separate config file
  (`<root>/.job-tracker.json`) or auto-derived from the unique values
  in the status column. v1: auto-derived, declare in a follow-up.
- **Board renderer.** Each status → a `Card` column with the matching
  rows as draggable chips. Reuses the pipeline's drag-drop pattern
  (a `DRAG_MIME` payload + dropzone chips).
- **Per-job drawer.** Like the CRM detail panel, but bigger — three
  sections:
  1. Fields (editable, same as CRM).
  2. Attachments (`<root>/files/<rowKey>/`, same as CRM).
  3. Thread (`<root>/threads/<rowKey>.jsonl`, append-only log; each
     line is `{ at: ISO, by: string, kind: "note" | "email-link",
     body: string }`). v1 surfaces just notes; email-link is a
     future round (likely opens a `mailto:` or jumps to a configured
     mail-client URL).

### CRM linkage

Each job row has a `client_id` column that references the CRM's row
key. The job drawer renders a small "Client" card with a click-through
that launches the CRM with the deep-link `client_id`. The CRM in turn
needs a (future) "open this contact" deep-link — a one-line extension
to `CrmApp`'s `initialRoot` prop (add an optional `initialRowKey`).

### Threat model

No new commands. Read + write the same way the CRM does (already
covered by D-L1 / D-L2 / D-L3). The thread JSONL is just append-only
`local_write_text_file` rewrites — cap at 16MB per file (same as
CSV); large threads will need a "rotate" affordance later.

---

## C. Social Media Tester

**Problem statement.** Mock up what an Instagram grid / post will look
like with a candidate photo set. Drag photos in, swap them around, see
the grid render at IG dimensions. No publishing — pure local preview.

### Shape

- Reads a **photo set** from one of two sources:
  1. A pipeline state folder (e.g. `2__ready` under a content
     pipeline). Picker shows pipelines from `pipeline-recents` /
     `dropbox-recents`.
  2. A loose local folder (user picks via the open dialog).
- Renders three views:
  - **Single post preview**: one image at IG dimensions (4:5 portrait,
     1:1 square, 9:16 reel) with caption draft below.
  - **Grid preview**: 3-column 1:1 grid showing the last N posts as
     they'd appear on a profile.
  - **Carousel preview**: drag to reorder; arrow-key navigation.
- All previews are read-only. No upload, no IG API. The point is
  *workshopping*: "what would this look like if I posted it?"

### State

- Selected source (pipeline path OR local folder path).
- Ordered list of selected image paths (a `Set` won't work; the user
  needs ordering control).
- Per-post draft caption (local-only, keyed by image path under
  `dropbox-interface:social:drafts:v1`).

### No new IPC

Uses existing `convertFileSrc` for local images and
`dropbox_download_to_temp` for Dropbox images (already shipped). The
"swap an image" gesture is a pure state mutation — no FS write.

### Threat model

Nothing new. All read paths exist. No network calls; we explicitly do
NOT hit Instagram's API.

---

## D. Routine helpers (cross-cutting)

Things that don't deserve their own app but show up in multiple apps:

### D.1. Recent X cards on the dashboard

Pattern is established (`pipeline-recents`, `crm-recents`). Each app
that wants one ships its own persistence helper, and `App.tsx` renders
a card per recents bucket.

When 4+ buckets accumulate, fold them into a single Recent activity
section grouped by app. Premature today.

### D.2. Backend-agnostic "Recent X" promotion to the registry

If multiple apps want their own recents, the registry can grow a
`dashboardExtras?: () => ReactNode` field on `AppDescriptor`. Each
app contributes its own card. The shell renders them in registry
order beneath the dashboard grid.

Postpone until at least three apps need it (the third would justify
the seam — today it's still two).

### D.3. Activity log

Every write op (CRM rewrite, attach, pipeline Promote, future job
state change) appends to an in-memory rolling log. The dashboard
shows the last N actions as a small Activity card with timestamps.
Useful for "what did I just do?" Not the same as the per-job thread;
this is shell-level.

Postpone — needs a real workflow to design against.
