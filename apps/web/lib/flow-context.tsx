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
import type { Submitted } from "./report-view-model";

const STORAGE_KEY = "jhv_flow";

export type AuthMode = "signin" | "create";

export interface FlowState {
  jobInput: string;
  company: string;
  site: string;
  recruiter: string;
  email: string;
  convo: string;
  signedIn: boolean;
  authEmail: string;
  authMode: AuthMode;
  fetchError: boolean;
}

const defaultState: FlowState = {
  jobInput: "",
  company: "",
  site: "",
  recruiter: "",
  email: "",
  convo: "",
  signedIn: false,
  authEmail: "",
  authMode: "signin",
  fetchError: false,
};

// Keys allowed to survive a reload (persisted to sessionStorage). Notably
// excludes authMode/fetchError (ephemeral UI state) and, always, any
// password field (which doesn't exist on FlowState at all).
const SURVIVABLE_KEYS = [
  "jobInput",
  "company",
  "site",
  "recruiter",
  "email",
  "convo",
  "signedIn",
  "authEmail",
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
  submitted: Submitted;
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

  const submitted = useMemo<Submitted>(() => {
    const out: Submitted = {};
    if (state.company) out.company = state.company;
    if (state.recruiter) out.recruiter = state.recruiter;
    if (state.email) out.email = state.email;
    if (state.site) out.contactChannel = state.site;
    return out;
  }, [state.company, state.recruiter, state.email, state.site]);

  const value = useMemo<FlowContextValue>(
    () => ({ state, set, reset, submitted }),
    [state, set, reset, submitted],
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
