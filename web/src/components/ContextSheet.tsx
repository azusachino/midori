import { useCallback, useEffect, useId, useState } from "react";
import { apiClient } from "@/api/client";
import type { NoteDTO, ProfileInputDTO } from "@/api/types";
import { NotesPanel } from "@/components/NotesPanel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copy } from "@/copy";

export type ContextSheetTab = "notes" | "profile";

export interface ContextSheetProps {
  open: boolean;
  tab: ContextSheetTab;
  onTabChange: (tab: ContextSheetTab) => void;
  onOpenChange: (open: boolean) => void;
  notes: readonly NoteDTO[];
  /** Called after a note mutation so the Changes view refetches checks and chips. */
  onChanged?: () => void;
}

const fieldClass =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/**
 * Notes & agent profile slide-over (v3 plan §5, B-P1, B-U1–B-U4). Replaces the raw
 * inline note form on `/`; the agent profile is owner-authored context an agent may
 * read, and midori itself never interprets it (B-F9 neutral wording).
 */
export function ContextSheet({
  open,
  tab,
  onTabChange,
  onOpenChange,
  notes,
  onChanged,
}: ContextSheetProps) {
  const contextCopy = copy.context;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="context-sheet" closeLabel={contextCopy.closeLabel}>
        <SheetHeader>
          <SheetTitle>{contextCopy.title}</SheetTitle>
          <SheetDescription>{contextCopy.description}</SheetDescription>
        </SheetHeader>

        <Tabs
          value={tab}
          onValueChange={(value) => onTabChange(value === "profile" ? "profile" : "notes")}
        >
          <TabsList aria-label={contextCopy.title}>
            <TabsTrigger value="notes" data-testid="context-tab-notes">
              {contextCopy.tabs.notes}
            </TabsTrigger>
            <TabsTrigger value="profile" data-testid="context-tab-profile">
              {contextCopy.tabs.profile}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="notes" className="space-y-3">
            <p className="text-xs text-muted-foreground">{contextCopy.notesHint}</p>
            <NotesPanel
              notes={notes}
              compact
              {...(onChanged ? { onChanged } : {})}
              testId="context-notes"
            />
          </TabsContent>

          <TabsContent value="profile">
            <ProfileForm />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

type LoadState = "loading" | "ready" | "error";

const EMPTY_PROFILE: ProfileInputDTO = { goals: "", routine: "", medicalContext: "" };

function ProfileForm() {
  const profileCopy = copy.context.profile;
  const [state, setState] = useState<LoadState>("loading");
  const [nonce, setNonce] = useState(0);
  const [fields, setFields] = useState<ProfileInputDTO>(EMPTY_PROFILE);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void nonce;
    const ac = new AbortController();
    setState("loading");
    setError(null);
    void apiClient
      .profile(ac.signal)
      .then((profile) => {
        if (ac.signal.aborted) return;
        setFields({
          goals: profile.goals,
          routine: profile.routine,
          medicalContext: profile.medicalContext,
        });
        setState("ready");
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : profileCopy.loadError);
        setState("error");
      });
    return () => ac.abort();
  }, [nonce, profileCopy.loadError]);

  const updateField = useCallback((key: keyof ProfileInputDTO, value: string) => {
    setSaved(false);
    setError(null);
    setFields((current) => ({ ...current, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (pending) return;
    setPending(true);
    setSaved(false);
    setError(null);
    try {
      const profile = await apiClient.updateProfile(fields);
      setFields({
        goals: profile.goals,
        routine: profile.routine,
        medicalContext: profile.medicalContext,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : profileCopy.saveError);
    } finally {
      setPending(false);
    }
  }, [fields, pending, profileCopy.saveError]);

  const isEmpty =
    fields.goals.trim() === "" &&
    fields.routine.trim() === "" &&
    fields.medicalContext.trim() === "";

  return (
    <form
      data-testid="profile-form"
      className="space-y-4 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <p className="text-xs text-muted-foreground">{profileCopy.intro}</p>

      {state === "loading" ? (
        <p data-testid="profile-loading" className="text-xs text-muted-foreground">
          {profileCopy.loading}
        </p>
      ) : null}

      {state === "error" ? (
        <div className="space-y-2" data-testid="profile-load-error">
          <p className="text-xs text-alert">{error ?? profileCopy.loadError}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setNonce((n) => n + 1)}>
            {profileCopy.retry}
          </Button>
        </div>
      ) : null}

      {state === "ready" ? (
        <>
          {isEmpty ? (
            <p className="text-xs text-muted-foreground">{profileCopy.emptyHint}</p>
          ) : null}

          <ProfileField
            testId="profile-goals-input"
            label={profileCopy.goals}
            placeholder={profileCopy.goalsPlaceholder}
            value={fields.goals}
            onChange={(value) => updateField("goals", value)}
          />
          <ProfileField
            testId="profile-routine-input"
            label={profileCopy.routine}
            placeholder={profileCopy.routinePlaceholder}
            value={fields.routine}
            onChange={(value) => updateField("routine", value)}
          />
          <ProfileField
            testId="profile-medical-input"
            label={profileCopy.medicalContext}
            placeholder={profileCopy.medicalContextPlaceholder}
            value={fields.medicalContext}
            onChange={(value) => updateField("medicalContext", value)}
          />

          {error ? (
            <p data-testid="profile-error" className="text-xs text-alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="sm" data-testid="profile-save-btn" disabled={pending}>
              {pending ? profileCopy.saving : profileCopy.save}
            </Button>
            {saved ? (
              <span data-testid="profile-saved" className="text-xs text-accent">
                {profileCopy.saved}
              </span>
            ) : null}
          </div>
        </>
      ) : null}
    </form>
  );
}

interface ProfileFieldProps {
  testId: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}

function ProfileField({ testId, label, placeholder, value, onChange }: ProfileFieldProps) {
  const fieldId = useId();
  return (
    <label htmlFor={fieldId} className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums">{copy.context.profile.charCount(value.length)}</span>
      </span>
      <textarea
        id={fieldId}
        data-testid={testId}
        className={fieldClass}
        rows={3}
        maxLength={1000}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
