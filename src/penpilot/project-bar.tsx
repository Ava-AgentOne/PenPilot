/**
 * The project buttons at the top of the panel: New, Open, Save, Save as and
 * Export SVG, and the name of the project file the page belongs to.
 */

import React from "react";

export const ProjectBar = React.memo(function ProjectBar({
  fileName,
  dirty,
  hasItems,
  locked,
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onExportSvg,
}: {
  fileName: string | null;
  dirty: boolean;
  hasItems: boolean;
  locked: boolean;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExportSvg: () => void;
}) {
  const mac = navigator.platform.startsWith("Mac");
  const key = (k: string) => (mac ? `⌘${k}` : `Ctrl+${k}`);
  let status: string | null = null;
  if (fileName) status = dirty ? `${fileName} · changes not saved` : fileName;
  else if (dirty && hasItems) status = "Not saved yet";
  return (
    <div className="pp-project">
      <div className="pp-project-buttons">
        <button type="button" disabled={locked} onClick={onNew} title="Start a new, empty page">
          New
        </button>
        <button type="button" disabled={locked} onClick={onOpen} title={`Open a PenPilot project (${key("O")})`}>
          Open…
        </button>
        <button type="button" disabled={!hasItems} onClick={onSave} title={`Save this page as a project (${key("S")})`}>
          Save
        </button>
        <button type="button" disabled={!hasItems} onClick={onSaveAs} title="Save a copy under another name">
          Save as…
        </button>
        <button
          type="button"
          className="pp-span-2"
          disabled={!hasItems}
          onClick={onExportSvg}
          title="Save the page's lines as an SVG drawing, one layer per pen"
        >
          Export SVG…
        </button>
      </div>
      {status && (
        <div className={`pp-project-name${dirty ? " pp-project-name--unsaved" : ""}`} title={status}>
          {status}
        </div>
      )}
    </div>
  );
});

/** Browser fallback (no desktop app): save text as a download. */
export function downloadText(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
