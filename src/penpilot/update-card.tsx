/**
 * "PenPilot X is ready": shown when the releases page has a newer version
 * (see desktop/app/updater.cjs). Update now downloads and installs it;
 * PenPilot then closes and opens again on the new version.
 */

import React from "react";
import type { UpdateInfo } from "./desktop.js";

export type UpdateProgress = { fraction: number } | "installing" | "deferred" | null;

export const UpdateCard = React.memo(function UpdateCard({
  info,
  progress,
  error,
  unsaved,
  locked,
  onInstall,
  onLater,
  onOpenPage,
}: {
  info: UpdateInfo;
  progress: UpdateProgress;
  error: string | null;
  unsaved: boolean;
  /** A plot is running: install when it's done. */
  locked: boolean;
  onInstall: () => void;
  onLater: () => void;
  onOpenPage: () => void;
}) {
  const busy = progress !== null;
  return (
    <div className="pp-update" role="dialog" aria-labelledby="pp-update-title">
      <div id="pp-update-title" className="pp-update-title">
        PenPilot {info.version} is ready
      </div>
      <div className="pp-update-sub">You have {info.current}.</div>
      {info.notes.length > 0 && (
        <ul className="pp-update-notes">
          {info.notes.slice(0, 6).map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {info.cannotInstall ? (
        <>
          <p className="pp-update-text">{info.cannotInstall}</p>
          <div className="pp-buttons">
            <button type="button" onClick={onOpenPage}>
              Open the download page
            </button>
            <button type="button" onClick={onLater}>
              Later
            </button>
          </div>
        </>
      ) : progress === "installing" ? (
        <p className="pp-update-text">Installing… PenPilot will close and open again on the new version.</p>
      ) : progress === "deferred" ? (
        <>
          <p className="pp-update-text">The update is ready. It finishes by itself the next time you close PenPilot.</p>
          <div className="pp-buttons">
            <button type="button" onClick={onLater}>
              OK
            </button>
          </div>
        </>
      ) : progress ? (
        <div className="pp-update-progress" aria-live="polite">
          <div className="pp-update-bar">
            <div style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
          Downloading… {Math.round(progress.fraction * 100)}%
        </div>
      ) : (
        <>
          {error && <p className="pp-update-error">{error}</p>}
          <p className="pp-update-text">
            PenPilot closes and opens again to finish.
            {unsaved ? " Your page has changes that aren't saved: save first if you want to keep them." : ""}
            {locked ? " You can update once the plot has finished." : ""}
          </p>
          <div className="pp-buttons">
            <button type="button" className="plot-button" disabled={busy || locked} onClick={onInstall}>
              {error ? "Try again" : "Update now"}
            </button>
            <button type="button" onClick={onLater}>
              Later
            </button>
          </div>
        </>
      )}
    </div>
  );
});
