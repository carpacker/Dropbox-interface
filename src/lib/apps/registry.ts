/**
 * Single source of truth for the dashboard's launchable sub-applications.
 *
 * Each app exports an `AppDescriptor` from its own module (e.g.
 * `crm-app.tsx → crmAppDescriptor`) and the registry composes them
 * here. `App.tsx` builds dashboard cards + the active-app render branch
 * from `APPS`, so adding a sub-application means writing one file +
 * adding two lines (import + array push).
 *
 * **No I/O, no React state.** This module just describes the catalog;
 * the live `App` component owns the active-app state and passes an
 * `AppContext` into the render function.
 *
 * Import discipline: each app module imports the *types* from
 * `./types`, NOT this file. The composition here imports the
 * descriptors. That keeps the graph acyclic.
 */

import { crmAppDescriptor } from "@/components/crm-app";
import { desktopWorkspaceAppDescriptor } from "@/components/desktop-workspace-app";
import { dropboxAppDescriptor } from "@/components/dropbox-app";
import { jobTrackerAppDescriptor } from "@/components/job-tracker-app";
import { photosAppDescriptor } from "@/components/photos-app";

import type { AppDescriptor } from "./types";

/**
 * Validate the registry: duplicate ids would make the lookup
 * non-deterministic and dashboard cards ambiguous.
 */
function assertUniqueIds(apps: AppDescriptor[]): AppDescriptor[] {
  const seen = new Set<string>();
  for (const app of apps) {
    if (seen.has(app.id)) {
      throw new Error(
        `Duplicate AppDescriptor id ${JSON.stringify(app.id)}; ` +
          `each app must have a unique id.`,
      );
    }
    seen.add(app.id);
  }
  return apps;
}

/**
 * Registered sub-applications, in dashboard order. Add a new app by
 * importing its descriptor above and appending it here.
 */
export const APPS: ReadonlyArray<AppDescriptor> = assertUniqueIds([
  desktopWorkspaceAppDescriptor,
  photosAppDescriptor,
  dropboxAppDescriptor,
  crmAppDescriptor,
  jobTrackerAppDescriptor,
]);

/** Find a registered app by id, or undefined when not present. */
export function findApp(id: string): AppDescriptor | undefined {
  return APPS.find((a) => a.id === id);
}
