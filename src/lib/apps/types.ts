/**
 * Type definitions for the sub-application registry. App modules
 * import from here (NOT `./registry`) so the registry stays the
 * one-and-only composition point.
 */

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Loose categorization so a future dashboard pass can group cards by
 * theme. Open-ended via string casts when an app needs a new bucket.
 */
export type AppCategory = "workspace" | "media" | "cloud" | "data";

/**
 * Optional payload handed to the render function when an app is
 * launched via a deep-link affordance (e.g. dashboard "Recent
 * pipelines" passes a folder path into the Dropbox app). Shape is
 * deliberately unknown — each app narrows it at the call site. Apps
 * that don't accept deep links ignore the field.
 */
export type AppDeepLink = unknown;

/** Per-render context passed by the shell into every active app. */
export type AppContext = {
  /** Return to the dashboard. Wired by the shell. */
  goHome: () => void;
  /**
   * Launch another registered app from inside the current one.
   * Used for cross-app deep-links (e.g. Job Tracker → CRM at a
   * specific contact). The payload is forwarded to the target
   * app's `render(ctx)` as `ctx.deepLink`; each target narrows it
   * at the call site. No-ops when `targetAppId` isn't registered.
   */
  launchApp: (targetAppId: string, payload?: AppDeepLink) => void;
  /**
   * Set when the user launched this app via a deep-link (e.g. a
   * recent-pipelines row); otherwise undefined for a plain card
   * launch.
   */
  deepLink?: AppDeepLink;
};

/**
 * A registered sub-application. Each app module exports one of these
 * as a named export, and `registry.ts` collects them into `APPS`.
 */
export type AppDescriptor = {
  /** URL-safe slug. Used as the React key and the active-app id. */
  id: string;
  /** Header label rendered when the app is active. */
  title: string;
  dashboardCard: {
    icon: LucideIcon;
    description: string;
    /** Button label. Defaults to `Open ${title}` when omitted. */
    launchLabel?: string;
    category?: AppCategory;
  };
  /**
   * Returns the active-app body. Called by the shell while this app
   * is the active one.
   */
  render(ctx: AppContext): ReactNode;
};
