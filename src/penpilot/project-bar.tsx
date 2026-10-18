/**
 * The project's name at the top of the panel, and (in a browser, where there's
 * no menu bar) a File menu: New, Open, Save, Save as and Export SVG.
 */

import React from "react";
import { MenuButton } from "./panel-ui.js";

export const ProjectBar = React.memo(function ProjectBar({
  inMenuBar,
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
  /** The desktop app has these in its File menu; the panel then only shows the project's name. */
  inMenuBar: boolean;
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
  let status: string | null = null;
  if (fileName) status = dirty ? `${fileName} · not saved` : fileName;
  else if (dirty && hasItems) status = "Not saved yet";
  return (
    <div className="pp-project">
      {!inMenuBar && (
        <MenuButton
          className="pp-file-menu"
          label="File"
          items={[
            { label: "New", onSelect: onNew, disabled: locked },
            { label: "Open…", onSelect: onOpen, disabled: locked },
            { label: "Save", onSelect: onSave, disabled: !hasItems, separator: true },
            { label: "Save as…", onSelect: onSaveAs, disabled: !hasItems },
            { label: "Export SVG…", onSelect: onExportSvg, disabled: !hasItems, separator: true },
          ]}
        />
      )}
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
