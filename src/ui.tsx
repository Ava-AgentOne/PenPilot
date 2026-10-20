/**
 * Front-end for plotter app.
 */

import { flattenSVG, type Path } from "flatten-svg";
import React, { type ChangeEvent, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PaperSize } from "./paper-size.js";
import { Device, defaultPlanOptions, PenChange, Plan, type PlanOptions, type TransferredMotion } from "./planning.js";
import useComponentSize from "./useComponentSize.js";

import { formatDuration } from "./util.js";

import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/700.css";
import "@fontsource/work-sans/900.css";
import "./style.css";
import "./penpilot/penpilot.css";
import { type BaseDriver, type DeviceInfo, SaxiDriver, WebSerialDriver } from "./drivers.js";
import type { Hardware } from "./ebb.js";
import { desktop, isWindows, type UpdateInfo } from "./penpilot/desktop.js";
import { framePlan } from "./penpilot/frame.js";
import { loadPaperSizes, type SavedPaperSize, sameSize, savePaperSizes } from "./penpilot/paper-sizes.js";
import {
  choosePlacement,
  drawableArea,
  drawableOnPage,
  drawingBoxOnMachine,
  emptyPage,
  machineReach,
  newItem,
  newPhotoItem,
  duplicateItem,
  newShapeItem,
  newTextItem,
  type PageAction,
  type PageItem,
  itemSize,
  pageReducer,
  plannerSegments,
} from "./penpilot/page.js";
import { DrawingsPanel, OrientationNotes, PageCanvas } from "./penpilot/page-editor.js";
import { isImageFile, svgToBitmap } from "./penpilot/photo.js";
import { usePhotoRenderer } from "./penpilot/photo-renderer.js";
import { usePenText } from "./penpilot/text-renderer.js";
import { PlotterCheck } from "./penpilot/plotter-check.js";
import { downloadText, ProjectBar } from "./penpilot/project-bar.js";
import { UpdateCard, type UpdateProgress } from "./penpilot/update-card.js";
import { WelcomeGuide, welcomeSeen } from "./penpilot/welcome.js";
import { editingText, useZoom, WorkspaceToolbar } from "./penpilot/workspace-toolbar.js";
import { fileBaseName, PROJECT_EXTENSION, pageToSvg, projectFromText, projectToText } from "./penpilot/project.js";
import {
  cleanPen,
  loadPens,
  loadSelectedPenId,
  type Pen,
  penById,
  penName,
  savePens,
  saveSelectedPenId,
  testSquarePlan,
  testSquareSlots,
  withPen,
} from "./penpilot/pens.js";
import { Fold } from "./penpilot/panel-ui.js";
import { ContinuePanel, chime, PenChangeCard, PensPanel, PenSwatch, PlotPens } from "./penpilot/pens-panel.js";
import { continuePlan, countBelow, drawnLines, partAt, penParts } from "./penpilot/plot-job.js";

const defaultVisualizationOptions = {
  penStrokeWidth: 0.5,
  colorPathsByStrokeOrder: false,
};

const initialState = {
  connected: true,

  paused: false,

  deviceInfo: null as DeviceInfo | null,

  // UI state
  planOptions: defaultPlanOptions,
  visualizationOptions: defaultVisualizationOptions,

  // Options used to produce the current value of |plan|.
  plannedOptions: null as PlanOptions | null,

  // Info about the currently-loaded SVG.
  paths: null as Path[] | null,
  groupLayers: [] as string[],
  strokeLayers: [] as string[],

  // While a plot is in progress, this will be the index of the current motion.
  progress: null as number | null,
};

// Update the initial state with previously persisted settings (if present)

const persistedPlanOptions = JSON.parse(window.localStorage.getItem("planOptions") ?? "{}");
initialState.planOptions = { ...initialState.planOptions, ...persistedPlanOptions };
initialState.planOptions.paperSize = new PaperSize(initialState.planOptions.paperSize.size);

type State = typeof initialState;

type Action =
  | { type: "SET_PLAN_OPTION"; value: Partial<State["planOptions"]> }
  | { type: "SET_VISUALIZATION_OPTION"; value: Partial<State["visualizationOptions"]> }
  | { type: "SET_DEVICE_INFO"; value: State["deviceInfo"] }
  | { type: "SET_PAUSED"; value: boolean }
  | { type: "SET_PROGRESS"; motionIdx: number | null }
  | { type: "SET_CONNECTED"; connected: boolean }
  | { type: "CLEAR_PATHS" }
  | {
      type: "SET_PATHS";
      paths: State["paths"];
      strokeLayers: State["strokeLayers"];
      selectedStrokeLayers: State["planOptions"]["selectedStrokeLayers"];
      groupLayers: State["groupLayers"];
      selectedGroupLayers: State["planOptions"]["selectedGroupLayers"];
      layerMode: State["planOptions"]["layerMode"];
    };

type Dispatcher = React.Dispatch<Action>;
const nullDispatch: Dispatcher = () => null;
const DispatchContext = React.createContext<Dispatcher>(nullDispatch);

/**
 * State machine reducer. Handle actions that update the state.
 * @param state Previous state
 * @param action Message
 * @returns New state
 */
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_PLAN_OPTION":
      return { ...state, planOptions: { ...state.planOptions, ...action.value } };
    case "SET_VISUALIZATION_OPTION":
      return { ...state, visualizationOptions: { ...state.visualizationOptions, ...action.value } };
    case "SET_DEVICE_INFO":
      return { ...state, deviceInfo: action.value };
    case "SET_PAUSED":
      return { ...state, paused: action.value };
    case "SET_PATHS": {
      const { paths, strokeLayers, selectedStrokeLayers, groupLayers, selectedGroupLayers, layerMode } = action;
      return {
        ...state,
        paths,
        groupLayers,
        strokeLayers,
        planOptions: { ...state.planOptions, selectedStrokeLayers, selectedGroupLayers, layerMode },
      };
    }
    case "SET_PROGRESS":
      return { ...state, progress: action.motionIdx };
    case "CLEAR_PATHS":
      return { ...state, paths: null, groupLayers: [], strokeLayers: [] };
    case "SET_CONNECTED":
      return { ...state, connected: action.connected };
    default:
      console.warn(`Unrecognized action '${{ action }}'`);
      return state;
  }
}

// FIXME: This should probably be used for the WebWorker
function serialize(po: PlanOptions): string {
  return JSON.stringify(po, (_k, v) => (v instanceof Set ? [...v] : v));
}

function attemptRejigger(previousOptions: PlanOptions, newOptions: PlanOptions, previousPlan: Plan): Plan | null {
  const newOptionsWithOldPenHeights = {
    ...newOptions,
    penUpHeight: previousOptions.penUpHeight,
    penDownHeight: previousOptions.penDownHeight,
  };
  if (serialize(previousOptions) === serialize(newOptionsWithOldPenHeights)) {
    const device = Device(newOptions.hardware, newOptions.penLiftReversed);
    // The existing plan should be the same except for penup/pendown heights.
    return previousPlan.withPenHeights(
      device.penPctToPos(newOptions.penUpHeight),
      device.penPctToPos(newOptions.penDownHeight),
    );
  }
  return null;
}

/** PenPilot: what to plan -- one job per pen, in plotting order (see background-planner.ts). */
type PlanJob = { penId: string; paths: Path[]; planOptions: PlanOptions };

const usePlan = (jobs: PlanJob[] | null) => {
  const [isPlanning, setIsPlanning] = useState(false);
  const [latestPlan, setPlan] = useState<Plan | null>(null);

  const lastJobs = useRef<PlanJob[]>(null);
  const lastPlan = useRef<Plan>(null);

  useEffect(() => {
    if (!jobs) {
      return () => {};
    }
    const last = lastJobs.current;
    // One pen and the same lines: if only its heights changed, adjust the plan in place.
    if (lastPlan.current !== null && last?.length === 1 && jobs.length === 1 && last[0].paths === jobs[0].paths) {
      const rejiggered = attemptRejigger(last[0].planOptions, jobs[0].planOptions, lastPlan.current);
      if (rejiggered && last[0].penId === jobs[0].penId) {
        setPlan(rejiggered);
        lastPlan.current = rejiggered;
        lastJobs.current = jobs;
        return () => {};
      }
    }
    const worker = new Worker("background-planner.js");
    setIsPlanning(true);
    console.time("posting to worker");
    worker.postMessage({ jobs });
    console.timeEnd("posting to worker");
    const listener = (m: MessageEvent<TransferredMotion[]>) => {
      console.time("deserializing");
      const plan = Plan.fromTransferable(m.data);
      console.timeEnd("deserializing");
      setPlan(plan);
      lastPlan.current = plan;
      lastJobs.current = jobs;
      setIsPlanning(false);
    };
    worker.addEventListener("message", listener);
    // PenPilot: a planner crash used to leave "Replanning..." on screen forever.
    const onError = (e: ErrorEvent) => {
      console.error("Planner failed:", e.message);
      setIsPlanning(false);
    };
    worker.addEventListener("error", onError);
    return () => {
      worker.removeEventListener("message", listener);
      worker.removeEventListener("error", onError);
      worker.terminate();
      setIsPlanning(false);
    };
  }, [jobs]);

  return { isPlanning, plan: latestPlan, setPlan };
};

const setPaths = (paths: Path[]): Action => {
  const strokes = new Set<string>();
  const groups = new Set<string>();
  for (const path of paths) {
    strokes.add(path.stroke);
    groups.add(path.groupId);
  }
  const layerMode = groups.size > 1 ? "group" : "stroke";
  const groupLayers = Array.from(groups).sort();
  const strokeLayers = Array.from(strokes).sort();
  return {
    type: "SET_PATHS",
    paths,
    groupLayers,
    strokeLayers,
    selectedGroupLayers: new Set(groupLayers),
    selectedStrokeLayers: new Set(strokeLayers),
    layerMode,
  };
};

function HardwareOptions({ state, driver }: { state: State; driver: BaseDriver | null }) {
  const dispatch = useContext(DispatchContext);

  const handleHardwareChange = (hardware: Hardware) => {
    // Always update the UI state first
    dispatch({ type: "SET_PLAN_OPTION", value: { hardware } });

    // Then notify the driver if connected
    driver?.changeHardware(hardware);
  };

  const currentHardware = state.deviceInfo?.hardware || state.planOptions.hardware;

  return (
    <label className="pp-setting" title="Which plotter this is (it sets the pen-lift motor and step sizes)">
      <span>Plotter model</span>
      <select value={currentHardware} onChange={(e) => handleHardwareChange(e.target.value as Hardware)} disabled={!driver}>
        <option value="v3">AxiDraw V3</option>
        <option value="brushless">AxiDraw V3 Brushless</option>
        <option value="nextdraw-2234">NextDraw 2234</option>
        <option value="idraw-h-se">iDraw H SE</option>
      </select>
    </label>
  );
}

/** PenPilot: draw the page's lines as wide as each pen really draws them. */
function RealWidthOption({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label
      className="pp-checkbox"
      title="Show the lines as wide as each pen's line width, to see how dark the drawing and its hatching will look on paper"
    >
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      Show lines at the pen's real width
    </label>
  );
}

function OriginOptions({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const device = Device(state.planOptions.hardware);
  const home = state.planOptions.penHome;
  const setHome = (penHome: typeof home) => dispatch({ type: "SET_PLAN_OPTION", value: { penHome } });
  return (
    <>
      <NumberSetting
        label="Pen home, x (mm)"
        title="Starting and final position of the pen when plotting (x)"
        value={home.x}
        step="10"
        max={state.planOptions.paperSize.size.x * device.stepsPerMm}
        onChange={(x) => setHome({ x, y: home.y })}
      />
      <NumberSetting
        label="Pen home, y (mm)"
        title="Starting and final position of the pen when plotting (y)"
        value={home.y}
        step="10"
        max={state.planOptions.paperSize.size.y * device.stepsPerMm}
        onChange={(y) => setHome({ x: home.x, y })}
      />
    </>
  );
}


const MY_SIZE = "★ "; // marks the user's saved sizes in the paper list

/** One line about the paper, for the folded Paper section: "A4 · landscape · 20 mm" (margin). */
function paperSummary(po: PlanOptions): string {
  const { size } = po.paperSize;
  const same = (a: { x: number; y: number }) =>
    (a.x === size.x && a.y === size.y) || (a.y === size.x && a.x === size.y);
  const name =
    Object.keys(PaperSize.standard).find((n) => same(PaperSize.standard[n].size)) ??
    loadPaperSizes().find((m) => sameSize(m, size))?.name ??
    `${Math.round(size.x)} × ${Math.round(size.y)} mm`;
  return `${name} · ${po.paperSize.isLandscape ? "landscape" : "portrait"} · ${po.marginMm} mm`;
}

function PaperConfig({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const landscape = state.planOptions.paperSize.isLandscape;
  // PenPilot: the user's own named sizes, e.g. "Card 10x15".
  const [mySizes, setMySizes] = useState<SavedPaperSize[]>(loadPaperSizes);
  const [newName, setNewName] = useState("");
  const updateMySizes = (list: SavedPaperSize[]) => {
    setMySizes(list);
    savePaperSizes(list);
  };
  function setPaperSize(e: ChangeEvent) {
    const name = (e.target as HTMLInputElement).value;
    if (name.startsWith(MY_SIZE)) {
      const mine = mySizes.find((m) => m.name === name.slice(MY_SIZE.length));
      if (mine) {
        const ps = new PaperSize({ x: mine.x, y: mine.y });
        dispatch({ type: "SET_PLAN_OPTION", value: { paperSize: landscape ? ps.landscape : ps.portrait } });
      }
    } else if (name !== "Custom") {
      const ps = PaperSize.standard[name][landscape ? "landscape" : "portrait"];
      dispatch({ type: "SET_PLAN_OPTION", value: { paperSize: ps } });
    }
  }
  function setCustomPaperSize(x: number, y: number) {
    dispatch({ type: "SET_PLAN_OPTION", value: { paperSize: new PaperSize({ x, y }) } });
  }
  const { paperSize } = state.planOptions;
  const paperSizeName =
    Object.keys(PaperSize.standard).find((psName) => {
      const ps = PaperSize.standard[psName].size;
      return (
        (ps.x === paperSize.size.x && ps.y === paperSize.size.y) ||
        (ps.y === paperSize.size.x && ps.x === paperSize.size.y)
      );
    }) || "Custom";
  const mySizeName = mySizes.find((m) => sameSize(m, paperSize.size))?.name;
  const selectedName = paperSizeName === "Custom" && mySizeName ? `${MY_SIZE}${mySizeName}` : paperSizeName;
  return (
    <div>
      <select value={selectedName} onChange={setPaperSize}>
        {Object.keys(PaperSize.standard).map((name) => (
          <option key={name}>{name}</option>
        ))}
        {mySizes.map((m) => (
          <option key={`mine-${m.name}`}>{`${MY_SIZE}${m.name}`}</option>
        ))}
        <option>Custom</option>
      </select>
      {selectedName === "Custom" && (
        <div className="pp-save-size">
          <input
            type="text"
            placeholder="Name this size, e.g. Card"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button
            type="button"
            className="pp-save-size-button"
            disabled={newName.trim() === ""}
            onClick={() => {
              const name = newName.trim();
              updateMySizes([...mySizes.filter((m) => m.name !== name), { name, ...paperSize.size }]);
              setNewName("");
            }}
          >
            Save size
          </button>
        </div>
      )}
      {selectedName.startsWith(MY_SIZE) && (
        <button
          type="button"
          className="button-link pp-forget-size"
          onClick={() => updateMySizes(mySizes.filter((m) => m.name !== mySizeName))}
        >
          forget “{mySizeName}”
        </button>
      )}
      <div className="paper-sizes">
        <label className="paper-label">
          width (mm)
          <input
            type="number"
            value={paperSize.size.x}
            onChange={(e) => setCustomPaperSize(Number(e.target.value), paperSize.size.y)}
          />
        </label>
        <label className="paper-label">
          height (mm)
          <input
            type="number"
            value={paperSize.size.y}
            onChange={(e) => setCustomPaperSize(paperSize.size.x, Number(e.target.value))}
          />
        </label>
      </div>
      <label>
        margin (mm)
        <input
          type="number"
          value={state.planOptions.marginMm}
          min="0"
          max={Math.min(paperSize.size.x / 2, paperSize.size.y / 2)}
          onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { marginMm: Number(e.target.value) } })}
        />
      </label>
    </div>
  );
}

function PlanStatistics({ plan }: { plan: Plan | null }) {
  const totalDuration = useMemo(() => (plan ? plan.duration() : 0), [plan]);
  return (
    <div className="duration">
      <div>Plot time</div>
      <div>
        <strong>{totalDuration > 0 ? formatDuration(totalDuration) : "-"}</strong>
      </div>
    </div>
  );
}

function TimeLeft({
  plan,
  progress,
  currentMotionStartedTime,
  paused,
}: {
  plan: Plan | null;
  progress: number | null;
  currentMotionStartedTime: Date;
  paused: boolean;
}) {
  const [_, setTime] = useState(new Date());

  // Interval that ticks every second to rerender
  // and recalculate time remaining for long motions
  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  if (!plan || progress === null || paused) {
    return null;
  }

  const currentMotionTimeSpent = (Date.now() - currentMotionStartedTime.getTime()) / 1000;
  const duration = plan.duration(progress);
  return (
    <div className="duration">
      <div>Time left</div>
      <div>
        <strong>{formatDuration(duration - currentMotionTimeSpent)}</strong>
      </div>
    </div>
  );
}

function PlanLoader({ isLoadingFile, isPlanning }: { isLoadingFile: boolean; isPlanning: boolean }) {
  if (isLoadingFile || isPlanning) {
    return <div className="preview-loader">{isLoadingFile ? "Opening…" : "Working out the plot…"}</div>;
  }

  return null;
}

function PlotButtons({
  state,
  plan,
  hasLines,
  isPlanning,
  driver,
  stopping,
  onPlot,
  onStop,
  framing,
  canFrame,
  onFrame,
}: {
  state: State;
  plan: Plan | null;
  hasLines: boolean;
  isPlanning: boolean;
  driver: BaseDriver | null;
  stopping: boolean;
  onPlot: () => void;
  onStop: () => void;
  framing: boolean;
  canFrame: boolean;
  onFrame: () => void;
}) {
  const plotting = state.progress !== null;
  return (
    <div>
      <div className="pp-plot-row">
        <button
          type="button"
          disabled={framing ? false : !canFrame}
          onClick={onFrame}
          title="Move the lifted pen around the area the drawing will cover, to line up the paper"
        >
          {framing ? "Stop frame" : "Frame"}
        </button>
        {isPlanning ? (
          <button type="button" disabled={true}>
            Working…
          </button>
        ) : (
          <button
            type="button"
            className={`plot-button ${plotting ? "plot-button--plotting" : ""}`}
            disabled={plan === null || !hasLines || plotting || !driver}
            onClick={onPlot}
            title={isPlanning ? "Working out the plot" : undefined}
          >
            {plotting ? (stopping ? "Stopping…" : "Plotting…") : "Plot"}
          </button>
        )}
      </div>
      {plotting && (
        <div className={"button-row"}>
          <button
            type="button"
            className="cancel-button cancel-button--active"
            onClick={() => (state.paused ? driver?.resume() : driver?.pause())}
            disabled={stopping}
          >
            {state.paused ? "Resume" : "Pause"}
          </button>
          <button type="button" className="cancel-button cancel-button--active" onClick={onStop} disabled={stopping}>
            Stop
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * PenPilot: put the advanced settings back as they came. (Not the paper, the
 * plotter model or Reverse pen direction: those belong to this plotter.)
 */
function ResetToDefaultsButton() {
  const dispatch = useContext(DispatchContext);
  const onClick = () => {
    const d = defaultPlanOptions;
    dispatch({
      type: "SET_PLAN_OPTION",
      value: {
        sortPaths: d.sortPaths,
        pointJoinRadius: d.pointJoinRadius,
        pathJoinRadius: d.pathJoinRadius,
        minimumPathLength: d.minimumPathLength,
        penDownAcceleration: d.penDownAcceleration,
        penDownCorneringFactor: d.penDownCorneringFactor,
        penUpAcceleration: d.penUpAcceleration,
        penUpMaxVelocity: d.penUpMaxVelocity,
        penLiftDuration: d.penLiftDuration,
        penDropDuration: d.penDropDuration,
        penHome: d.penHome,
      },
    });
  };

  return (
    <button type="reset" className="button-link" onClick={onClick}>
      reset these settings
    </button>
  );
}

/** One Advanced setting: its name on the left, a small number box on the right. */
function NumberSetting({
  label,
  title,
  value,
  step,
  max,
  onChange,
}: {
  label: React.ReactNode;
  title?: string;
  value: number;
  step: string;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="pp-setting" title={title}>
      <span>{label}</span>
      <input type="number" value={value} step={step} min="0" max={max} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function PlanConfig({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const set = (value: Partial<PlanOptions>) => dispatch({ type: "SET_PLAN_OPTION", value });
  const o = state.planOptions;
  return (
    <>
      <div className="pp-advanced-group">
        <div className="pp-advanced-heading">Line clean-up</div>
        <label className="pp-checkbox" title="Draw the lines in an order that keeps the pen's moves in the air short">
          <input type="checkbox" checked={o.sortPaths} onChange={(e) => set({ sortPaths: !!e.target.checked })} />
          Reorder lines to save time
        </label>
        <NumberSetting
          label="Merge points closer than (mm)"
          title="Points of a line closer together than this are merged into one"
          value={o.pointJoinRadius}
          step="0.1"
          onChange={(v) => set({ pointJoinRadius: v })}
        />
        <NumberSetting
          label="Join line ends closer than (mm)"
          title="Lines whose ends are closer than this are joined, so the pen doesn't lift between them"
          value={o.pathJoinRadius}
          step="0.1"
          onChange={(v) => set({ pathJoinRadius: v })}
        />
        <NumberSetting
          label="Skip lines shorter than (mm)"
          title="Lines shorter than this are left out (specks)"
          value={o.minimumPathLength}
          step="0.1"
          onChange={(v) => set({ minimumPathLength: v })}
        />
      </div>
      <div className="pp-advanced-group">
        <div className="pp-advanced-heading">Movement</div>
        <NumberSetting
          label={
            <>
              Acceleration, drawing (mm/s<sup>2</sup>)
            </>
          }
          title="Acceleration when the pen is down"
          value={o.penDownAcceleration}
          step="0.1"
          onChange={(v) => set({ penDownAcceleration: v })}
        />
        <NumberSetting
          label="Corner speed, drawing"
          title="How fast the pen goes round corners while drawing"
          value={o.penDownCorneringFactor}
          step="0.01"
          onChange={(v) => set({ penDownCorneringFactor: v })}
        />
        <NumberSetting
          label={
            <>
              Acceleration, pen up (mm/s<sup>2</sup>)
            </>
          }
          title="Acceleration when the pen is up"
          value={o.penUpAcceleration}
          step="0.1"
          onChange={(v) => set({ penUpAcceleration: v })}
        />
        <NumberSetting
          label="Speed, pen up (mm/s)"
          title="Top speed when the pen is up"
          value={o.penUpMaxVelocity}
          step="0.1"
          onChange={(v) => set({ penUpMaxVelocity: v })}
        />
        <NumberSetting
          label="Time to lift the pen (s)"
          title="How long the pen takes to lift"
          value={o.penLiftDuration}
          step="0.01"
          onChange={(v) => set({ penLiftDuration: v })}
        />
        <NumberSetting
          label="Time to lower the pen (s)"
          title="How long the pen takes to drop"
          value={o.penDropDuration}
          step="0.01"
          onChange={(v) => set({ penDropDuration: v })}
        />
      </div>
    </>
  );
}


type PortSelectorProps = {
  driver: BaseDriver | null;
  setDriver: (driver: BaseDriver) => void;
  hardware: Hardware;
};

function PortSelector({ driver, setDriver, hardware }: PortSelectorProps) {
  const [initializing, setInitializing] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: setDriver is stable
  useEffect(() => {
    (async () => {
      if (driver?.connected) return; // Already connected
      setInitializing(true);
      try {
        const ports = await navigator.serial.getPorts(); // re-connect to previously established connection
        const port = ports[0];
        if (port) {
          console.log("connecting to", port);
          // get the first
          setDriver(await WebSerialDriver.connect(port, hardware));
        }
      } finally {
        setInitializing(false);
      }
    })();
  }, [driver, hardware]);
  return (
    <>
      {driver?.connected ? `Connected to ${driver.name()}` : null}
      <button
        type="button"
        disabled={initializing}
        onClick={async () => {
          setInitializing(true);
          try {
            const port = await navigator.serial.requestPort({
              filters: [{ usbVendorId: 0x04d8, usbProductId: 0xfd92 }],
            });
            setDriver(await WebSerialDriver.connect(port, hardware));
          } catch (e) {
            alert(`Failed to connect to serial device: ${(e as Error).message}`);
            console.error(e);
          } finally {
            setInitializing(false);
          }
        }}
      >
        {initializing ? "Connecting..." : driver?.connected ? "Change port" : "Connect"}
      </button>
    </>
  );
}

/** Edits that, repeated quickly on the same drawing, make one undo step (sliders, typing, nudges). */
const COALESCED_EDITS = new Set<PageAction["type"]>([
  "nudge",
  "update",
  "fill",
  "shape",
  "textSettings",
  "photoSettings",
]);

/** Page actions that change the page itself (so it has unsaved changes). */
const PAGE_EDITS = new Set<PageAction["type"]>([
  "add",
  "update",
  "nudge",
  "remove",
  "replace",
  "split",
  "pen",
  "fill",
  "shape",
  "textSettings",
  "photoSettings",
  "plot",
  "unplot",
]);

function Root() {
  const [driver, setDriver] = useState<BaseDriver | null>(null);
  const [isDriverConnected, setIsDriverConnected] = useState(false);
  useEffect(() => {
    if (isDriverConnected) return;
    if (IS_WEB) return;
    (async () => {
      setDriver(await SaxiDriver.connect());
      setIsDriverConnected(true);
    })();
  }, [isDriverConnected]);

  const [state, dispatch] = useReducer(reducer, initialState);

  // PenPilot: the page (several drawings), and how it sits in the plotter.
  const [page, pageDispatch] = useReducer(pageReducer, emptyPage);
  const pageSize = state.planOptions.paperSize.size;
  const { marginMm, hardware } = state.planOptions;
  const layout = useMemo(() => {
    const reach = machineReach(hardware);
    const placement = choosePlacement(pageSize, reach);
    const drawable = drawableArea(placement, pageSize, reach);
    return { reach, placement, drawable, drawableOnPage: drawableOnPage(placement, pageSize, drawable) };
  }, [pageSize, hardware]);
  // The planner gets lines already placed in machine coordinates; it only crops
  // them to the area the pen can actually draw (the sheet, within the reach).
  const plannerOptions = useMemo(
    () => ({
      ...state.planOptions,
      paperSize: new PaperSize(layout.drawable),
      marginMm: 0,
      fitPage: false,
      cropToMargins: true,
      rotateDrawing: 0,
    }),
    [state.planOptions, layout.drawable],
  );
  // PenPilot: your pens (pens.ts). `penId` is the one being set up, which new drawings get.
  const [pens, setPensState] = useState<Pen[]>(() => loadPens(initialState.planOptions));
  const setPens = (list: Pen[]) => {
    setPensState(list);
    savePens(list);
  };
  const [penId, setPenIdState] = useState(() => loadSelectedPenId(pens));
  const setPenId = (id: string) => {
    setPenIdState(id);
    saveSelectedPenId(id);
  };
  const penOf = React.useCallback((it: PageItem) => penById(pens, it.penId), [pens]);
  const withCurrentPen = (it: PageItem): PageItem => ({ ...it, penId });

  // PenPilot projects: the file this page was opened from or saved to, and
  // whether the page has changed since. Only the user's own edits count, not
  // photos and text finishing drawing.
  const [projectFile, setProjectFile] = useState<{ name: string; path?: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  // Undo / redo: the drawings as they were before each edit. Quick repeats of
  // the same edit (a slider being dragged, typing, nudging) count as one step.
  const history = useRef<{ past: PageItem[][]; future: PageItem[][]; last: { key: string; at: number } | null }>({
    past: [],
    future: [],
    last: null,
  });
  const [, setHistoryVersion] = useState(0);
  const itemsNow = useRef(page.items);
  itemsNow.current = page.items;
  const editPage = React.useCallback((a: PageAction) => {
    if (PAGE_EDITS.has(a.type)) {
      setDirty(true);
      const h = history.current;
      const id = "id" in a ? a.id : "item" in a ? a.item.id : "";
      const editKey = `${a.type}:${id}`;
      const now = Date.now();
      const repeat = h.last?.key === editKey && now - h.last.at < 1000 && COALESCED_EDITS.has(a.type);
      if (!repeat) {
        h.past.push(itemsNow.current);
        if (h.past.length > 100) h.past.shift();
      }
      h.last = { key: editKey, at: now };
      h.future = [];
      setHistoryVersion((n) => n + 1);
    }
    pageDispatch(a);
  }, []);
  const stepHistory = (back: boolean) => {
    const h = history.current;
    const from = back ? h.past : h.future;
    const to = back ? h.future : h.past;
    const items = from.pop();
    if (!items) return;
    to.push(itemsNow.current);
    h.last = null;
    pageDispatch({ type: "restore", items });
    setDirty(true);
    setHistoryVersion((n) => n + 1);
  };
  const clearHistory = () => {
    history.current = { past: [], future: [], last: null };
    setHistoryVersion((n) => n + 1);
  };

  // The page's lines, one group per pen; each is planned with its pen's settings.
  const [segments, setSegments] = useState<{ penId: string; paths: Path[] }[] | null>(null);
  // Only a pen's heights and speed change the plan (not its name or colour).
  const penSettingsKey = JSON.stringify(pens.map((p) => [p.id, p.upHeight, p.downHeight, p.speed]));
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed only when penSettingsKey changes
  const planPens = useMemo(() => pens, [penSettingsKey]);
  const jobs = useMemo(
    () =>
      segments?.map((sg) => ({
        penId: sg.penId,
        paths: sg.paths,
        planOptions: withPen(plannerOptions, penById(planPens, sg.penId)),
      })) ?? null,
    [segments, plannerOptions, planPens],
  );
  const { isPlanning, plan, setPlan } = usePlan(jobs);
  const planRef = useRef(plan);
  planRef.current = plan;
  const lines = useMemo(() => (plan ? drawnLines(plan) : []), [plan]);
  const usedPens = useMemo(() => (plan ? penParts(plan).map((p) => penById(pens, p.penId)) : []), [plan, pens]);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // After a stop: how far it got, and the line to carry on from (see ContinuePanel).
  const [stopped, setStopped] = useState<{ done: number; penId: string | null } | null>(null);
  const [continueFrom, setContinueFrom] = useState(0);

  // Replan when the drawings' lines, fill, pen or placement change -- not when
  // one is merely selected or a photo reports progress -- once edits settle.
  const pageItems = page.items;
  usePhotoRenderer(pageItems, pageDispatch);
  usePenText(pageItems, pageDispatch);
  const lastGeometry = useRef<unknown[] | null>(null);
  // The drawings in the current plan, and in the plot running now (for "untick what was just drawn").
  const plannedIds = useRef<string[]>([]);
  const runIds = useRef<string[]>([]);
  const [justPlotted, setJustPlotted] = useState<string[] | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies(setPlan): React setters are stable
  useEffect(() => {
    const geometry: unknown[] = [layout.placement, pageSize, pens.map((p) => p.id).join()];
    for (const it of pageItems) {
      geometry.push(it.id, it.name, it.paths, it.fill, it.x, it.y, it.scale, it.rotation, penOf(it).id, !!it.skip);
    }
    const last = lastGeometry.current;
    if (last && last.length === geometry.length && last.every((v, i) => v === geometry[i])) return;
    const timer = setTimeout(() => {
      lastGeometry.current = geometry;
      setStopped(null); // the drawings changed: "continue from line" no longer fits
      // Unticked drawings ("plot" off) stay on the page but aren't plotted.
      const drawable = pageItems.filter((it) => it.paths.length > 0 && !it.skip);
      plannedIds.current = drawable.map((it) => it.id);
      if (drawable.length === 0) {
        dispatch({ type: "CLEAR_PATHS" });
        setSegments(null);
        setPlan(null);
      } else {
        const page = { items: drawable, selectedId: null };
        const order = pens.map((p) => p.id);
        const segs = plannerSegments(page, layout.placement, pageSize, (it) => penOf(it).id, order);
        dispatch(setPaths(segs.flatMap((sg) => sg.paths)));
        setSegments(segs);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [pageItems, layout.placement, pageSize, pens, penOf]);

  // Jobs that aren't the page's plot: Frame (pen up round the drawing) and the
  // pen test square. Their progress isn't shown on the page.
  type SideJob = "frame" | "test" | null;
  const [sideJob, setSideJobState] = useState<SideJob>(null);
  const sideJobRef = useRef<SideJob>(null);
  const setSideJob = (j: SideJob) => {
    sideJobRef.current = j;
    setSideJobState(j);
  };
  const framing = sideJob === "frame";
  const [frameLoop, setFrameLoop] = useState(false);
  const frameLoopRef = useRef(false);
  frameLoopRef.current = frameLoop;
  const [stopping, setStopping] = useState(false);
  const [penChange, setPenChange] = useState<string | null>(null);
  const [fileMessage, setFileMessage] = useState<string | null>(null);

  // Every plot goes through here. `toFull` maps a continued plot's progress
  // onto the full plan, so the page shows the whole drawing's progress.
  // `penIn`: the pen in the plotter when it starts (null: the plan's first pen).
  const progressMap = useRef<(i: number) => number>((i) => i);
  const lastProgress = useRef<number | null>(null);
  const run = useRef<{ plan: Plan; penIn: string | null; at: number | null } | null>(null);
  const runPlot = (p: Plan, toFull: (i: number) => number = (i) => i, penIn: string | null = null) => {
    if (!driver) return;
    progressMap.current = toFull;
    lastProgress.current = null;
    run.current = { plan: p, penIn, at: null };
    setStopping(false);
    Promise.resolve(driver.plot(p)).catch((e) => {
      console.error(e);
      const wasSide = sideJobRef.current !== null;
      setSideJob(null);
      setPenChange(null);
      setStopping(false);
      dispatch({ type: "SET_PAUSED", value: false });
      if (!wasSide) noteStopRef.current(true);
      dispatch({ type: "SET_PROGRESS", motionIdx: null });
      setFileMessage(
        "The plotter stopped answering, so the plot stopped. Check the USB cable and the motor power. " +
          "Then push the carriage back to its home corner by hand and use Continue from line.",
      );
    });
  };

  // Remember where a plot stopped. `unsure`: it stopped mid-move (e.g. the
  // cable came out), so redo the line it was on.
  const noteStop = (unsure: boolean) => {
    const at = lastProgress.current;
    const pl = planRef.current;
    if (at === null || !pl) return;
    const all = drawnLines(pl);
    const done = countBelow(all, unsure ? at : at + 1);
    if (done === 0 || done >= all.length) {
      setStopped(null);
      return;
    }
    // The pen in the plotter now. Stopped while waiting for a pen: the old one is still in.
    let penIn = run.current?.penIn ?? null;
    const r = run.current;
    if (r && r.at !== null) {
      const m = r.plan.motions[r.at];
      penIn = partAt(penParts(r.plan), m instanceof PenChange && m.wait ? r.at - 1 : r.at)?.penId ?? penIn;
    }
    setStopped({ done, penId: penIn });
    setContinueFrom(done);
  };
  const noteStopRef = useRef(noteStop);
  noteStopRef.current = noteStop;

  const startPlot = () => {
    if (!plan) return;
    setStopped(null);
    setJustPlotted(null);
    runIds.current = plannedIds.current;
    runPlot(plan);
  };
  const continuePlot = () => {
    if (!plan || !stopped) return;
    const c = continuePlan(plan, continueFrom, state.planOptions, stopped.penId);
    if (!c) return;
    setStopped(null);
    setJustPlotted(null);
    runIds.current = plannedIds.current;
    runPlot(c.plan, c.toFull, stopped.penId);
  };
  const stopPlot = () => {
    setStopping(true);
    driver?.cancel();
  };

  // Frame: trace the drawing's outline with the pen up (see penpilot/frame.ts),
  // at the pen-up height of the pen the plot starts with.
  const firstPen = usedPens[0] ?? penById(pens, penId);
  const frameBox = useMemo(
    () =>
      drawingBoxOnMachine(
        { ...page, items: page.items.filter((it) => !it.skip) },
        layout.placement,
        pageSize,
        layout.drawable,
      ),
    [page, layout, pageSize],
  );
  const startFrame = () => {
    if (!driver || !frameBox) return;
    setSideJob("frame");
    runPlot(framePlan(frameBox, withPen(state.planOptions, firstPen)));
  };
  const startFrameRef = useRef(startFrame);
  startFrameRef.current = startFrame;
  const stopFrame = () => {
    frameLoopRef.current = false;
    setFrameLoop(false);
    driver?.cancel();
  };

  // Test square: each one goes a little further along the paper's edge.
  const testSlot = useRef(0);
  const startTest = (pen: Pen) => {
    if (!driver) return;
    const slot = testSlot.current % testSquareSlots(layout.drawable.x);
    testSlot.current += 1;
    setSideJob("test");
    runPlot(testSquarePlan(pen, state.planOptions, slot));
  };

  useEffect(() => {
    window.localStorage.setItem("planOptions", JSON.stringify(state.planOptions));
  }, [state.planOptions]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(setPlan): React setters are stable
  useEffect(() => {
    if (driver === null) return;
    driver.onprogress = (motionIdx: number) => {
      if (sideJobRef.current) return;
      if (run.current) run.current.at = motionIdx;
      const full = progressMap.current(motionIdx);
      lastProgress.current = full;
      dispatch({ type: "SET_PROGRESS", motionIdx: full });
    };
    driver.oncancelled = () => {
      setPenChange(null);
      setStopping(false);
      if (sideJobRef.current) {
        sideJobRef.current = null;
        setSideJobState(null);
      } else noteStopRef.current(false);
      dispatch({ type: "SET_PAUSED", value: false });
      dispatch({ type: "SET_PROGRESS", motionIdx: null });
    };
    driver.onfinished = () => {
      setPenChange(null);
      setStopping(false);
      const was = sideJobRef.current;
      if (was) {
        sideJobRef.current = null;
        setSideJobState(null);
        // "Keep going round": start the next lap once this one has finished.
        if (was === "frame" && frameLoopRef.current) setTimeout(() => startFrameRef.current(), 0);
        return;
      }
      setStopped(null);
      setJustPlotted(runIds.current);
      dispatch({ type: "SET_PROGRESS", motionIdx: null });
    };
    driver.onpenchange = (id: string | null) => {
      setPenChange(id);
      if (id) {
        chime();
        void desktop?.attention?.();
      }
    };
    driver.ondevinfo = (devInfo: DeviceInfo) => {
      dispatch({ type: "SET_DEVICE_INFO", value: devInfo });
      dispatch({ type: "SET_PLAN_OPTION", value: { hardware: devInfo.hardware } });
    };
    driver.onpause = (paused: boolean) => {
      dispatch({ type: "SET_PAUSED", value: paused });
    };
    driver.onplan = (plan: Plan) => {
      setPlan(plan);
    };
  }, [driver]);

  useEffect(() => {
    // poll the driver so React notices connection changes
    if (!driver) return;
    const interval = setInterval(() => {
      if (state.connected !== driver.connected) {
        dispatch({ type: "SET_CONNECTED", connected: driver.connected });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [driver, state.connected]);

  // PenPilot: say plainly when a file can't be plotted (fileMessage), instead of
  // leaving "Loading file..." on screen (saxi's readSvg used to throw on non-SVG input).

  const loadSvgText = React.useCallback(
    (text: string, name: string) => {
      let paths: Path[];
      try {
        paths = readSvg(text);
      } catch (e) {
        console.error(e);
        setFileMessage(`PenPilot couldn't read “${name}” as an SVG drawing.`);
        return;
      }
      if (paths.length === 0) {
        setFileMessage(`“${name}” has no lines for the pen to draw. It may contain only a picture.`);
        return;
      }
      const created = newItem(name, paths, pageSize, marginMm);
      const item = created && { ...created, svgText: text, fillOnly: isFillOnlySvg(text), penId };
      if (!item) {
        setFileMessage(`“${name}” has no lines for the pen to draw. It may contain only a picture.`);
        return;
      }
      setFileMessage(null);
      editPage({ type: "add", items: [item] });
    },
    [pageSize, marginMm, penId, editPage],
  );

  // An SVG of filled shapes -> the same drawing as a centre-line trace, same size and place.
  const traceSvgItem = React.useCallback(
    async (item: PageItem) => {
      if (!item.svgText) return;
      try {
        const { bitmap, previewUrl } = await svgToBitmap(item.svgText, item.bounds);
        const traced = newPhotoItem(item.name, bitmap, previewUrl, pageSize, marginMm);
        const before = itemSize(item);
        const turned = item.rotation === 90 || item.rotation === 270;
        const sourceWidthMm = turned ? before.y : before.x;
        const pad = 2 * item.scale; // svgToBitmap keeps a 2 px border
        const photoWidthPx = traced.photo?.width ?? 1;
        let next: PageItem = {
          ...traced,
          rotation: item.rotation,
          scale: (sourceWidthMm + 2 * pad) / photoWidthPx,
          penId: item.penId,
        };
        const after = itemSize(next);
        next = { ...next, x: item.x + (before.x - after.x) / 2, y: item.y + (before.y - after.y) / 2 };
        editPage({ type: "replace", id: item.id, item: next });
      } catch (e) {
        console.error(e);
        setFileMessage(`PenPilot couldn't trace “${item.name}”.`);
      }
    },
    [pageSize, marginMm, editPage],
  );

  const handleFile = React.useCallback(
    (file: File) => {
      if (new RegExp(`\\.${PROJECT_EXTENSION}$`, "i").test(file.name)) {
        // A PenPilot project: opens in place of the page.
        openProjectFileRef.current(file);
        return;
      }
      if (isImageFile(file)) {
        // A photo: becomes pen lines through a Plotterfun style (penpilot/photo.ts).
        setIsLoadingFile(true);
        createImageBitmap(file)
          .then((bitmap) => {
            const url = URL.createObjectURL(file);
            const photo = { ...newPhotoItem(file.name, bitmap, url, pageSize, marginMm), penId };
            editPage({ type: "add", items: [photo] });
            setFileMessage(null);
          })
          .catch(() => setFileMessage(`PenPilot couldn't open the picture “${file.name}”.`))
          .finally(() => setIsLoadingFile(false));
        return;
      }
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      if (!isSvg) {
        setFileMessage(`PenPilot can't use “${file.name}”. Add an SVG drawing or a photo (JPG, PNG, WebP, GIF).`);
        return;
      }
      setIsLoadingFile(true);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          loadSvgText(reader.result as string, file.name);
        } finally {
          setIsLoadingFile(false);
        }
      };
      reader.onerror = () => {
        setIsLoadingFile(false);
        setFileMessage(`PenPilot couldn't open “${file.name}”.`);
      };
      reader.readAsText(file);
    },
    [loadSvgText, pageSize, marginMm, penId, editPage],
  );

  useEffect(() => {
    // Called when the user drags and drops the image
    const ondrop = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.remove("dragover");
      for (const file of Array.from(e.dataTransfer?.files ?? [])) handleFile(file);
    };
    const ondragover = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.add("dragover");
    };
    const ondragleave = (e: DragEvent) => {
      e.preventDefault();
      document.body.classList.remove("dragover");
    };
    const onpaste = (e: ClipboardEvent) => {
      // Pasting into a text box is just typing; and only SVG text is a drawing.
      if (editingText()) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (/<svg[\s>]/i.test(text)) loadSvgText(text, "the pasted drawing");
    };
    document.body.addEventListener("drop", ondrop);
    document.body.addEventListener("dragover", ondragover);
    document.body.addEventListener("dragleave", ondragleave);
    document.addEventListener("paste", onpaste);
    return () => {
      document.body.removeEventListener("drop", ondrop);
      document.body.removeEventListener("dragover", ondragover);
      document.body.removeEventListener("dragleave", ondragleave);
      document.removeEventListener("paste", onpaste);
    };
  }, [handleFile, loadSvgText]);

  // Each time new motion is started, save the start time
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentMotionStartedTime should be re-set with each motion
  const currentMotionStartedTime = useMemo(() => {
    return new Date();
  }, [state.progress, state.paused]);

  // ---- Projects: save, open, export ----
  const appVersion = useRef("dev");
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    desktop
      ?.info()
      .then((i) => {
        appVersion.current = i.version;
        setVersion(i.version);
      })
      .catch(() => {});
  }, []);
  // The welcome guide: on first opening, and from Help.
  const [showWelcome, setShowWelcome] = useState(() => !welcomeSeen());
  // Help > Plotter check in the menu bar opens the check (counts up each time).
  const [plotterCheckRequest, setPlotterCheckRequest] = useState(0);
  const askToDiscard = () =>
    !dirty || page.items.length === 0 || window.confirm("Your page has changes that aren't saved. Carry on anyway?");
  const baseName = () => fileBaseName(projectFile?.name ?? page.items[0]?.name ?? "My page");

  const saveProject = async (as: boolean) => {
    if (page.items.length === 0) return;
    try {
      const usedPens = pens.filter((p) => page.items.some((it) => penOf(it).id === p.id));
      const text = await projectToText(
        { paper: { width: pageSize.x, height: pageSize.y, margin: marginMm }, pens: usedPens, items: page.items },
        appVersion.current,
      );
      const name = `${baseName()}.${PROJECT_EXTENSION}`;
      if (desktop?.saveFileAs) {
        let r = !as && projectFile?.path && desktop.saveFile ? await desktop.saveFile(projectFile.path, text) : null;
        if (!r?.ok) r = await desktop.saveFileAs("project", name, text);
        if (!r.ok) {
          if (!r.canceled) setFileMessage(r.message ?? "PenPilot couldn't save the project.");
          return;
        }
        setProjectFile({ name: r.name ?? name, path: r.path });
      } else {
        downloadText(name, text, "application/json");
        setProjectFile({ name });
      }
      setDirty(false);
    } catch (e) {
      setFileMessage(`PenPilot couldn't save the project. ${(e as Error).message}`);
    }
  };

  const openProjectText = async (text: string, file: { name: string; path?: string }) => {
    try {
      const project = await projectFromText(text);
      // Pens this computer doesn't have yet come with the project.
      const known = new Set(pens.map((p) => p.id));
      const extra = project.pens.filter((p) => !known.has(p.id)).map((p) => cleanPen(p, pens[0]));
      if (extra.length > 0) setPens([...pens, ...extra]);
      const paper = new PaperSize({ x: project.paper.width, y: project.paper.height });
      dispatch({ type: "SET_PLAN_OPTION", value: { paperSize: paper, marginMm: project.paper.margin } });
      pageDispatch({ type: "load", items: project.items });
      clearHistory();
      setProjectFile(file);
      setDirty(false);
      setStopped(null);
      setFileMessage(null);
    } catch (e) {
      setFileMessage(`PenPilot couldn't open “${file.name}”. ${(e as Error).message}`);
    }
  };
  const openProjectFile = (file: File) => {
    if (locked || !askToDiscard()) return;
    file
      .text()
      .then((text) => openProjectText(text, { name: file.name }))
      .catch(() => setFileMessage(`PenPilot couldn't open “${file.name}”.`));
  };
  const openProjectFileRef = useRef(openProjectFile);
  openProjectFileRef.current = openProjectFile;
  // Projects double-clicked in Finder / Explorer (desktop app).
  const openFromSystem = useRef(
    (_file: { ok: boolean; name?: string; path?: string; text?: string; message?: string }) => {},
  );
  openFromSystem.current = (file) => {
    if (!file.ok || file.text === undefined) {
      setFileMessage(file.message ?? "PenPilot couldn't open that project.");
      return;
    }
    if (locked) {
      setFileMessage(`Finish or stop the plot first, then open “${file.name}” again.`);
      return;
    }
    if (!askToDiscard()) return;
    void openProjectText(file.text, { name: file.name ?? "project", path: file.path });
  };
  useEffect(() => {
    if (!desktop?.takeOpenFiles) return;
    const stop = desktop.onOpenFile?.((f) => openFromSystem.current(f));
    desktop
      .takeOpenFiles()
      .then((files) => {
        for (const f of files) openFromSystem.current(f);
      })
      .catch(() => {});
    return () => stop?.();
  }, []);
  const projectInput = useRef<HTMLInputElement>(null);
  const openProject = async () => {
    if (locked || !askToDiscard()) return;
    if (!desktop?.openProject) {
      projectInput.current?.click(); // browser: pick a file
      return;
    }
    try {
      const r = await desktop.openProject();
      if (r.ok && r.text !== undefined) await openProjectText(r.text, { name: r.name ?? "project", path: r.path });
      else if (!r.ok && !r.canceled) setFileMessage(r.message ?? "PenPilot couldn't open the project.");
    } catch (e) {
      setFileMessage(`PenPilot couldn't open the project. ${(e as Error).message}`);
    }
  };

  const exportSvg = async () => {
    if (page.items.length === 0) return;
    const svg = pageToSvg(page.items, pageSize, pens, penOf);
    const name = `${baseName()}.svg`;
    try {
      if (desktop?.saveFileAs) {
        const r = await desktop.saveFileAs("svg", name, svg);
        if (!r.ok && !r.canceled) setFileMessage(r.message ?? "PenPilot couldn't export the SVG.");
      } else downloadText(name, svg, "image/svg+xml");
    } catch (e) {
      setFileMessage(`PenPilot couldn't export the SVG. ${(e as Error).message}`);
    }
  };

  const newPage = () => {
    if (locked || !askToDiscard()) return;
    pageDispatch({ type: "clear" });
    clearHistory();
    setProjectFile(null);
    setDirty(false);
    setStopped(null);
  };

  // Undo, redo, duplicate, remove (toolbar, menu bar, keys). In a text box,
  // Undo and Redo belong to the text.
  const selectedItem = page.items.find((it) => it.id === page.selectedId) ?? null;
  const undo = () => {
    if (editingText()) document.execCommand("undo");
    else if (!locked) stepHistory(true);
  };
  const redo = () => {
    if (editingText()) document.execCommand("redo");
    else if (!locked) stepHistory(false);
  };
  const duplicateSelected = () => {
    if (selectedItem && !locked) editPage({ type: "add", items: [duplicateItem(selectedItem)] });
  };
  const removeSelected = () => {
    if (selectedItem && !locked) editPage({ type: "remove", id: selectedItem.id });
  };

  // Workspace zoom, and whether the grey pen-up moves show (saved on this computer).
  const zoomer = useZoom();
  const [showTravel, setShowTravelState] = useState(() => {
    try {
      return window.localStorage.getItem("penpilot.showTravel") !== "false";
    } catch {
      return true;
    }
  });
  const toggleTravel = () => {
    setShowTravelState(!showTravel);
    try {
      window.localStorage.setItem("penpilot.showTravel", String(!showTravel));
    } catch {
      // ignore
    }
  };

  // Updates (desktop app): "PenPilot X is ready" when the releases page has a newer version.
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  useEffect(() => {
    const u = desktop?.updates;
    if (!u) return;
    const stopAvailable = u.onAvailable((info) => {
      setUpdate(info);
      setUpdateError(null);
    });
    const stopProgress = u.onProgress((p) =>
      setUpdateProgress(
        p.deferred ? "deferred" : p.installing ? "installing" : { fraction: p.total ? (p.received ?? 0) / p.total : 0 },
      ),
    );
    return () => {
      stopAvailable();
      stopProgress();
    };
  }, []);
  const checkForUpdates = async () => {
    const r = await desktop?.updates?.check();
    if (!r) return;
    if (!("current" in r)) setFileMessage(r.message);
    else if (r.available) {
      setUpdate(r);
      setUpdateError(null);
    } else setFileMessage(`You have the newest PenPilot (${r.current}).`);
  };
  const installUpdate = async () => {
    setUpdateError(null);
    setUpdateProgress({ fraction: 0 });
    const r = await desktop?.updates?.install();
    if (r && !r.ok) {
      setUpdateProgress(null);
      setUpdateError(r.message ?? "The update didn't work. Try again later.");
    }
  };

  // The desktop app's menu bar (File, Edit, View, Help).
  const menuCommand = useRef((_command: string) => {});
  menuCommand.current = (command) => {
    if (command === "check-updates") void checkForUpdates();
    else if (command === "undo") undo();
    else if (command === "redo") redo();
    else if (command === "duplicate") duplicateSelected();
    else if (command === "zoom-in") zoomer.zoomIn();
    else if (command === "zoom-out") zoomer.zoomOut();
    else if (command === "zoom-fit") zoomer.fit();
    else if (command === "toggle-travel") toggleTravel();
    if (command === "new") newPage();
    else if (command === "open") void openProject();
    else if (command === "save") void saveProject(false);
    else if (command === "save-as") void saveProject(true);
    else if (command === "export-svg") void exportSvg();
    else if (command === "help") setShowWelcome(true);
    else if (command === "plotter-check") setPlotterCheckRequest((n) => n + 1);
  };
  useEffect(() => desktop?.onMenu?.((command) => menuCommand.current(command)), []);

  // Keyboard (browser only; the desktop menu bar has its own shortcuts):
  // Cmd/Ctrl+S saves (with Shift: save as), O opens, Z / Shift+Z / Y undo and
  // redo, D duplicates, + / - / 0 zoom.
  const shortcuts = useRef({ save: saveProject, open: openProject, menu: menuCommand });
  shortcuts.current = { save: saveProject, open: openProject, menu: menuCommand };
  useEffect(() => {
    if (desktop?.onMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      const run = (command: string) => {
        e.preventDefault();
        shortcuts.current.menu.current(command);
      };
      if (k === "s") {
        e.preventDefault();
        void shortcuts.current.save(e.shiftKey);
      } else if (k === "o" && !e.shiftKey) {
        e.preventDefault();
        void shortcuts.current.open();
      } else if ((k === "z" || k === "y") && !editingText()) run(k === "y" || e.shiftKey ? "redo" : "undo");
      else if (k === "d") run("duplicate");
      else if (k === "=" || k === "+") run("zoom-in");
      else if (k === "-") run("zoom-out");
      else if (k === "0") run("zoom-fit");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Closing with unsaved changes: the desktop app asks first (main.cjs).
  const unsaved = dirty && page.items.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [unsaved]);
  useEffect(() => {
    document.title = projectFile
      ? `${fileBaseName(projectFile.name)}${unsaved ? " (not saved)" : ""} – PenPilot`
      : "PenPilot";
  }, [projectFile, unsaved]);

  const previewArea = useRef<HTMLDivElement>(null);
  // The page fits the scrolling part of the workspace (below the toolbar) at 100% zoom.
  const previewSize = useComponentSize(zoomer.scroller);
  // The plot block is fixed to the bottom of the panel and grows (pens, continue
  // from line), so the scroll spacer follows its height.
  const plotBlock = useRef<HTMLDivElement>(null);
  const plotBlockSize = useComponentSize(plotBlock);
  const showDragTarget = page.items.length === 0 && !isLoadingFile;
  const plotting = state.progress !== null;
  const locked = plotting || sideJob !== null;
  const connected = !!driver?.connected && state.connected;
  const canMovePen = connected && sideJob === null && (!plotting || state.paused);
  const device = Device(hardware, state.planOptions.penLiftReversed);
  const addFiles = (files: File[]) => {
    for (const f of files) handleFile(f);
  };
  // PenPilot: draw lines at the pen's real width (saved on this computer).
  const [trueWidth, setTrueWidthState] = useState(() => {
    try {
      return window.localStorage.getItem("penpilot.trueWidth") !== "false";
    } catch {
      return true;
    }
  });
  const setTrueWidth = (v: boolean) => {
    setTrueWidthState(v);
    try {
      window.localStorage.setItem("penpilot.trueWidth", String(v));
    } catch {
      // ignore
    }
  };
  // Swap two pens in the plotting order (the order of the pens list).
  const plotPenEarlier = (i: number) => {
    const a = pens.findIndex((p) => p.id === usedPens[i - 1]?.id);
    const b = pens.findIndex((p) => p.id === usedPens[i]?.id);
    if (a < 0 || b < 0) return;
    const next = pens.slice();
    [next[a], next[b]] = [next[b], next[a]];
    setPens(next);
  };
  const showContinue = stopped !== null && !locked && plan !== null && lines.length > 0;
  const from = Math.min(continueFrom, Math.max(0, lines.length - 1));
  const changingTo = penChange ? penById(pens, penChange) : null;
  const changeNumber = penChange ? Math.max(1, usedPens.findIndex((p) => p.id === penChange) + 1) : 0;

  return (
    <DispatchContext.Provider value={dispatch}>
      <div className={`root ${state.connected ? "connected" : "disconnected"}`}>
        <div className="control-panel">
          <div className="pp-header">
            <div className={"saxi-title red"}>
              <span className="red reg">Pen</span>
              <span className="teal">Pilot</span>
            </div>
            <button
              type="button"
              className="pp-help"
              onClick={() => setShowWelcome(true)}
              title="Help: the welcome guide"
              aria-label="Help"
            >
              ?
            </button>
          </div>
          <ProjectBar
            inMenuBar={!!desktop?.onMenu}
            fileName={projectFile?.name ?? null}
            dirty={unsaved}
            hasItems={page.items.length > 0}
            locked={locked}
            onNew={newPage}
            onOpen={() => void openProject()}
            onSave={() => void saveProject(false)}
            onSaveAs={() => void saveProject(true)}
            onExportSvg={() => void exportSvg()}
          />
          <input
            ref={projectInput}
            type="file"
            accept=".penpilot"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) f.text().then((text) => openProjectText(text, { name: f.name }));
            }}
          />
          {!IS_WEB && (
            <div className={state.connected && state.deviceInfo?.path ? "info" : "info-disconnected"}>
              {state.connected
                ? state.deviceInfo?.path
                  ? `Connected to EBB at ${state.deviceInfo.path}`
                  : "Not connected to EBB"
                : "disconnected"}
            </div>
          )}
          {IS_WEB && desktop && (
            <div className="section-body">
              <PlotterCheck
                driver={driver}
                setDriver={setDriver}
                hardware={state.planOptions.hardware}
                busy={locked}
                openRequest={plotterCheckRequest}
              />
            </div>
          )}
          {IS_WEB && !desktop && (
            <PortSelector
              driver={driver}
              setDriver={setDriver}
              hardware={(driver as WebSerialDriver)?.ebb?.hardware ?? state.planOptions.hardware}
            />
          )}
          <Fold
            id="pens"
            title="Pen"
            icon="pen"
            summary={
              <>
                <PenSwatch pen={penById(pens, penId)} />
                {penName(penById(pens, penId))}
              </>
            }
          >
            <PensPanel
              pens={pens}
              setPens={setPens}
              penId={penId}
              setPenId={setPenId}
              driver={driver}
              device={device}
              canMovePen={canMovePen}
              locked={locked}
              testing={sideJob === "test"}
              canTest={canMovePen && !plotting}
              onTest={startTest}
              onMotorsOff={() => driver?.limp()}
              canMotorsOff={connected && !plotting && sideJob === null}
            />
          </Fold>
          <Fold id="paper" title="Paper" icon="paper" defaultOpen={false} summary={paperSummary(state.planOptions)}>
            <OrientationNotes
              isLandscape={state.planOptions.paperSize.isLandscape}
              onOrientation={(landscape) =>
                dispatch({
                  type: "SET_PLAN_OPTION",
                  value: {
                    paperSize: landscape ? state.planOptions.paperSize.landscape : state.planOptions.paperSize.portrait,
                  },
                })
              }
              placement={layout.placement}
              pageSize={pageSize}
              reach={layout.reach}
              locked={locked}
            />
            {/* Locked while plotting: a new paper would replan under the running plot. */}
            <fieldset className="pp-lock" disabled={locked}>
              <PaperConfig state={state} />
            </fieldset>
          </Fold>
          <Fold
            id="drawings"
            title="Drawings"
            icon="drawings"
            summary={page.items.length === 0 ? "none yet" : String(page.items.length)}
          >
            <DrawingsPanel
              page={page}
              pageDispatch={editPage}
              pageSize={pageSize}
              marginMm={marginMm}
              drawable={layout.drawableOnPage}
              locked={locked}
              pens={pens}
              penOf={penOf}
              onAddFiles={addFiles}
              onTraceSvg={traceSvgItem}
              onAddText={() => editPage({ type: "add", items: [withCurrentPen(newTextItem(pageSize))] })}
              onAddShape={(kind) =>
                editPage({ type: "add", items: [withCurrentPen(newShapeItem(kind, pageSize, marginMm))] })
              }
            />
          </Fold>
          <Fold id="advanced" title="Advanced" icon="advanced" defaultOpen={false}>
            <div className="pp-advanced-group">
              <div className="pp-advanced-heading">Preview</div>
              <RealWidthOption value={trueWidth} onChange={setTrueWidth} />
            </div>
            {/* Locked while plotting: a change would replan under the running plot. */}
            <fieldset className="pp-lock" disabled={locked}>
              <div className="pp-advanced-group">
                <div className="pp-advanced-heading">Plotter</div>
                <HardwareOptions state={state} driver={driver} />
                <label
                  className="pp-checkbox"
                  title="Tick this if pressing Raise lowers the pen on your plotter. Common on AxiDraw-compatible clones."
                >
                  <input
                    type="checkbox"
                    checked={state.planOptions.penLiftReversed}
                    disabled={locked}
                    onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { penLiftReversed: e.target.checked } })}
                  />
                  Reverse pen direction
                </label>
                <OriginOptions state={state} />
              </div>
              <PlanConfig state={state} />
              <ResetToDefaultsButton />
            </fieldset>
          </Fold>
          <div className="spacer" style={{ height: Math.max(200, plotBlockSize.height + 20) }} />
          <div className="control-panel-bottom" ref={plotBlock}>
            <div className="section-body section-body__plot">
              <PlanStatistics plan={plan} />
              <PlotPens used={usedPens} onEarlier={plotPenEarlier} locked={locked} />
              <TimeLeft
                plan={plan}
                progress={state.progress}
                currentMotionStartedTime={currentMotionStartedTime}
                paused={state.paused}
              />
              {state.paused && !penChange && (
                <div className="pp-note pp-paused">
                  Paused with the pen lifted. You can swap the pen now, then press Resume to carry on.
                </div>
              )}
              {showContinue && stopped && (
                <ContinuePanel
                  done={stopped.done}
                  total={lines.length}
                  from={from}
                  setFrom={setContinueFrom}
                  canPlot={connected && !isPlanning}
                  onContinue={continuePlot}
                  onForget={() => setStopped(null)}
                />
              )}
              {justPlotted && !locked && page.items.some((it) => justPlotted.includes(it.id) && !it.skip) && (
                <div className="pp-done-note">
                  <div>Finished. Untick what was just drawn, so the next Plot only draws new things?</div>
                  <div className="pp-buttons">
                    <button
                      type="button"
                      onClick={() => {
                        editPage({ type: "unplot", ids: justPlotted });
                        setJustPlotted(null);
                      }}
                    >
                      Untick them
                    </button>
                    <button type="button" onClick={() => setJustPlotted(null)}>
                      No thanks
                    </button>
                  </div>
                </div>
              )}
              <PlotButtons
                plan={plan}
                hasLines={lines.length > 0}
                isPlanning={isPlanning}
                state={state}
                driver={sideJob === null ? driver : null}
                stopping={stopping}
                onPlot={startPlot}
                onStop={stopPlot}
                framing={framing}
                canFrame={connected && !!frameBox && !locked}
                onFrame={framing ? stopFrame : startFrame}
              />
              {!plotting && (
                <label className="pp-checkbox pp-frame-loop" title="Keep going round until you press Stop frame">
                  <input type="checkbox" checked={frameLoop} onChange={(e) => setFrameLoop(e.target.checked)} />
                  Frame keeps going round
                </label>
              )}
            </div>
          </div>
        </div>
        <div className="preview-area pp-workspace" ref={previewArea}>
          <WorkspaceToolbar
            canUndo={history.current.past.length > 0}
            canRedo={history.current.future.length > 0}
            canSave={page.items.length > 0}
            hasSelection={selectedItem !== null}
            locked={locked}
            zoom={zoomer.zoom}
            showTravel={showTravel}
            onUndo={undo}
            onRedo={redo}
            onSave={() => void saveProject(false)}
            onDuplicate={duplicateSelected}
            onDelete={removeSelected}
            onZoomIn={zoomer.zoomIn}
            onZoomOut={zoomer.zoomOut}
            onFit={zoomer.fit}
            onToggleTravel={toggleTravel}
          />
          <div className="pp-scroller" ref={zoomer.scroller}>
            <PageCanvas
              page={page}
              pageDispatch={editPage}
              pageSize={pageSize}
              marginMm={marginMm}
              placement={layout.placement}
              drawable={layout.drawableOnPage}
              plan={plan}
              stepsPerMm={Device(hardware).stepsPerMm}
              progress={sideJob ? null : (state.progress ?? (showContinue ? (lines[from] ?? null) : null))}
              locked={locked}
              penOf={penOf}
              trueWidth={trueWidth}
              previewSize={{ width: Math.max(0, previewSize.width - 40), height: Math.max(0, previewSize.height - 40) }}
              zoom={zoomer.zoom}
              showTravel={showTravel}
            />
          </div>
          <PlanLoader isPlanning={isPlanning} isLoadingFile={isLoadingFile} />
          {fileMessage && (
            <div className="pp-file-message" role="alert">
              <span>{fileMessage}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setFileMessage(null)}>
                ×
              </button>
            </div>
          )}
          {changingTo && (
            <PenChangeCard
              pen={changingTo}
              number={changeNumber}
              of={Math.max(changeNumber, usedPens.length)}
              canMovePen={connected}
              onLower={() => driver?.setPenHeight(device.penPctToPos(changingTo.downHeight), 1000)}
              onRaise={() => driver?.setPenHeight(device.penPctToPos(changingTo.upHeight), 1000)}
              onContinue={() => driver?.resume()}
              onStop={stopPlot}
            />
          )}
          {showDragTarget && <DragTarget handleFile={handleFile} />}
        </div>
        {update && (
          <UpdateCard
            info={update}
            progress={updateProgress}
            error={updateError}
            unsaved={unsaved}
            locked={locked}
            onInstall={() => void installUpdate()}
            onLater={() => setUpdate(null)}
            onOpenPage={() => void desktop?.updates?.openPage()}
          />
        )}
        {showWelcome && <WelcomeGuide version={version} onClose={() => setShowWelcome(false)} />}
      </div>
    </DispatchContext.Provider>
  );
}

function DragTarget({ handleFile }: { handleFile: (file: File) => void }) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileInputChange = React.useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      for (const file of Array.from(e.target.files ?? [])) handleFile(file);
      e.target.value = "";
    },
    [handleFile],
  );

  return (
    <div className="drag-target">
      <div className="drag-target-message">
        <span>Drag a drawing (SVG) or photo here, or</span>
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          Choose file
        </button>{" "}
        {/* the input for the system file picker can't be styled, so hide it and use this button*/}
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif,image/bmp"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />
      </div>
    </div>
  );
}

// Windows-only styling (thin scrollbars).
if (isWindows) document.documentElement.classList.add("pp-windows");

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
// biome-ignore lint/style/noNonNullAssertion: static element
createRoot(document.getElementById("app")!).render(<Root />);

/**
 * PenPilot: true when every shape in the SVG is filled and none has a stroke
 * (typical "image trace" output). A pen plots such shapes as their outlines.
 */
function isFillOnlySvg(svgString: string): boolean {
  const doc = new DOMParser().parseFromString(svgString, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) return false;
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "99999px";
  document.body.appendChild(container);
  try {
    const live = container.appendChild(document.importNode(svg, true));
    const shapes = Array.from(live.querySelectorAll("path, rect, circle, ellipse, polygon, polyline, line"));
    if (shapes.length === 0) return false;
    return shapes.every((el) => {
      const cs = getComputedStyle(el);
      return cs.stroke === "none" && cs.fill !== "none";
    });
  } finally {
    container.remove();
  }
}

/**
 * Read an SVG string and transform it to a list of Path.
 * @param svgString Raw SVG String
 * @returns A list of obj
 */
function readSvg(svgString: string): Path[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, "image/svg+xml");

  const svg = doc.querySelector("svg");
  if (!svg || doc.querySelector("parsererror")) {
    throw new Error("Not an SVG document");
  }
  // flattenSVG relies on getCTM(), which returns null on elements that aren't
  // part of a rendered document. Without it, the viewBox -> width/height
  // scaling is lost and drawings with a viewBox come out the wrong size, so
  // temporarily attach the SVG off-screen while flattening.
  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "99999px";
  document.body.appendChild(container);
  try {
    const live = container.appendChild(document.importNode(svg, true));
    return flattenSVG(live);
  } finally {
    container.remove();
  }
}
