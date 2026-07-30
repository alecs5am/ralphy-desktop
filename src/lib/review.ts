import type {
  AnnotationInput,
  MediaAnnotation,
  MediaItem,
} from "../../electron/media/types";

export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  return tags.flatMap((tag) => {
    const value = tag.trim().slice(0, 48);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) return [];
    seen.add(key);
    return [value];
  }).slice(0, 24);
}

export function annotationWithPatch(
  annotation: MediaAnnotation | undefined,
  patch: Partial<AnnotationInput>,
): AnnotationInput {
  const next: AnnotationInput = {
    reviewStatus: annotation?.reviewStatus ?? "Unreviewed",
    favorite: annotation?.favorite ?? false,
    rating: annotation?.rating ?? 0,
    tags: annotation?.tags ?? [],
    notes: annotation?.notes ?? "",
    ...patch,
  };
  return {
    ...next,
    rating: Math.max(0, Math.min(5, Math.round(next.rating))),
    tags: normalizeTags(next.tags),
    notes: next.notes.slice(0, 16_384),
  };
}

export function adjacentMediaItem(
  items: MediaItem[],
  currentId: string,
  direction: -1 | 1,
): MediaItem | null {
  const index = items.findIndex((item) => item.id === currentId);
  return items[index + direction] ?? null;
}
