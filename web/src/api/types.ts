import type {
  ChangesDTO,
  CheckDTO,
  EpochCardDTO,
  EpochMetricRoleDTO,
  EpochRefDTO,
  EpochsDTO,
  ErrorResponse,
  FindingDirection,
  FindingDTO,
  FindingRowDTO,
  FindingSeverity,
  FindingSnapshotSummaryDTO,
  FindingState,
  FindingsDiffClassification,
  FindingsDiffDTO,
  FindingsDiffItemDTO,
  FreshnessSummaryDTO,
  HealthDTO,
  ImportDTO,
  ImportStatus,
  LastNightDTO,
  MetricIndexEntryDTO,
  MetricSeriesDTO,
  MetricsIndexDTO,
  MetricUnitPointDTO,
  NightsDTO,
  NoteCategory,
  NoteDTO,
  ProfileContextDTO,
  UnitEvidenceDTO,
  UploadAcceptedDTO,
  WeeklySeriesPointDTO,
} from "@midori/domain/api";
import { IMPORT_STATUSES } from "@midori/domain/api";

/**
 * v1 REST API DTOs re-exported/derived from `@midori/domain/api`, keeping a single
 * wire contract between server and web client.
 */

export type {
  ChangesDTO,
  CheckDTO,
  EpochCardDTO,
  EpochMetricRoleDTO,
  EpochRefDTO,
  EpochsDTO,
  ErrorResponse,
  FindingDirection,
  FindingDTO,
  FindingRowDTO,
  FindingSeverity,
  FindingSnapshotSummaryDTO,
  FindingState,
  FindingsDiffClassification,
  FindingsDiffDTO,
  FindingsDiffItemDTO,
  FreshnessSummaryDTO,
  HealthDTO,
  ImportDTO,
  ImportStatus,
  LastNightDTO,
  MetricIndexEntryDTO,
  MetricSeriesDTO,
  MetricsIndexDTO,
  MetricUnitPointDTO,
  NightsDTO,
  NoteCategory,
  NoteDTO,
  ProfileContextDTO,
  UnitEvidenceDTO,
  UploadAcceptedDTO,
  WeeklySeriesPointDTO,
};
export { IMPORT_STATUSES };

export type CheckResultDTO = CheckDTO;
export type MetricKind = FindingRowDTO["kind"];
export type EpochKind = EpochRefDTO["kind"];
export type ConfidenceLevel = Exclude<FindingRowDTO["confidence"], null>;
export type MetricRange = MetricSeriesDTO["range"];
export type MetricTab = "chart" | "long";
export type CheckKey = CheckDTO["key"];
export type OnsetDTO = Exclude<FindingRowDTO["onset"], null>;
export type WarmupProgressDTO = Exclude<FindingRowDTO["warmup"], null>;
export type SparklinePointDTO = FindingRowDTO["sparkline"][number];
export type StaleBannerDTO = Exclude<ChangesDTO["staleBanner"], null>;
export type WarmingNoticeDTO = Exclude<ChangesDTO["warmingNotice"], null>;
export type PrimaryWatchSummaryDTO = Exclude<ChangesDTO["primaryWatch"], null>;
export type BandPointDTO = MetricSeriesDTO["band"][number];
export type StintDTO = MetricSeriesDTO["stints"][number];
export type SeamStepDTO = MetricSeriesDTO["seams"][number];
export type OsUpdateEventDTO = MetricSeriesDTO["osUpdates"][number];
export type SamplePointDTO = UnitEvidenceDTO["samples"][number];
export type NightSummaryDTO = NightsDTO["nights"][number];
export type NoteCategoryDTO = NoteCategory;
export type NoteInputDTO = {
  startDay: string;
  endDay?: string;
  category: NoteCategory;
  label: string;
};
export type NotePatchDTO = Partial<NoteInputDTO>;

/** B-R5 build identity surfaced in the shell (sidebar footer and mobile header). */
export type BuildInfoDTO = Pick<HealthDTO, "version" | "revision">;

/** B-P1 fields the owner edits from the ContextSheet agent-profile tab. */
export type ProfileInputDTO = Pick<ProfileContextDTO, "goals" | "routine" | "medicalContext">;
