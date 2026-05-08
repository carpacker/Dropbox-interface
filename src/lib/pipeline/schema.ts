/**
 * Schema for `.dropbox-interface.json` pipeline config files.
 *
 * Lives in a single parent folder; describes how that folder's direct
 * children map to an ordered list of states. The model is intentionally
 * tiny and serializable so the same config can be authored by hand,
 * round-tripped through Dropbox, and consumed by either a Dropbox or
 * (eventually) local filesystem source.
 *
 * No I/O happens in this module. Use `parseConfig(unknown)` to validate
 * arbitrary input. See `docs/architecture/pipelines.md` for the rationale.
 */

/** A single state in a pipeline. Maps to one direct subfolder. */
export type PipelineState = {
  /**
   * Stable slug, used as the React key, query param, etc. Lowercase
   * alphanumeric plus `-` and `_`. Must start with an alphanumeric.
   */
  id: string;
  /**
   * Exact basename of the subfolder representing this state, e.g.
   * `1__Processing`. Compared case-sensitively against folder listings.
   */
  folder: string;
  /** Human-friendly label shown in the UI. */
  name: string;
  /** Optional description shown when the state header is hovered/expanded. */
  description?: string;
  /**
   * If true, the UI does not offer a "Promote" action out of this state.
   * Defaults to false; the last state in `states` is the natural sink
   * regardless of this flag.
   */
  terminal?: boolean;
};

export type PipelineInbox = {
  /** Whether to render an Inbox bucket for items not in any state folder. */
  show: boolean;
  /** Optional override for the bucket label. Defaults to "Inbox". */
  name?: string;
};

export type PipelineConfig = {
  version: 1;
  kind: "pipeline";
  /** Optional team-facing label for the whole pipeline. */
  name?: string;
  /** Optional team-facing description. */
  description?: string;
  /** Ordered list of states. Promotion follows this order. */
  states: PipelineState[];
  /** Inbox behavior; defaults are applied when the field is missing. */
  inbox: PipelineInbox;
};

export type ConfigIssueCode =
  | "invalid_root"
  | "missing_field"
  | "invalid_type"
  | "unsupported_version"
  | "invalid_kind"
  | "empty_states"
  | "invalid_state_id"
  | "duplicate_state_id"
  | "duplicate_state_folder"
  | "empty_string";

export type ConfigIssue = {
  /** JSON-pointer-ish path to the offending field (e.g. `/states/1/id`). */
  path: string;
  code: ConfigIssueCode;
  message: string;
};

export type ParseResult =
  | { ok: true; config: PipelineConfig }
  | { ok: false; issues: ConfigIssue[] };

const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

const DEFAULT_INBOX: PipelineInbox = { show: true };

/**
 * Validate a parsed JSON value against the pipeline config schema.
 *
 * Returns either a fully-typed `PipelineConfig` (with optional fields
 * defaulted) or a list of structured issues. Multiple issues are returned
 * when present so a future config editor can surface them all at once.
 */
export function parseConfig(input: unknown): ParseResult {
  const issues: ConfigIssue[] = [];

  if (!isPlainObject(input)) {
    return {
      ok: false,
      issues: [
        {
          path: "",
          code: "invalid_root",
          message: "Pipeline config must be a JSON object.",
        },
      ],
    };
  }

  const root = input;

  // version
  const version = root["version"];
  if (version === undefined) {
    issues.push(missing("/version"));
  } else if (version !== 1) {
    issues.push({
      path: "/version",
      code: "unsupported_version",
      message: `Unsupported config version ${JSON.stringify(version)}; expected 1.`,
    });
  }

  // kind
  const kind = root["kind"];
  if (kind === undefined) {
    issues.push(missing("/kind"));
  } else if (kind !== "pipeline") {
    issues.push({
      path: "/kind",
      code: "invalid_kind",
      message: `Unsupported kind ${JSON.stringify(kind)}; expected "pipeline".`,
    });
  }

  // optional name + description
  const name = optionalString(root["name"], "/name", issues);
  const description = optionalString(
    root["description"],
    "/description",
    issues,
  );

  // states
  const states = parseStates(root["states"], issues);

  // inbox (optional, defaults applied)
  const inbox = parseInbox(root["inbox"], issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // After this point the partial values are valid; build the typed result.
  return {
    ok: true,
    config: {
      version: 1,
      kind: "pipeline",
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      states: states ?? [],
      inbox: inbox ?? DEFAULT_INBOX,
    },
  };
}

function parseStates(
  raw: unknown,
  issues: ConfigIssue[],
): PipelineState[] | undefined {
  if (raw === undefined) {
    issues.push(missing("/states"));
    return undefined;
  }
  if (!Array.isArray(raw)) {
    issues.push(typeError("/states", "array"));
    return undefined;
  }
  if (raw.length === 0) {
    issues.push({
      path: "/states",
      code: "empty_states",
      message: "states must contain at least one entry.",
    });
    return undefined;
  }

  const seenIds = new Set<string>();
  const seenFolders = new Set<string>();
  const out: PipelineState[] = [];

  raw.forEach((entry, idx) => {
    const base = `/states/${idx}`;
    if (!isPlainObject(entry)) {
      issues.push(typeError(base, "object"));
      return;
    }
    const id = requiredString(entry["id"], `${base}/id`, issues);
    const folder = requiredString(entry["folder"], `${base}/folder`, issues);
    const sname = requiredString(entry["name"], `${base}/name`, issues);
    const sdesc = optionalString(
      entry["description"],
      `${base}/description`,
      issues,
    );
    const terminal = optionalBool(
      entry["terminal"],
      `${base}/terminal`,
      issues,
    );

    if (id !== undefined) {
      if (!SLUG_RE.test(id)) {
        issues.push({
          path: `${base}/id`,
          code: "invalid_state_id",
          message: `state id ${JSON.stringify(
            id,
          )} must match ${SLUG_RE.source}.`,
        });
      } else if (seenIds.has(id)) {
        issues.push({
          path: `${base}/id`,
          code: "duplicate_state_id",
          message: `state id ${JSON.stringify(id)} is already used.`,
        });
      } else {
        seenIds.add(id);
      }
    }

    if (folder !== undefined) {
      if (seenFolders.has(folder)) {
        issues.push({
          path: `${base}/folder`,
          code: "duplicate_state_folder",
          message: `state folder ${JSON.stringify(
            folder,
          )} is already mapped by an earlier state.`,
        });
      } else {
        seenFolders.add(folder);
      }
    }

    if (id !== undefined && folder !== undefined && sname !== undefined) {
      const state: PipelineState = { id, folder, name: sname };
      if (sdesc !== undefined) state.description = sdesc;
      if (terminal === true) state.terminal = true;
      out.push(state);
    }
  });

  return out;
}

function parseInbox(
  raw: unknown,
  issues: ConfigIssue[],
): PipelineInbox | undefined {
  if (raw === undefined) {
    return DEFAULT_INBOX;
  }
  if (!isPlainObject(raw)) {
    issues.push(typeError("/inbox", "object"));
    return undefined;
  }
  const show = raw["show"];
  let parsedShow = DEFAULT_INBOX.show;
  if (show !== undefined) {
    if (typeof show !== "boolean") {
      issues.push(typeError("/inbox/show", "boolean"));
    } else {
      parsedShow = show;
    }
  }
  const inboxName = optionalString(raw["name"], "/inbox/name", issues);
  const inbox: PipelineInbox = { show: parsedShow };
  if (inboxName !== undefined) inbox.name = inboxName;
  return inbox;
}

// -------------------------------------------------------------- helpers

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function missing(path: string): ConfigIssue {
  return {
    path,
    code: "missing_field",
    message: `${path || "(root)"} is required.`,
  };
}

function typeError(path: string, expected: string): ConfigIssue {
  return {
    path,
    code: "invalid_type",
    message: `${path || "(root)"} must be ${expected}.`,
  };
}

/**
 * Returns the validated string, or `undefined` when absent or invalid
 * (in which case an issue has been recorded). Mirrors `optionalString`'s
 * convention so callers can use the same `value !== undefined` guard.
 */
function requiredString(
  v: unknown,
  path: string,
  issues: ConfigIssue[],
): string | undefined {
  if (v === undefined) {
    issues.push(missing(path));
    return undefined;
  }
  if (typeof v !== "string") {
    issues.push(typeError(path, "string"));
    return undefined;
  }
  if (v.length === 0) {
    issues.push({
      path,
      code: "empty_string",
      message: `${path} must not be empty.`,
    });
    return undefined;
  }
  return v;
}

/**
 * Returns the validated string, or `undefined` when the field was either
 * absent or invalid (in which case an issue has been recorded). Callers
 * cannot distinguish "absent" from "invalid" by looking at the return —
 * they don't need to, because `parseConfig` aborts assembly when issues
 * exist.
 */
function optionalString(
  v: unknown,
  path: string,
  issues: ConfigIssue[],
): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    issues.push(typeError(path, "string"));
    return undefined;
  }
  if (v.length === 0) {
    issues.push({
      path,
      code: "empty_string",
      message: `${path} must not be empty.`,
    });
    return undefined;
  }
  return v;
}

function optionalBool(
  v: unknown,
  path: string,
  issues: ConfigIssue[],
): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") {
    issues.push(typeError(path, "boolean"));
    return undefined;
  }
  return v;
}
