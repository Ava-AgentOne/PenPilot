/**
 * Front-end for plotter app.
 */

import { flattenSVG, type Path } from "flatten-svg";
import React, { type ChangeEvent, Fragment, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { PaperSize } from "./paper-size.js";
import { Device, defaultPlanOptions, Plan, type PlanOptions, type TransferredMotion } from "./planning.js";
import useComponentSize from "./useComponentSize.js";

import { formatDuration } from "./util.js";

import "@fontsource/work-sans/400.css";
import "@fontsource/work-sans/700.css";
import "@fontsource/work-sans/900.css";
import "./style.css";
import "./penpilot/penpilot.css";
import { type BaseDriver, type DeviceInfo, SaxiDriver, WebSerialDriver } from "./drivers.js";
import type { Hardware } from "./ebb.js";
import pathJoinRadiusIcon from "./icons/path-joining radius.svg";
import pointJoinRadiusIcon from "./icons/point-joining radius.svg";
import { desktop } from "./penpilot/desktop.js";
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
  pageReducer,
  plannerPaths,
} from "./penpilot/page.js";
import { DrawingsPanel, OrientationNotes, PageCanvas } from "./penpilot/page-editor.js";
import { PlotterCheck } from "./penpilot/plotter-check.js";

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

const usePlan = (paths: Path[] | null, planOptions: PlanOptions) => {
  const [isPlanning, setIsPlanning] = useState(false);
  const [latestPlan, setPlan] = useState<Plan | null>(null);

  const lastPaths = useRef<Path[]>(null);
  const lastPlan = useRef<Plan>(null);
  const lastPlanOptions = useRef<PlanOptions>(null);

  useEffect(() => {
    if (!paths) {
      return () => {};
    }
    if (lastPlan.current !== null && lastPaths.current === paths) {
      const rejiggered = attemptRejigger(lastPlanOptions.current ?? defaultPlanOptions, planOptions, lastPlan.current);
      if (rejiggered) {
        setPlan(rejiggered);
        lastPlan.current = rejiggered;
        lastPlanOptions.current = planOptions;
        return () => {};
      }
    }
    lastPaths.current = paths;
    const worker = new Worker("background-planner.js");
    setIsPlanning(true);
    console.time("posting to worker");
    // FIXME: planOptions contains Set objects which get converted to empty objects {}
    // during structured cloning. Should use: { paths, planOptions: JSON.parse(serialize(planOptions)) }
    worker.postMessage({ paths, planOptions });
    console.timeEnd("posting to worker");
    const listener = (m: MessageEvent<TransferredMotion[]>) => {
      console.time("deserializing");
      const plan = Plan.fromTransferable(m.data);
      console.timeEnd("deserializing");
      setPlan(plan);
      lastPlan.current = plan;
      lastPlanOptions.current = planOptions;
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
  }, [paths, planOptions]);

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

function PenHeight({ state, driver }: { state: State; driver: BaseDriver }) {
  const { penUpHeight, penDownHeight, hardware, penLiftReversed } = state.planOptions;
  const dispatch = useContext(DispatchContext);
  const setPenUpHeight = (x: number) => dispatch({ type: "SET_PLAN_OPTION", value: { penUpHeight: x } });
  const setPenDownHeight = (x: number) => dispatch({ type: "SET_PLAN_OPTION", value: { penDownHeight: x } });
  const setPenLiftReversed = (x: boolean) => dispatch({ type: "SET_PLAN_OPTION", value: { penLiftReversed: x } });
  const device = Device(hardware, penLiftReversed);

  const penUp = () => {
    const height = device.penPctToPos(penUpHeight);
    driver.setPenHeight(height, 1000);
  };
  const penDown = () => {
    const height = device.penPctToPos(penDownHeight);
    driver.setPenHeight(height, 1000);
  };
  return (
    <Fragment>
      <div className="flex">
        <label className="pen-label">
          up height (%)
          <input
            type="number"
            min="0"
            max="100"
            value={penUpHeight}
            onChange={(e) => setPenUpHeight(parseInt(e.target.value, 10))}
          />
        </label>
        <label className="pen-label">
          down height (%)
          <input
            type="number"
            min="0"
            max="100"
            value={penDownHeight}
            onChange={(e) => setPenDownHeight(parseInt(e.target.value, 10))}
          />
        </label>
      </div>
      <div className="flex">
        <button type="button" onClick={penUp}>
          pen up
        </button>
        <button type="button" onClick={penDown}>
          pen down
        </button>
      </div>
      <label
        className="pp-checkbox"
        title="Tick this if pressing 'pen up' lowers the pen on your plotter. Common on AxiDraw-compatible clones."
      >
        <input type="checkbox" checked={penLiftReversed} onChange={(e) => setPenLiftReversed(e.target.checked)} />
        Reverse pen direction
      </label>
    </Fragment>
  );
}

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
    <div>
      <label title="Hardware model (affects servo and motor settings)">
        Hardware:
        <select
          value={currentHardware}
          onChange={(e) => handleHardwareChange(e.target.value as Hardware)}
          style={{ marginLeft: "8px" }}
          disabled={!driver}
        >
          <option value="v3">AxiDraw V3</option>
          <option value="brushless">AxiDraw V3 Brushless</option>
          <option value="nextdraw-2234">NextDraw 2234</option>
          <option value="idraw-h-se">iDraw H SE</option>
        </select>
      </label>
    </div>
  );
}

function VisualizationOptions({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);

  return (
    <>
      <label title="Width of lines in preview. Does not affect plot.">
        visualized stroke width (mm)
        <input
          type="number"
          value={state.visualizationOptions.penStrokeWidth}
          min="0"
          max="10"
          step="0.1"
          onChange={(e) =>
            dispatch({ type: "SET_VISUALIZATION_OPTION", value: { penStrokeWidth: Number(e.target.value) } })
          }
        />
      </label>
      <label
        className="flex-checkbox"
        title="Color paths in the preview based on the order in which they will be plotted. Yellow is first, pink is last."
      >
        <input
          type="checkbox"
          checked={state.visualizationOptions.colorPathsByStrokeOrder}
          onChange={(e) =>
            dispatch({ type: "SET_VISUALIZATION_OPTION", value: { colorPathsByStrokeOrder: !!e.target.checked } })
          }
        />
        color based on order
      </label>
    </>
  );
}

function OriginOptions({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  const device = Device(state.planOptions.hardware);
  return (
    <div className="flex">
      <label title="Starting and final position of pen when plotting (x)">
        home x (mm):
        <input
          type="number"
          min="0"
          max={state.planOptions.paperSize.size.x * device.stepsPerMm}
          step="10"
          value={state.planOptions.penHome.x}
          onChange={(e) =>
            dispatch({
              type: "SET_PLAN_OPTION",
              value: { penHome: { x: Number(e.target.value), y: state.planOptions.penHome.y } },
            })
          }
        />
      </label>
      <label title="Starting and final position of pen when plotting (y)">
        home y (mm):
        <input
          type="number"
          min="0"
          max={state.planOptions.paperSize.size.y * device.stepsPerMm}
          step="10"
          value={state.planOptions.penHome.y}
          onChange={(e) =>
            dispatch({
              type: "SET_PLAN_OPTION",
              value: { penHome: { x: state.planOptions.penHome.x, y: Number(e.target.value) } },
            })
          }
        />
      </label>
    </div>
  );
}

const MY_SIZE = "★ "; // marks the user's saved sizes in the paper list

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

function MotorControl({ driver }: { driver: BaseDriver }) {
  return (
    <div>
      <button type="button" onClick={() => driver.limp()}>
        disengage motors
      </button>
    </div>
  );
}

function PlanStatistics({ plan }: { plan: Plan | null }) {
  const totalDuration = useMemo(() => (plan ? plan.duration() : 0), [plan]);
  return (
    <div className="duration">
      <div>Duration</div>
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
      <div>Time remaining</div>
      <div>
        <strong>{formatDuration(duration - currentMotionTimeSpent)}</strong>
      </div>
    </div>
  );
}

function PlanLoader({ isLoadingFile, isPlanning }: { isLoadingFile: boolean; isPlanning: boolean }) {
  if (isLoadingFile || isPlanning) {
    return <div className="preview-loader">{isLoadingFile ? "Loading file..." : "Replanning..."}</div>;
  }

  return null;
}

function LayerSelector({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);

  const { layerMode } = state.planOptions;
  const layers = layerMode === "group" ? state.groupLayers : state.strokeLayers;
  if (layers.length <= 1) {
    return null;
  }

  const selectedLayers =
    layerMode === "group" ? state.planOptions.selectedGroupLayers : state.planOptions.selectedStrokeLayers;
  const layersChanged = (e: ChangeEvent<HTMLSelectElement>) => {
    const selectedLayers = new Set([...e.target.selectedOptions].map((o) => o.value));
    if (layerMode === "group") {
      dispatch({ type: "SET_PLAN_OPTION", value: { selectedGroupLayers: selectedLayers } });
    } else {
      dispatch({ type: "SET_PLAN_OPTION", value: { selectedStrokeLayers: selectedLayers } });
    }
  };
  return (
    <div>
      <label>
        layers
        <select
          className="layer-select"
          multiple={true}
          value={[...selectedLayers]}
          onChange={layersChanged}
          size={3}
          disabled={state.progress !== null}
        >
          {layers.map((layer) => (
            <option key={layer}>{layer}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PlotButtons({
  state,
  plan,
  isPlanning,
  driver,
}: {
  state: State;
  plan: Plan | null;
  isPlanning: boolean;
  driver: BaseDriver;
}) {
  function cancel() {
    driver.cancel();
  }
  function pause() {
    driver.pause();
  }
  function resume() {
    driver.resume();
  }
  function plot(plan: Plan) {
    driver.plot(plan);
  }

  return (
    <div>
      {isPlanning ? (
        <button type="button" disabled={true}>
          Replanning...
        </button>
      ) : (
        <button
          type="button"
          className={`plot-button ${state.progress !== null ? "plot-button--plotting" : ""}`}
          disabled={plan === null || state.progress !== null}
          onClick={() => plan && plot(plan)}
        >
          {plan && state.progress !== null ? "Plotting..." : "Plot"}
        </button>
      )}
      <div className={"button-row"}>
        <button
          type="button"
          className={`cancel-button ${state.progress !== null ? "cancel-button--active" : ""}`}
          onClick={state.paused ? resume : pause}
          disabled={plan === null || state.progress === null}
        >
          {state.paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          className={`cancel-button ${state.progress !== null ? "cancel-button--active" : ""}`}
          onClick={cancel}
          disabled={plan === null || state.progress === null}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ResetToDefaultsButton() {
  const dispatch = useContext(DispatchContext);
  const onClick = () => {
    // Clear all user settings that have been saved and reset to the defaults
    window.localStorage.removeItem("planOptions");
    dispatch({ type: "SET_PLAN_OPTION", value: { ...defaultPlanOptions } });
  };

  return (
    <button type="reset" className="button-link" onClick={onClick}>
      reset all options
    </button>
  );
}

function PlanConfig({ state }: { state: State }) {
  const dispatch = useContext(DispatchContext);
  return (
    <div>
      <form>
        <label className="flex-checkbox" title="Re-order paths to minimize pen-up travel time">
          <input
            type="checkbox"
            checked={state.planOptions.sortPaths}
            onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { sortPaths: !!e.target.checked } })}
          />
          sort paths
        </label>
        <label className="flex-checkbox" title="Split into layers according to group ID, instead of stroke">
          <input
            type="checkbox"
            checked={state.planOptions.layerMode === "group"}
            onChange={(e) =>
              dispatch({ type: "SET_PLAN_OPTION", value: { layerMode: e.target.checked ? "group" : "stroke" } })
            }
          />
          layer by group
        </label>
      </form>
      <div className="horizontal-labels">
        <label title="point-joining radius (mm)">
          <img src={pointJoinRadiusIcon} alt="point-joining radius (mm)" />
          <input
            type="number"
            value={state.planOptions.pointJoinRadius}
            step="0.1"
            min="0"
            onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { pointJoinRadius: Number(e.target.value) } })}
          />
        </label>
        <label title="path-joining radius (mm)">
          <img src={pathJoinRadiusIcon} alt="path-joining radius (mm)" />
          <input
            type="number"
            value={state.planOptions.pathJoinRadius}
            step="0.1"
            min="0"
            onChange={(e) => dispatch({ type: "SET_PLAN_OPTION", value: { pathJoinRadius: Number(e.target.value) } })}
          />
        </label>
      </div>
      <div>
        <label title="Remove paths that are shorter than this length (in mm)">
          minimum path length
          <input
            type="number"
            value={state.planOptions.minimumPathLength}
            step="0.1"
            min="0"
            onChange={(e) =>
              dispatch({ type: "SET_PLAN_OPTION", value: { minimumPathLength: Number(e.target.value) } })
            }
          />
        </label>
        <div className="flex">
          <label title="Acceleration when the pen is down (in mm/s^2)">
            down acc. (mm/s<sup>2</sup>)
            <input
              type="number"
              value={state.planOptions.penDownAcceleration}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penDownAcceleration: Number(e.target.value) } })
              }
            />
          </label>
          <label title="Maximum velocity when the pen is down (in mm/s)">
            down max vel. (mm/s)
            <input
              type="number"
              value={state.planOptions.penDownMaxVelocity}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penDownMaxVelocity: Number(e.target.value) } })
              }
            />
          </label>
        </div>
        <label>
          cornering factor
          <input
            type="number"
            value={state.planOptions.penDownCorneringFactor}
            step="0.01"
            min="0"
            onChange={(e) =>
              dispatch({ type: "SET_PLAN_OPTION", value: { penDownCorneringFactor: Number(e.target.value) } })
            }
          />
        </label>
        <div className="flex">
          <label title="Acceleration when the pen is up (in mm/s^2)">
            up acc. (mm/s<sup>2</sup>)
            <input
              type="number"
              value={state.planOptions.penUpAcceleration}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penUpAcceleration: Number(e.target.value) } })
              }
            />
          </label>
          <label title="Maximum velocity when the pen is up (in mm/s)">
            up max vel. (mm/s)
            <input
              type="number"
              value={state.planOptions.penUpMaxVelocity}
              step="0.1"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penUpMaxVelocity: Number(e.target.value) } })
              }
            />
          </label>
        </div>
        <div className="flex">
          <label title="How long the pen takes to lift (in seconds)">
            pen lift duration (s)
            <input
              type="number"
              value={state.planOptions.penLiftDuration}
              step="0.01"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penLiftDuration: Number(e.target.value) } })
              }
            />
          </label>
          <label title="How long the pen takes to drop (in seconds)">
            pen drop duration (s)
            <input
              type="number"
              value={state.planOptions.penDropDuration}
              step="0.01"
              min="0"
              onChange={(e) =>
                dispatch({ type: "SET_PLAN_OPTION", value: { penDropDuration: Number(e.target.value) } })
              }
            />
          </label>
        </div>
      </div>
    </div>
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
            alert(`Failed to connect to serial device: ${e.message}`);
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
  const { isPlanning, plan, setPlan } = usePlan(state.paths, plannerOptions);
  const [isLoadingFile, setIsLoadingFile] = useState(false);

  // Replan when drawings change, but not when one is merely selected.
  const pageItems = page.items;
  // biome-ignore lint/correctness/useExhaustiveDependencies(setPlan): React setters are stable
  useEffect(() => {
    if (pageItems.length === 0) {
      dispatch({ type: "CLEAR_PATHS" });
      setPlan(null);
    } else {
      dispatch(setPaths(plannerPaths({ items: pageItems, selectedId: null }, layout.placement, pageSize)));
    }
  }, [pageItems, layout.placement, pageSize]);

  // Frame: trace the drawing's outline with the pen up (see penpilot/frame.ts).
  const [framing, setFraming] = useState(false);
  const framingRef = useRef(false);
  const [frameLoop, setFrameLoop] = useState(false);
  const frameLoopRef = useRef(false);
  frameLoopRef.current = frameLoop;
  const frameBox = useMemo(
    () => drawingBoxOnMachine(page, layout.placement, pageSize, layout.drawable),
    [page, layout, pageSize],
  );
  const startFrame = () => {
    if (!driver || !frameBox) return;
    framingRef.current = true;
    setFraming(true);
    driver.plot(framePlan(frameBox, state.planOptions));
  };
  const startFrameRef = useRef(startFrame);
  startFrameRef.current = startFrame;
  const stopFrame = () => {
    frameLoopRef.current = false;
    setFrameLoop(false);
    driver?.cancel();
  };

  useEffect(() => {
    window.localStorage.setItem("planOptions", JSON.stringify(state.planOptions));
  }, [state.planOptions]);

  // biome-ignore lint/correctness/useExhaustiveDependencies(setPlan): React setters are stable
  useEffect(() => {
    if (driver === null) return;
    driver.onprogress = (motionIdx: number) => {
      if (!framingRef.current) dispatch({ type: "SET_PROGRESS", motionIdx });
    };
    driver.oncancelled = () => {
      framingRef.current = false;
      setFraming(false);
      dispatch({ type: "SET_PROGRESS", motionIdx: null });
    };
    driver.onfinished = () => {
      if (framingRef.current) {
        framingRef.current = false;
        setFraming(false);
        // "Keep going round": start the next lap once this one has finished.
        if (frameLoopRef.current) setTimeout(() => startFrameRef.current(), 0);
        return;
      }
      dispatch({ type: "SET_PROGRESS", motionIdx: null });
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

  // PenPilot: say plainly when a file can't be plotted, instead of leaving
  // "Loading file..." on screen (saxi's readSvg used to throw on non-SVG input).
  const [fileMessage, setFileMessage] = useState<string | null>(null);

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
      const item = newItem(name, paths, pageSize, marginMm);
      if (!item) {
        setFileMessage(`“${name}” has no lines for the pen to draw. It may contain only a picture.`);
        return;
      }
      setFileMessage(null);
      pageDispatch({ type: "add", items: [item] });
    },
    [pageSize, marginMm],
  );

  const handleFile = React.useCallback(
    (file: File) => {
      const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
      if (!isSvg) {
        setFileMessage(
          `“${file.name}” is a picture, not a drawing. For now PenPilot plots SVG drawings only. Turning photos into pen lines comes in a later build step.`,
        );
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
    [loadSvgText],
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
      const item = e.clipboardData?.items[0];
      if (item?.kind === "string") item.getAsString((s) => loadSvgText(s, "the pasted text"));
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

  const previewArea = useRef(null);
  const previewSize = useComponentSize(previewArea);
  const showDragTarget = page.items.length === 0 && !isLoadingFile;
  const locked = state.progress !== null || framing;
  const addFiles = (files: File[]) => {
    for (const f of files) handleFile(f);
  };

  return (
    <DispatchContext.Provider value={dispatch}>
      <div className={`root ${state.connected ? "connected" : "disconnected"}`}>
        <div className="control-panel">
          <div className={"saxi-title red"}>
            <span className="red reg">Pen</span>
            <span className="teal">Pilot</span>
          </div>
          <div className="pp-subtitle">based on saxi</div>
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
                busy={state.progress !== null}
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
          <div className="section-header">pen</div>
          <div className="section-body">
            <PenHeight state={state} driver={driver} />
            <MotorControl driver={driver} />
            <HardwareOptions state={state} driver={driver} />
            <ResetToDefaultsButton />
          </div>
          <div className="section-header">paper</div>
          <div className="section-body">
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
            <PaperConfig state={state} />
          </div>
          <div className="section-header">drawings</div>
          <div className="section-body">
            <DrawingsPanel
              page={page}
              pageDispatch={pageDispatch}
              pageSize={pageSize}
              marginMm={marginMm}
              drawable={layout.drawableOnPage}
              locked={locked}
              onAddFiles={addFiles}
            />
            <LayerSelector state={state} />
          </div>
          <details>
            <summary className="section-header">more</summary>
            <div className="section-body">
              <PlanConfig state={state} />
              <OriginOptions state={state} />
              <VisualizationOptions state={state} />
            </div>
          </details>
          <div className="spacer" />
          <div className="control-panel-bottom">
            <div className="section-header">plot</div>
            <div className="section-body section-body__plot">
              <PlanStatistics plan={plan} />
              <div className="pp-frame">
                <button
                  type="button"
                  disabled={framing ? false : !driver?.connected || !frameBox || state.progress !== null}
                  onClick={framing ? stopFrame : startFrame}
                  title="Move the lifted pen around the area the drawing will cover, to line up the paper"
                >
                  {framing ? "Stop frame" : "Frame"}
                </button>
                <label className="pp-checkbox pp-frame-loop" title="Keep going round until you press Stop frame">
                  <input type="checkbox" checked={frameLoop} onChange={(e) => setFrameLoop(e.target.checked)} />
                  keep going round
                </label>
              </div>
              <TimeLeft
                plan={plan}
                progress={state.progress}
                currentMotionStartedTime={currentMotionStartedTime}
                paused={state.paused}
              />
              <PlotButtons plan={plan} isPlanning={isPlanning} state={state} driver={driver} />
            </div>
          </div>
        </div>
        <div className="preview-area" ref={previewArea}>
          <PageCanvas
            page={page}
            pageDispatch={pageDispatch}
            pageSize={pageSize}
            marginMm={marginMm}
            placement={layout.placement}
            drawable={layout.drawableOnPage}
            plan={plan}
            stepsPerMm={Device(hardware).stepsPerMm}
            progress={framing ? null : state.progress}
            locked={locked}
            previewSize={{ width: Math.max(0, previewSize.width - 40), height: Math.max(0, previewSize.height - 40) }}
          />
          <PlanLoader isPlanning={isPlanning} isLoadingFile={isLoadingFile} />
          {fileMessage && (
            <div className="pp-file-message" role="alert">
              <span>{fileMessage}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setFileMessage(null)}>
                ×
              </button>
            </div>
          )}
          {showDragTarget && <DragTarget handleFile={handleFile} />}
        </div>
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
        <span>Drag SVG here or</span>
        <button type="button" onClick={() => fileInputRef.current.click()}>
          Upload SVG
        </button>{" "}
        {/* the input for the system file picker can't be styled, so hide it and use this button*/}
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          multiple
          style={{ display: "none" }}
          onChange={handleFileInputChange}
        />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
// biome-ignore lint/style/noNonNullAssertion: static element
createRoot(document.getElementById("app")!).render(<Root />);

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
    container.appendChild(document.importNode(svg, true));
    return flattenSVG(container.querySelector("svg"));
  } finally {
    container.remove();
  }
}
