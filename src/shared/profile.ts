import type { SlotDisplayType, SlotProfileInput } from "./types";

export const MARK_COLOR_OPTIONS = [
  { value: "", label: "Tier default" },
  { value: "#1F6FF2", label: "Signal blue" },
  { value: "#6A4CFF", label: "Ultra violet" },
  { value: "#FF6B35", label: "Burn orange" },
  { value: "#E63946", label: "Fire red" },
  { value: "#0F9D58", label: "Mint green" },
  { value: "#111111", label: "Pitch black" },
  { value: "#F4F1EA", label: "Ivory" },
] as const;

export const BOARD_EMOJI_OPTIONS = [
  "🔥",
  "💎",
  "⚡",
  "👑",
  "🦍",
  "🐸",
  "🐉",
  "🧠",
  "🫡",
  "🚀",
  "🎯",
  "💥",
  "🧿",
  "🦄",
  "🌊",
  "🪙",
  "🔒",
  "⭐",
  "👀",
  "🧱",
] as const;

const ALLOWED_DISPLAY_COLORS = new Map(
  MARK_COLOR_OPTIONS.filter((option) => option.value).map((option) => [option.value.toLowerCase(), option.value]),
);

const EMPTY_PROFILE: SlotProfileInput = {
  alias: "",
  displayType: "letter",
  displayValue: "",
  displayColor: "",
  projectName: "",
  projectDescription: "",
  twitter: "",
  farcaster: "",
  website: "",
  message: "",
};

function trimTo(value: string, max: number) {
  return value.trim().slice(0, max);
}

function normalizeHandle(value: string) {
  return trimTo(value.replace(/^@+/, ""), 40);
}

function normalizeWebUrl(value: string, max: number) {
  const trimmed = trimTo(value, max);
  if (!trimmed) {
    return "";
  }

  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeDisplayValue(displayType: SlotDisplayType, value: string) {
  const trimmed = value.trim();
  switch (displayType) {
    case "letter":
      return trimmed.slice(0, 3).toUpperCase();
    case "emoji":
      return trimmed.slice(0, 8);
    case "image":
      return normalizeWebUrl(trimmed, 280);
    default:
      return "";
  }
}

function normalizeDisplayColor(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }

  return ALLOWED_DISPLAY_COLORS.get(trimmed) ?? "";
}

export function emptyProfile() {
  return { ...EMPTY_PROFILE };
}

export function normalizeProfileInput(input: Partial<SlotProfileInput>): SlotProfileInput {
  const displayType = input.displayType ?? "letter";

  const profile: SlotProfileInput = {
    alias: trimTo(input.alias ?? "", 32),
    displayType,
    displayValue: normalizeDisplayValue(displayType, input.displayValue ?? ""),
    displayColor: displayType === "letter" ? normalizeDisplayColor(input.displayColor ?? "") : "",
    projectName: trimTo(input.projectName ?? "", 40),
    projectDescription: trimTo(input.projectDescription ?? "", 120),
    twitter: normalizeHandle(input.twitter ?? ""),
    farcaster: normalizeHandle(input.farcaster ?? ""),
    website: normalizeWebUrl(input.website ?? "", 160),
    message: trimTo(input.message ?? "", 140),
  };

  if (!profile.alias) {
    throw new Error("Alias is required.");
  }

  return profile;
}
