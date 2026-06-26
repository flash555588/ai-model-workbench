import type { ModelAssetProfile } from "../domain/models";
import { normalizeHeadingText } from "../utils/heading-text";

export interface PinEntry {
  pinId: string;
  modelPath: string;
  color: string;
}

export function buildHeadingPinMap(profiles: Record<string, ModelAssetProfile>): Map<string, PinEntry[]> {
  const map = new Map<string, PinEntry[]>();
  for (const [modelPath, profile] of Object.entries(profiles)) {
    for (const pin of profile.annotations) {
      if (pin.headingRef && pin.id) {
        const headingKey = normalizeHeadingText(pin.headingRef);
        if (!headingKey) continue;
        let arr = map.get(headingKey);
        if (!arr) { arr = []; map.set(headingKey, arr); }
        arr.push({ pinId: pin.id, modelPath, color: pin.color });
      }
    }
  }
  return map;
}
