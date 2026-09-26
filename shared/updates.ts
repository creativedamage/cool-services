/** Update status shared by the Mac app's updater, the server bridge and Settings. */
export type UpdateState = "unavailable" | "idle" | "checking" | "up-to-date" | "available" | "downloading" | "installing" | "error";

export interface UpdateStatus {
  state: UpdateState;
  /** The version running now. */
  current: string;
  /** "owner/repo" on GitHub the app checks, or null if it hasn't been set. */
  repo: string | null;
  latest: { version: string; notes: string; url: string; publishedAt: string } | null;
  /** 0–1 while downloading. */
  progress: number | null;
  error: string | null;
  checkedAt: string | null;
  /** Why "Update now" can't replace the app in place (e.g. it's running from the DMG). */
  installProblem: string | null;
}

export interface UpdateBridge {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  install(): Promise<UpdateStatus>;
}
