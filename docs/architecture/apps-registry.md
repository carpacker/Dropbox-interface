# Sub-applications registry

The dashboard composes from a flat list of `AppDescriptor`s, one per
sub-application. Adding a new sub-app is one file + one import.

## Why a registry

The early shell hardcoded each sub-app in `App.tsx`: a literal-union
`AppId`, a `useState` branch, a `case` in the title switch, a `<Card>`
in the dashboard grid, and a conditional render at the bottom. Five
edits per app — fine at three apps, bad at six. The CRM round was the
moment to extract the seam: shipping a fourth app *and* the
abstraction at once forced the abstraction to actually generalize
instead of overfitting to the existing three.

## Shape

```ts
type AppDescriptor = {
  id: string;        // URL-safe slug; unique across registry
  title: string;     // header label + default launch label
  dashboardCard: {
    icon: LucideIcon;
    description: string;
    launchLabel?: string;          // default: "Open <title>"
    category?: AppCategory;
  };
  render(ctx: AppContext): ReactNode;
};
```

`AppContext`:

```ts
type AppContext = {
  goHome: () => void;          // wired by the shell
  deepLink?: AppDeepLink;      // unknown; each app narrows
};
```

## Files

- `src/lib/apps/types.ts` — `AppDescriptor`, `AppContext`,
  `AppCategory`, `AppDeepLink`. **App modules import from here**.
- `src/lib/apps/registry.ts` — composes the descriptors into `APPS`,
  validates id uniqueness, exposes `findApp(id)`. **The shell imports
  from here**.
- Each app module exports a named descriptor:
  - `desktop-workspace-app.tsx` → `desktopWorkspaceAppDescriptor`
  - `photos-app.tsx` → `photosAppDescriptor`
  - `dropbox-app.tsx` → `dropboxAppDescriptor`
  - `crm-app.tsx` → `crmAppDescriptor`

## Decisions

### A-1. Apps import types; the registry imports apps.

Import discipline keeps the graph acyclic. Each app module imports
`AppDescriptor` from `./types`; `registry.ts` imports the
descriptors. If apps ever needed to look each other up, they'd go
through `findApp(id)` — but that's not needed today.

### A-2. Id uniqueness is enforced at module load.

Duplicate ids would make the lookup non-deterministic and dashboard
cards ambiguous. `assertUniqueIds()` in `registry.ts` throws on
load, so the test suite catches it (`registry.test.ts`) before
runtime.

### A-3. Deep-links are an opaque payload, not a typed union.

Each app narrows `AppDeepLink` at its own call site (Dropbox checks
for `string`; CRM ignores the field entirely). A typed union would
couple the registry to each app's payload shape; the cost of
narrowing per-app is low.

### A-4. Deep-links thread through `launch(id, payload?)` only.

The shell stores `deepLink` in component state and clears it on
`goHome`. Apps never see a stale deep-link from a prior session;
they get the same `undefined` they'd see from a plain card launch.

### A-5. Recent-pipelines stays on the shell (for now).

The Recent-pipelines card is rendered by `App.tsx` (not by the
Dropbox app) because the dashboard is the right surface for "things
to jump back into." Today the card only targets the Dropbox app. If
local-FS pipelines (or any future backend) want their own
recents, the cleanest move is a per-app `dashboardExtras` slot on
the descriptor — but that's premature until there's a second
recents bucket to design against.

### A-6. ErrorBoundary wraps the active-app render in one place.

The shell wraps `activeApp.render(ctx)` in a single `<ErrorBoundary
label={activeApp.title}>`. Sub-apps don't need to opt into their own
boundary; they get one for free. A sub-app that wants finer-grained
boundaries (e.g. the Dropbox app already wraps its `PipelineView`)
can still install them internally.

## How to add a sub-application

1. Create `src/components/my-app.tsx`:

```tsx
import { Sparkles } from "lucide-react";
import type { AppDescriptor } from "@/lib/apps/types";

export function MyApp() {
  return <div>…</div>;
}

export const myAppDescriptor: AppDescriptor = {
  id: "my-app",
  title: "My App",
  dashboardCard: {
    icon: Sparkles,
    description: "What it does in one sentence.",
    category: "data",
  },
  render: () => <MyApp />,
};
```

2. Import the descriptor in `src/lib/apps/registry.ts` and append it to
   `APPS`:

```ts
import { myAppDescriptor } from "@/components/my-app";

export const APPS: ReadonlyArray<AppDescriptor> = assertUniqueIds([
  desktopWorkspaceAppDescriptor,
  photosAppDescriptor,
  dropboxAppDescriptor,
  crmAppDescriptor,
  myAppDescriptor,
]);
```

3. (Optional) If the app accepts a deep-link from another surface
   (e.g. a new dashboard card or a row in another app), the launcher
   calls `launch("my-app", payload)`; the app reads
   `ctx.deepLink` and narrows it.
