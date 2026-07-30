import { Check, Heart, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  AnnotationInput,
  MediaAnnotation,
  ReviewStatus,
} from "../lib/ipc";
import { annotationWithPatch } from "../lib/review";

interface ReviewControlsProps {
  annotation?: MediaAnnotation;
  onChange(annotation: AnnotationInput): void;
}

const statuses: Array<{
  value: ReviewStatus;
  label: string;
}> = [
  { value: "Unreviewed", label: "Unreviewed" },
  { value: "Approved", label: "Approved" },
  { value: "Shortlist", label: "Shortlist" },
  { value: "Needs Work", label: "Needs work" },
  { value: "Reject", label: "Reject" },
];

export function ReviewControls({ annotation, onChange }: ReviewControlsProps) {
  const current = annotationWithPatch(annotation, {});
  const [tagInput, setTagInput] = useState("");
  const [notes, setNotes] = useState(current.notes);

  useEffect(() => setNotes(current.notes), [annotation?.updatedAt, current.notes]);

  const change = (patch: Partial<AnnotationInput>) => {
    onChange(annotationWithPatch(annotation, patch));
  };
  const addTag = () => {
    if (!tagInput.trim()) return;
    change({ tags: [...current.tags, tagInput] });
    setTagInput("");
  };

  return (
    <div className="review-controls">
      <div className="inspector-section-heading">Review</div>
      <div className="status-control">
        {statuses.map((status) => (
          <button
            type="button"
            className={`status-${status.value.toLocaleLowerCase().replace(" ", "-")}${
              current.reviewStatus === status.value ? " is-active" : ""
            }`}
            key={status.value}
            onClick={() => change({ reviewStatus: status.value })}
          >
            {status.value === "Approved" && <Check size={11} />}
            {status.value === "Reject" && <X size={11} />}
            {status.label}
          </button>
        ))}
      </div>

      <div className="rating-row">
        <button
          className={`favorite-button${current.favorite ? " is-active" : ""}`}
          type="button"
          aria-label={current.favorite ? "Remove favorite" : "Add favorite"}
          title={current.favorite ? "Remove favorite" : "Add favorite"}
          onClick={() => change({ favorite: !current.favorite })}
        >
          <Heart size={15} fill={current.favorite ? "currentColor" : "none"} />
        </button>
        <span>Rating</span>
        <div className="stars" aria-label={`Rating ${current.rating} of 5`}>
          {[1, 2, 3, 4, 5].map((rating) => (
            <button
              type="button"
              aria-label={`${rating} stars`}
              key={rating}
              onClick={() => change({ rating: current.rating === rating ? 0 : rating })}
            >
              <Star size={14} fill={rating <= current.rating ? "currentColor" : "none"} />
            </button>
          ))}
        </div>
      </div>

      <div className="tag-editor">
        <div className="tag-list">
          {current.tags.map((tag) => (
            <button
              type="button"
              title={`Remove ${tag}`}
              key={tag}
              onClick={() => change({ tags: current.tags.filter((value) => value !== tag) })}
            >
              {tag}<X size={10} />
            </button>
          ))}
        </div>
        <input
          type="text"
          value={tagInput}
          placeholder="Add tag"
          aria-label="Add tag"
          onChange={(event) => setTagInput(event.target.value)}
          onBlur={addTag}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag();
            }
          }}
        />
      </div>

      <label className="notes-editor">
        <span>Notes</span>
        <textarea
          value={notes}
          placeholder="Feedback for the next iteration"
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== current.notes) change({ notes });
          }}
        />
      </label>
    </div>
  );
}
