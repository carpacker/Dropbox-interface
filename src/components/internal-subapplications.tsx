import { InternalAppShell } from "@/components/internal-app-shell";
import { PhotosApp } from "@/components/photos-app";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getInternalAppDefinition, type InternalAppId } from "@/lib/internal-apps";

function StarterPanel({
  title,
  description,
  bullets,
}: {
  title: string;
  description: string;
  bullets: string[];
}) {
  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <Separator />
        <ul className="list-inside list-disc space-y-1">
          {bullets.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function buildShell(id: InternalAppId) {
  const def = getInternalAppDefinition(id);
  return {
    def,
    shellProps: {
      title: def.title,
      description: `${def.subtitle} — ${def.description}`,
      icon: def.icon,
    },
  };
}

export function SocialMediaSubapplication() {
  const { shellProps } = buildShell("social_media");
  return (
    <InternalAppShell {...shellProps}>
      <StarterPanel
        title="Starter layout"
        description="This surface is meant to be composed with shared internal modules (like the photo viewer), not to stand alone as a generic app launcher."
        bullets={[
          "Wire real data sources (local folders, Dropbox links, APIs).",
          "Embed the internal photo viewer inside feeds and review panels.",
          "Add posting queues, captions, and asset variants as you harden the workflow.",
        ]}
      />
      <Card className="border-dashed bg-muted/20 shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-muted-foreground">Media preview region</CardTitle>
          <CardDescription>
            Mount the shared photo viewer inside specific cards once a social folder is selected — open the{" "}
            <span className="font-medium text-foreground">Photos</span> internal app to use the module
            standalone.
          </CardDescription>
        </CardHeader>
      </Card>
    </InternalAppShell>
  );
}

export function ShootsFieldSubapplication() {
  const { shellProps } = buildShell("shoots_field");
  return (
    <InternalAppShell {...shellProps}>
      <StarterPanel
        title="Field day ops"
        description="Optimized for fast capture review on location. The internal viewer sits beside checklists and metadata."
        bullets={[
          "Tether local capture folders or sync targets.",
          "Use the embedded viewer below for quick culling sessions.",
          "Later: GPS notes, weather hooks, and crew assignments.",
        ]}
      />
      <Card className="border-dashed bg-muted/20 shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-muted-foreground">Location review module</CardTitle>
          <CardDescription>Inline viewer for field captures.</CardDescription>
        </CardHeader>
        <CardContent>
          <PhotosApp variant="embedded" persistenceKey="shoots_field" />
        </CardContent>
      </Card>
    </InternalAppShell>
  );
}

export function ShootsStudioSubapplication() {
  const { shellProps } = buildShell("shoots_studio");
  return (
    <InternalAppShell {...shellProps}>
      <StarterPanel
        title="Studio session"
        description="Structured capture with predictable lighting and folder conventions — embed previews instead of hopping to a separate photo app."
        bullets={[
          "Point this surface at tether folders or NAS drops.",
          "Pair with the internal viewer for immediate full-resolution checks.",
          "Later: lighting diagrams, set references, and client selects.",
        ]}
      />
      <Card className="border-dashed bg-muted/20 shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-muted-foreground">Tether preview module</CardTitle>
          <CardDescription>Studio captures render here by default.</CardDescription>
        </CardHeader>
        <CardContent>
          <PhotosApp variant="embedded" persistenceKey="shoots_studio" />
        </CardContent>
      </Card>
    </InternalAppShell>
  );
}

export function PhotosSubapplication() {
  const { shellProps } = buildShell("photos");
  return (
    <InternalAppShell {...shellProps} footer={<p className="text-sm text-muted-foreground">This module is shared with the other internal applications. Prefer navigating through a workflow surface and embedding the viewer where possible.</p>}>
      <PhotosApp variant="embedded" persistenceKey="internal_photos" />
    </InternalAppShell>
  );
}

export function AssetsSubapplication() {
  const { shellProps } = buildShell("assets");
  return (
    <InternalAppShell {...shellProps}>
      <StarterPanel
        title="Brand + delivery library"
        description="Placeholder for logos, exports, and client deliveries. Hook this to your canonical asset directories."
        bullets={[
          "Define roots for brand kits, finals, and work-in-progress.",
          "Lean on the Photos internal module when you need full preview chrome for imagery.",
          "Later: tagging, rights metadata, and approval states.",
        ]}
      />
      <Card className="border-dashed bg-muted/20 shadow-none">
        <CardHeader>
          <CardTitle className="text-base text-muted-foreground">Asset preview region</CardTitle>
          <CardDescription>
            Grid/list + rich metadata will live here. For now, route raster review through the Photos
            internal module to reuse the shared viewer.
          </CardDescription>
        </CardHeader>
      </Card>
    </InternalAppShell>
  );
}

export function renderInternalSubapplication(id: InternalAppId) {
  switch (id) {
    case "social_media":
      return <SocialMediaSubapplication />;
    case "shoots_field":
      return <ShootsFieldSubapplication />;
    case "shoots_studio":
      return <ShootsStudioSubapplication />;
    case "photos":
      return <PhotosSubapplication />;
    case "assets":
      return <AssetsSubapplication />;
    default: {
      const exhaustive: never = id;
      throw new Error(`Unhandled internal app: ${exhaustive}`);
    }
  }
}
