import type {
  MediaAnnotation,
  MediaItem,
  ProjectSummary,
} from "../../electron/media/types";

function money(value: number | null): string {
  return value === null ? "unknown" : `$${value.toFixed(2)}`;
}

export function formatAgentFeedback(
  project: ProjectSummary,
  items: MediaItem[],
  annotations: Record<string, MediaAnnotation>,
): string {
  const lines = [
    `## Ralphy review: ${project.name}`,
    "",
    `Project: ${project.absolutePath}`,
    `Context: ${project.phase ?? project.status} · ${project.platform ?? "unspecified"} · ${project.aspectRatio ?? "unspecified"}`,
    "",
  ];
  for (const item of items) {
    const annotation = annotations[item.id];
    lines.push(`### ${item.name}`);
    lines.push(`- Path: ${item.absolutePath}`);
    lines.push(`- Review: ${annotation?.reviewStatus ?? "Unreviewed"}`);
    if (annotation?.rating) lines.push(`- Rating: ${annotation.rating}/5`);
    if (annotation?.tags.length) lines.push(`- Tags: ${annotation.tags.join(", ")}`);
    if (annotation?.notes.trim()) lines.push(`- Notes: ${annotation.notes.trim()}`);
    if (item.generation) {
      lines.push(
        `- Generation: ${item.generation.provider} / ${item.generation.model} / ${item.generation.operation} / ${money(item.generation.costUsd)}`,
      );
    }
    lines.push("");
  }
  lines.push("Please use these paths directly and apply the review notes to the next iteration.");
  return lines.join("\n");
}
