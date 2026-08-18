import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FlowProvider, useFlow } from "../flow-context";

const STORAGE_KEY = "jhv_flow";

function Probe() {
  const { state, set, reset, submitted } = useFlow();
  return (
    <div>
      <div data-testid="jobInput">{state.jobInput}</div>
      <div data-testid="submitted">{JSON.stringify(submitted)}</div>
      <button onClick={() => set({ jobInput: "x" })}>set</button>
      <button
        onClick={() =>
          set({ company: "Acme", email: "a@b.com", recruiter: "Jane", site: "https://acme.com" })
        }
      >
        setSubmittedFields
      </button>
      <button onClick={() => reset()}>reset</button>
    </div>
  );
}

function renderProbe() {
  return render(
    <FlowProvider>
      <Probe />
    </FlowProvider>,
  );
}

describe("FlowProvider / useFlow", () => {
  it("set() merges into state and persists the survivable subset to sessionStorage", () => {
    renderProbe();
    fireEvent.click(screen.getByText("set"));

    expect(screen.getByTestId("jobInput")).toHaveTextContent("x");

    const stored = sessionStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();
    expect(stored).toContain("x");
    const parsed = JSON.parse(stored as string);
    expect(parsed.jobInput).toBe("x");
  });

  it("reset() clears state back to defaults and removes the sessionStorage key", () => {
    renderProbe();
    fireEvent.click(screen.getByText("set"));
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    fireEvent.click(screen.getByText("reset"));

    expect(screen.getByTestId("jobInput")).toHaveTextContent("");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("never persists a password: the persisted blob has no password-shaped key", () => {
    renderProbe();
    fireEvent.click(screen.getByText("set"));

    const stored = sessionStorage.getItem(STORAGE_KEY) as string;
    const parsed = JSON.parse(stored);

    expect(parsed).not.toHaveProperty("authPass");
    expect(parsed).not.toHaveProperty("password");
    expect(Object.keys(parsed).some((k) => /pass/i.test(k))).toBe(false);
  });

  it("submitted maps company/recruiter/email but leaves contactChannel unmapped (site is a URL, not a channel)", () => {
    renderProbe();
    fireEvent.click(screen.getByText("setSubmittedFields"));

    const submitted = JSON.parse(screen.getByTestId("submitted").textContent as string);

    expect(submitted).toEqual({
      company: "Acme",
      email: "a@b.com",
      recruiter: "Jane",
    });
    expect(submitted).not.toHaveProperty("contactChannel");
    expect(submitted).not.toHaveProperty("jobTitle");
  });
});
