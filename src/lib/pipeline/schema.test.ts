import { describe, expect, it } from "vitest";

import { parseConfig, type ConfigIssue } from "./schema";

const minimal = {
  version: 1,
  kind: "pipeline",
  states: [{ id: "ready", folder: "1__Ready", name: "Ready" }],
};

function issuesOf(input: unknown): ConfigIssue[] {
  const r = parseConfig(input);
  if (r.ok) throw new Error("expected parse to fail");
  return r.issues;
}

describe("parseConfig — happy path", () => {
  it("accepts a minimal config and applies inbox defaults", () => {
    const r = parseConfig(minimal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.version).toBe(1);
    expect(r.config.kind).toBe("pipeline");
    expect(r.config.states).toHaveLength(1);
    expect(r.config.states[0]).toEqual({
      id: "ready",
      folder: "1__Ready",
      name: "Ready",
    });
    // default inbox is { show: true } with no name
    expect(r.config.inbox).toEqual({ show: true });
  });

  it("preserves optional name + description on the root", () => {
    const r = parseConfig({
      ...minimal,
      name: "Artist review",
      description: "Per-artist content pipeline",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.name).toBe("Artist review");
    expect(r.config.description).toBe("Per-artist content pipeline");
  });

  it("preserves optional state description and terminal flag", () => {
    const r = parseConfig({
      version: 1,
      kind: "pipeline",
      states: [
        {
          id: "processing",
          folder: "1__Processing",
          name: "Processing",
          description: "Untouched intake",
        },
        {
          id: "ready",
          folder: "2__ready",
          name: "Ready",
          terminal: true,
        },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.states[0].description).toBe("Untouched intake");
    expect(r.config.states[1].terminal).toBe(true);
    // Non-terminal state should not have the flag set at all.
    expect(r.config.states[0].terminal).toBeUndefined();
  });

  it("respects an explicit inbox override", () => {
    const r = parseConfig({
      ...minimal,
      inbox: { show: false, name: "Other" },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.inbox).toEqual({ show: false, name: "Other" });
  });

  it("accepts inbox with only `show`", () => {
    const r = parseConfig({ ...minimal, inbox: { show: false } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.inbox).toEqual({ show: false });
  });

  it("treats omitted inbox.show as the default (true)", () => {
    const r = parseConfig({ ...minimal, inbox: { name: "Other" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.inbox).toEqual({ show: true, name: "Other" });
  });
});

describe("parseConfig — root-level errors", () => {
  it("rejects non-object inputs", () => {
    expect(issuesOf(null)[0]).toMatchObject({ code: "invalid_root", path: "" });
    expect(issuesOf(42)[0]).toMatchObject({ code: "invalid_root" });
    expect(issuesOf([])[0]).toMatchObject({ code: "invalid_root" });
    expect(issuesOf("hello")[0]).toMatchObject({ code: "invalid_root" });
  });

  it("rejects unsupported version", () => {
    const issues = issuesOf({ ...minimal, version: 2 });
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/version",
        code: "unsupported_version",
      }),
    );
  });

  it("requires version", () => {
    const { version: _v, ...rest } = minimal;
    void _v;
    const issues = issuesOf(rest);
    expect(issues).toContainEqual(
      expect.objectContaining({ path: "/version", code: "missing_field" }),
    );
  });

  it("requires kind to be pipeline", () => {
    expect(issuesOf({ ...minimal, kind: "library" })).toContainEqual(
      expect.objectContaining({ path: "/kind", code: "invalid_kind" }),
    );
  });

  it("requires kind", () => {
    const { kind: _k, ...rest } = minimal;
    void _k;
    const issues = issuesOf(rest);
    expect(issues).toContainEqual(
      expect.objectContaining({ path: "/kind", code: "missing_field" }),
    );
  });

  it("rejects empty optional strings", () => {
    expect(issuesOf({ ...minimal, name: "" })).toContainEqual(
      expect.objectContaining({ path: "/name", code: "empty_string" }),
    );
  });

  it("rejects non-string name", () => {
    expect(issuesOf({ ...minimal, name: 42 })).toContainEqual(
      expect.objectContaining({ path: "/name", code: "invalid_type" }),
    );
  });
});

describe("parseConfig — states array", () => {
  it("rejects missing states", () => {
    const { states: _s, ...rest } = minimal;
    void _s;
    expect(issuesOf(rest)).toContainEqual(
      expect.objectContaining({ path: "/states", code: "missing_field" }),
    );
  });

  it("rejects non-array states", () => {
    expect(issuesOf({ ...minimal, states: {} })).toContainEqual(
      expect.objectContaining({ path: "/states", code: "invalid_type" }),
    );
  });

  it("rejects empty states array", () => {
    expect(issuesOf({ ...minimal, states: [] })).toContainEqual(
      expect.objectContaining({ path: "/states", code: "empty_states" }),
    );
  });

  it("rejects non-object state entries", () => {
    expect(
      issuesOf({ ...minimal, states: ["not-a-state"] }),
    ).toContainEqual(
      expect.objectContaining({ path: "/states/0", code: "invalid_type" }),
    );
  });

  it("rejects state with missing required fields and reports each path", () => {
    const issues = issuesOf({ ...minimal, states: [{}] });
    expect(issues).toContainEqual(
      expect.objectContaining({ path: "/states/0/id", code: "missing_field" }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/states/0/folder",
        code: "missing_field",
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/states/0/name",
        code: "missing_field",
      }),
    );
  });

  it("rejects ill-typed required fields", () => {
    const issues = issuesOf({
      ...minimal,
      states: [{ id: 1, folder: 2, name: 3 }],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({ path: "/states/0/id", code: "invalid_type" }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/states/0/folder",
        code: "invalid_type",
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({ path: "/states/0/name", code: "invalid_type" }),
    );
  });

  it("validates state id slug format", () => {
    const issues = issuesOf({
      ...minimal,
      states: [{ id: "Has Spaces", folder: "X", name: "X" }],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/states/0/id",
        code: "invalid_state_id",
      }),
    );
  });

  it.each(["1starts-with-digit", "ok_id", "ok-id", "a", "a1_b-c"])(
    "accepts slug %s",
    (id) => {
      const r = parseConfig({
        ...minimal,
        states: [{ id, folder: "X", name: "X" }],
      });
      expect(r.ok).toBe(true);
    },
  );

  it.each(["", "Has Spaces", "UPPER", "trailing!", "_leading"])(
    "rejects slug %s",
    (id) => {
      const r = parseConfig({
        ...minimal,
        states: [{ id, folder: "X", name: "X" }],
      });
      expect(r.ok).toBe(false);
    },
  );

  it("flags duplicate state ids on the second occurrence", () => {
    const issues = issuesOf({
      ...minimal,
      states: [
        { id: "ready", folder: "1", name: "A" },
        { id: "ready", folder: "2", name: "B" },
      ],
    });
    const dup = issues.find((i) => i.code === "duplicate_state_id");
    expect(dup).toMatchObject({ path: "/states/1/id" });
  });

  it("flags duplicate state folders on the second occurrence", () => {
    const issues = issuesOf({
      ...minimal,
      states: [
        { id: "a", folder: "1__X", name: "A" },
        { id: "b", folder: "1__X", name: "B" },
      ],
    });
    const dup = issues.find((i) => i.code === "duplicate_state_folder");
    expect(dup).toMatchObject({ path: "/states/1/folder" });
  });

  it("rejects non-boolean terminal", () => {
    const issues = issuesOf({
      version: 1,
      kind: "pipeline",
      states: [
        { id: "a", folder: "X", name: "A", terminal: "yes" },
      ],
    });
    expect(issues).toContainEqual(
      expect.objectContaining({
        path: "/states/0/terminal",
        code: "invalid_type",
      }),
    );
  });
});

describe("parseConfig — inbox", () => {
  it("rejects non-object inbox", () => {
    expect(issuesOf({ ...minimal, inbox: "yes" })).toContainEqual(
      expect.objectContaining({ path: "/inbox", code: "invalid_type" }),
    );
  });

  it("rejects non-boolean show", () => {
    expect(
      issuesOf({ ...minimal, inbox: { show: "yes" } }),
    ).toContainEqual(
      expect.objectContaining({ path: "/inbox/show", code: "invalid_type" }),
    );
  });

  it("rejects empty name", () => {
    expect(
      issuesOf({ ...minimal, inbox: { show: true, name: "" } }),
    ).toContainEqual(
      expect.objectContaining({ path: "/inbox/name", code: "empty_string" }),
    );
  });
});

describe("parseConfig — multi-issue accumulation", () => {
  it("collects multiple issues in one pass instead of bailing on the first", () => {
    const issues = issuesOf({
      version: 9,
      kind: "Library",
      states: [
        { id: "BAD ID", folder: "X", name: "X" },
        { id: "ok", folder: "X", name: "Y" }, // duplicate folder
      ],
      inbox: { show: "no" },
    });
    const codes = issues.map((i) => i.code).sort();
    expect(codes).toContain("unsupported_version");
    expect(codes).toContain("invalid_kind");
    expect(codes).toContain("invalid_state_id");
    expect(codes).toContain("duplicate_state_folder");
    expect(codes).toContain("invalid_type"); // inbox.show
  });
});
