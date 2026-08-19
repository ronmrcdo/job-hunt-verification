"use client";

// Cross-route flow state: the pasted posting + auth details that need to
// survive navigation between the paste screen, the sign-in gate, and the
// report. Persisted (survivable subset only) to sessionStorage so a page
// reload / route change during the flow doesn't lose the user's input.
//
// SECURITY: there is no password field here. The password the user types
// on the auth screen lives in that screen's own local state and is never
// read into, or persisted by, this context.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "jhv_flow";

// Pre-auth draft only: the pasted posting + optional details a visitor fills
// in before signing in. Auth state (signedIn/authEmail/authMode) and
// fetchError (ephemeral scan-field UI state) no longer live here — auth is
// now driven by Supabase session, not flow state.
export interface FlowState {
  jobInput: string;
  company: string;
  site: string;
  recruiter: string;
  email: string;
  convo: string;
}

const defaultState: FlowState = {
  jobInput: "",
  company: "",
  site: "",
  recruiter: "",
  email: "",
  convo: "",
};

// Keys allowed to survive a reload (persisted to sessionStorage), and,
// always, any password field (which doesn't exist on FlowState at all).
const SURVIVABLE_KEYS = [
  "jobInput",
  "company",
  "site",
  "recruiter",
  "email",
  "convo",
] as const satisfies readonly (keyof FlowState)[];

type SurvivableState = Pick<FlowState, (typeof SURVIVABLE_KEYS)[number]>;

function pickSurvivable(state: FlowState): SurvivableState {
  const out = {} as SurvivableState;
  for (const key of SURVIVABLE_KEYS) {
    out[key] = state[key] as never;
  }
  return out;
}

function persist(state: FlowState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pickSurvivable(state)));
  } catch {
    // storage unavailable (private mode, quota, etc.) — non-fatal
  }
}

function readPersisted(): Partial<FlowState> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<FlowState>;
  } catch {
    return null;
  }
}

function clearPersisted() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface FlowContextValue {
  state: FlowState;
  set: (patch: Partial<FlowState>) => void;
  reset: () => void;
}

const FlowContext = createContext<FlowContextValue | null>(null);

export function FlowProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FlowState>(defaultState);

  // SSR-safe hydration: read sessionStorage only after mount, never during
  // the initial render (which must match the server-rendered markup).
  useEffect(() => {
    const persisted = readPersisted();
    if (persisted) {
      setState((prev) => ({ ...prev, ...persisted }));
    }
    // Only run once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = useCallback((patch: Partial<FlowState>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      persist(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    clearPersisted();
    setState(defaultState);
  }, []);

  const value = useMemo<FlowContextValue>(
    () => ({ state, set, reset }),
    [state, set, reset],
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const ctx = useContext(FlowContext);
  if (!ctx) {
    throw new Error("useFlow must be used within a FlowProvider");
  }
  return ctx;
}

// Non-throwing variant for components (e.g. NewCheckForm) that opportunistically
// read the draft when a FlowProvider happens to be mounted above them, but must
// still render standalone (e.g. in unit tests, or outside the app shell).
export function useFlowOptional(): FlowContextValue | null {
  return useContext(FlowContext);
}
