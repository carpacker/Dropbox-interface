/**
 * `PipelineSource` is the read seam between the pipeline library and a
 * concrete storage backend (Dropbox, local FS, …). The library never
 * imports a backend directly — components and helpers compose against
 * this interface, then a backend implementation is plugged in at the
 * call site.
 *
 * Backends added later (Dropbox in the next round, local FS later) live
 * in their own modules and implement this interface. Tests use
 * `InMemoryPipelineSource` so they never touch the network or disk.
 */

import { CONFIG_FILENAME, type EntryHandle } from "./pipeline";

export type PipelineSource = {
  /**
   * Read `.dropbox-interface.json` from `parentPath`. Returns the parsed
   * JSON value (still untyped — pass it through `parseConfig` to
   * validate) or `null` when the file is absent.
   *
   * Implementations should distinguish "file not present" (return null)
   * from any other error (throw) so the UI can show a precise message.
   */
  loadConfig(parentPath: string): Promise<unknown | null>;

  /**
   * List the direct children of `parentPath`. Order is not guaranteed by
   * this interface; consumers sort as needed.
   */
  listChildren(parentPath: string): Promise<EntryHandle[]>;
};

// ---- in-memory test backend -----------------------------------------

/**
 * Test double for `PipelineSource`. Construct with a `tree` mapping
 * parent paths to their direct children, plus an optional `configs`
 * map of parent paths to raw JSON config bodies.
 *
 * Lives in production code (rather than under `src/test/`) because
 * future component tests will want to import it without paying for the
 * test-alias plumbing.
 */
export class InMemoryPipelineSource implements PipelineSource {
  constructor(
    private readonly tree: Record<string, EntryHandle[]>,
    private readonly configs: Record<string, unknown> = {},
  ) {}

  async loadConfig(parentPath: string): Promise<unknown | null> {
    if (parentPath in this.configs) {
      return this.configs[parentPath];
    }
    const children = this.tree[parentPath];
    if (children?.some((c) => c.name === CONFIG_FILENAME)) {
      // Config file is present in the listing but the test didn't supply
      // a body — treat that as "ill-formed" so tests can exercise the
      // error path.
      throw new Error(
        `InMemoryPipelineSource: config body missing for ${parentPath}`,
      );
    }
    return null;
  }

  async listChildren(parentPath: string): Promise<EntryHandle[]> {
    if (!(parentPath in this.tree)) {
      throw new Error(
        `InMemoryPipelineSource: no listing registered for ${parentPath}`,
      );
    }
    return this.tree[parentPath];
  }
}
