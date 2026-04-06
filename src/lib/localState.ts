import type { SlotProfileInput } from "../shared/types";

const TILE_KEY = "nara-lockboard:selected-slot";
const PROFILE_KEY = "nara-lockboard:profile-draft";
const CLAIM_KEY = "nara-lockboard:last-claim-tx";

export function saveSelectedSlot(slotNum: number) {
  localStorage.setItem(TILE_KEY, String(slotNum));
}

export function loadSelectedSlot() {
  const raw = localStorage.getItem(TILE_KEY);
  return raw ? Number(raw) : null;
}

export function clearSelectedSlot() {
  localStorage.removeItem(TILE_KEY);
}

export function saveProfileDraft(profile: Partial<SlotProfileInput>) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadProfileDraft(): Partial<SlotProfileInput> {
  const raw = localStorage.getItem(PROFILE_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function clearProfileDraft() {
  localStorage.removeItem(PROFILE_KEY);
}

export function saveClaimTxHash(txHash: string) {
  localStorage.setItem(CLAIM_KEY, txHash);
}

export function loadClaimTxHash() {
  return localStorage.getItem(CLAIM_KEY);
}

export function clearClaimTxHash() {
  localStorage.removeItem(CLAIM_KEY);
}
