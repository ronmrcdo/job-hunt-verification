import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
const signUp = vi.fn().mockResolvedValue({ data: {}, error: null });
const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword, signUp, signInWithOAuth } }),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { AuthForm } from "../AuthForm";
import { FlowProvider } from "../../../lib/flow-context";

// Seed the pre-auth draft so the "…AND RUN THE CHECK" CTA copy is present.
// FlowProvider hydrates jobInput from sessionStorage on mount, so async
// (findBy*) queries are used wherever the queued label matters.
function renderForm(ui: ReactElement, { jobInput = "Suspicious posting to check" } = {}) {
  window.sessionStorage.clear();
  if (jobInput) {
    window.sessionStorage.setItem("jhv_flow", JSON.stringify({ jobInput }));
  }
  return render(<FlowProvider>{ui}</FlowProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe("AuthForm", () => {
  it("blocks submit and shows a message when password < 8 chars", async () => {
    renderForm(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "short");
    await userEvent.click(await screen.findByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("calls signInWithPassword with valid credentials", async () => {
    renderForm(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "12345678");
    await userEvent.click(await screen.findByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a@b.com", password: "12345678" });
  });

  it("shows the auth error message when Supabase rejects", async () => {
    signInWithPassword.mockResolvedValueOnce({
      data: {},
      error: { message: "Invalid login credentials" },
    });
    renderForm(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "12345678");
    await userEvent.click(await screen.findByRole("button", { name: /sign in and run/i }));
    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
  });

  it("create mode collects full name + a confirmed, complex password and passes them to signUp", async () => {
    renderForm(<AuthForm />);
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await userEvent.type(screen.getByLabelText(/full name/i), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText(/email/i), "new@user.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "Abcdef12");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "Abcdef12");
    await userEvent.click(await screen.findByRole("button", { name: /create account and run/i }));

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@user.com",
        password: "Abcdef12",
        options: expect.objectContaining({
          data: { full_name: "Ada Lovelace" },
        }),
      }),
    );
    expect(await screen.findByText(/confirm your email/i)).toBeInTheDocument();
    expect(screen.getByText("new@user.com")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^password/i)).toBeNull();
  });

  it("blocks create when the password fails complexity or the confirmation mismatches", async () => {
    renderForm(<AuthForm />);
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await userEvent.type(screen.getByLabelText(/full name/i), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText(/email/i), "new@user.com");
    // No uppercase, no number → fails complexity.
    await userEvent.type(screen.getByLabelText(/^password/i), "abcdefgh");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "abcdefgh");
    await userEvent.click(await screen.findByRole("button", { name: /create account and run/i }));
    expect(signUp).not.toHaveBeenCalled();
    expect(screen.getByText(/password needs/i)).toBeInTheDocument();
  });

  it("drops the '…and run the check' copy when nothing is queued", async () => {
    // The tab controls share text with the plain CTAs, so target the submit
    // button by type rather than by accessible name.
    const { container } = renderForm(<AuthForm />, { jobInput: "" });
    const submit = () => container.querySelector('button[type="submit"]');
    expect(submit()).toHaveTextContent(/^sign in$/i);
    expect(submit()).not.toHaveTextContent(/run the check/i);
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(submit()).toHaveTextContent(/^create account$/i);
    expect(submit()).not.toHaveTextContent(/run the check/i);
  });

  it("triggers Google OAuth from the Google button", async () => {
    renderForm(<AuthForm />);
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });
});
