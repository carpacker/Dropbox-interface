import {
  Box,
  Camera,
  Images,
  Mountain,
  Share2,
  type LucideIcon,
} from "lucide-react";

export type InternalAppId =
  | "social_media"
  | "shoots_field"
  | "shoots_studio"
  | "photos"
  | "assets";

export type InternalAppDefinition = {
  id: InternalAppId;
  title: string;
  subtitle: string;
  description: string;
  openLabel: string;
  icon: LucideIcon;
};

export const INTERNAL_APP_ORDER: InternalAppId[] = [
  "social_media",
  "shoots_field",
  "shoots_studio",
  "photos",
  "assets",
];

export type InternalTileSize = "compact" | "wide" | "tall";

export const DEFAULT_INTERNAL_SIZES: Record<InternalAppId, InternalTileSize> = {
  social_media: "compact",
  shoots_field: "wide",
  shoots_studio: "wide",
  photos: "compact",
  assets: "compact",
};

export const INTERNAL_APP_DEFINITIONS: InternalAppDefinition[] = [
  {
    id: "social_media",
    title: "Social media",
    subtitle: "Planning + publishing context",
    description:
      "Starter surface for feeds, schedules, and campaign assets. Photo previews here use the internal viewer module.",
    openLabel: "Open social workspace",
    icon: Share2,
  },
  {
    id: "shoots_field",
    title: "Shoots (Field)",
    subtitle: "On-location production",
    description:
      "Track field days, shot lists, and mobile-captured media. Pair with the internal photo viewer for rapid review.",
    openLabel: "Open field shoots",
    icon: Mountain,
  },
  {
    id: "shoots_studio",
    title: "Shoots (Studio)",
    subtitle: "Controlled studio sessions",
    description:
      "Structured studio days, lighting notes, and tethered-capture folders. Built to embed previews, not bounce users to a separate app.",
    openLabel: "Open studio shoots",
    icon: Camera,
  },
  {
    id: "photos",
    title: "Photos",
    subtitle: "Internal library + viewer",
    description:
      "The shared photo browser/preview module used across the internal apps above. Treat this as infrastructure, not a standalone product surface.",
    openLabel: "Open internal photos",
    icon: Images,
  },
  {
    id: "assets",
    title: "Assets",
    subtitle: "Brand files + deliveries",
    description:
      "House logos, exports, master files, and client deliveries. Future home for tagging and approval flows.",
    openLabel: "Open assets",
    icon: Box,
  },
];

export function getInternalAppDefinition(id: InternalAppId) {
  const found = INTERNAL_APP_DEFINITIONS.find((item) => item.id === id);
  if (!found) {
    throw new Error(`Unknown internal app: ${id}`);
  }
  return found;
}
