import { useCallback, useEffect, useId, useState } from "react";
import { apiClient } from "@/api/client";
import type { NoteCategory, NoteDTO } from "@/api/types";
import { Button } from "@/components/ui/button";
import { copy } from "@/copy";
import { cn } from "@/lib/utils";

const CATEGORIES: readonly NoteCategory[] = [
  "illness",
  "travel",
  "alcohol",
  "medication",
  "stress",
  "other",
];

/**
 * B-A7: a subtle marker on a note an agent appended, so the owner can tell agent context
 * from their own. Never a severity signal.
 */
export function AgentBadge({ authorName }: { authorName: string | null }) {
  return (
    <span
      data-testid="note-agent-badge"
      title={copy.notes.agentBadgeAria(authorName)}
      className="inline-flex items-center rounded-full border border-accent/40 bg-accent/10 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-accent"
    >
      {copy.notes.agentBadge}
      {authorName ? (
        <span className="ml-1 normal-case text-muted-foreground">{authorName}</span>
      ) : null}
    </span>
  );
}

const fieldClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring";

export interface NotesPanelProps {
  notes: readonly NoteDTO[];
  /** Default from/to day for a new note (e.g. the open evidence day). */
  defaultDay?: string | null;
  compact?: boolean;
  onChanged?: () => void;
  testId?: string;
}

/**
 * Inline note CRUD (B-U1–B-U4). Notes are confounders, never causes (B-F9), and the
 * panel asks its owner to refresh so checks/charts stay in sync after a mutation.
 */
export function NotesPanel({
  notes,
  defaultDay,
  compact = false,
  onChanged,
  testId = "notes-panel",
}: NotesPanelProps) {
  const fieldId = useId();
  const day = defaultDay ?? "";
  const [startDay, setStartDay] = useState(day);
  const [endDay, setEndDay] = useState(day);
  const [category, setCategory] = useState<NoteCategory>("other");
  const [label, setLabel] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editingId !== null) return;
    setStartDay(day);
    setEndDay(day);
  }, [day, editingId]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setStartDay(day);
    setEndDay(day);
    setCategory("other");
    setLabel("");
    setError(null);
  }, [day]);

  const handleSubmit = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (editingId !== null) {
        await apiClient.updateNote(editingId, { startDay, endDay, category, label });
      } else {
        await apiClient.createNote({ startDay, endDay, category, label });
      }
      resetForm();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.notes.error);
    } finally {
      setPending(false);
    }
  }, [category, editingId, endDay, label, onChanged, pending, resetForm, startDay]);

  const handleEdit = useCallback((note: NoteDTO) => {
    setEditingId(note.id);
    setStartDay(note.startDay);
    setEndDay(note.endDay);
    setCategory(note.category);
    setLabel(note.label);
    setError(null);
  }, []);

  const handleDelete = useCallback(
    async (note: NoteDTO) => {
      if (pending) return;
      setPending(true);
      setError(null);
      try {
        await apiClient.deleteNote(note.id);
        if (editingId === note.id) resetForm();
        onChanged?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : copy.notes.deleteError);
      } finally {
        setPending(false);
      }
    },
    [editingId, onChanged, pending, resetForm],
  );

  const isEditing = editingId !== null;
  return (
    <div data-testid={testId} className="space-y-3 text-sm">
      <ul className="space-y-1.5">
        {notes.length === 0 ? (
          <li data-testid="notes-empty" className="text-xs text-muted-foreground">
            {copy.notes.empty}
          </li>
        ) : (
          notes.map((note) => (
            <li
              key={note.id}
              data-testid={`note-row-${note.id}`}
              className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-border bg-background/50 px-2.5 py-1.5"
            >
              <span className="min-w-0">
                <span className="font-medium text-foreground">{note.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {copy.notes.categories[note.category] ?? note.category} ·{" "}
                  {copy.notes.range(note.startDay, note.endDay)}
                </span>
                {note.author === "agent" ? (
                  <span className="ml-2 inline-block align-middle">
                    <AgentBadge authorName={note.authorName} />
                  </span>
                ) : null}
              </span>
              <span className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  data-testid={`note-edit-btn-${note.id}`}
                  onClick={() => handleEdit(note)}
                  disabled={pending}
                >
                  {copy.notes.edit}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-alert"
                  data-testid={`note-delete-btn-${note.id}`}
                  onClick={() => void handleDelete(note)}
                  disabled={pending}
                >
                  {copy.notes.delete}
                </Button>
              </span>
            </li>
          ))
        )}
      </ul>

      <form
        data-testid="note-form"
        className={cn("space-y-2", compact ? "text-xs" : "text-sm")}
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <p className="text-xs font-medium text-muted-foreground">
          {isEditing ? copy.notes.editHeading : copy.notes.addHeading}
        </p>
        <div className="flex flex-wrap gap-2">
          <label className="flex min-w-28 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">{copy.notes.startField}</span>
            <input
              type="date"
              data-testid="note-start-input"
              className={fieldClass}
              value={startDay}
              required
              onChange={(event) => setStartDay(event.target.value)}
            />
          </label>
          <label className="flex min-w-28 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">{copy.notes.endField}</span>
            <input
              type="date"
              data-testid="note-end-input"
              className={fieldClass}
              value={endDay}
              onChange={(event) => setEndDay(event.target.value)}
            />
          </label>
          <label className="flex min-w-28 flex-1 flex-col gap-1">
            <span className="text-xs text-muted-foreground">{copy.notes.categoryField}</span>
            <select
              id={`${fieldId}-category`}
              data-testid="note-category-select"
              className={fieldClass}
              value={category}
              onChange={(event) => setCategory(event.target.value as NoteCategory)}
            >
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {copy.notes.categories[item] ?? item}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{copy.notes.labelField}</span>
          <input
            type="text"
            data-testid="note-label-input"
            className={fieldClass}
            value={label}
            maxLength={140}
            required
            placeholder={copy.notes.labelPlaceholder}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        {error ? (
          <p data-testid="note-error" className="text-xs text-alert">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            type="submit"
            size="sm"
            data-testid="note-save-btn"
            disabled={pending || label.trim().length === 0 || startDay === ""}
          >
            {pending ? copy.notes.saving : copy.notes.save}
          </Button>
          {isEditing ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="note-cancel-btn"
              onClick={resetForm}
            >
              {copy.notes.cancel}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
