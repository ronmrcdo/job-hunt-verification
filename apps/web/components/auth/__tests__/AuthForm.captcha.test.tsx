import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";

// Captcha-active scenario: NEXT_PUBLIC_TURNSTILE_SITE_KEY is set, so AuthForm
// renders the Turnstile widget and must pass its token into the Supabase auth
// calls. The widget is mocked as a "solve-captcha" button that emits a token
// via onSuccess when clicked, so a test can choose to solve it or not.
const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
const signUp = vi.fn().mockResolvedValue({ data: {}, error: null });
const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword, signUp, signInWithOAuth } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const TEST_TOKEN = "test-captcha-token";
vi.mock("@marsidev/react-turnstile", () => ({
  // Minimal stand-in: a button the test clicks to "solve" the challenge, which
  // fires onSuccess with a token — mirroring the real widget's callback.
  Turnstile: ({ onSuccess }: { onSuccess?: (token: string) => void }) => (
    <button type="button" onClick={() => onSuccess?.(TEST_TOKEN)}>
      solve-captcha
    </button>
  ),
}));

import { AuthForm } from "../AuthForm";
import { FlowProvider } from "../../../lib/flow-context";

function renderForm(ui: ReactElement, { jobInput = "Suspicious posting to check" } = {}) {
  window.sessionStorage.clear();
  if (jobInput) window.sessionStorage.setItem("jhv_flow", JSON.stringify({ jobInput }));
  return render(<FlowProvider>{ui}</FlowProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
});
afterEach(() => vi.unstubAllEnvs());

describe("AuthForm captcha", () => {
  it("passes the captcha token to signInWithPassword after the challenge is solved", async () => {
    renderForm(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "12345678");
    await userEvent.click(screen.getByRole("button", { name: /solve-captcha/i }));
    await userEvent.click(await screen.findByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "a@b.com",
      password: "12345678",
      options: { captchaToken: TEST_TOKEN },
    });
  });

  it("includes the captcha token in signUp options", async () => {
    renderForm(<AuthForm />);
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await userEvent.type(screen.getByLabelText(/full name/i), "Ada Lovelace");
    await userEvent.type(screen.getByLabelText(/email/i), "new@user.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "Abcdef12");
    await userEvent.type(screen.getByLabelText(/confirm password/i), "Abcdef12");
    await userEvent.click(screen.getByRole("button", { name: /solve-captcha/i }));
    await userEvent.click(await screen.findByRole("button", { name: /create account and run/i }));
    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@user.com",
        password: "Abcdef12",
        options: expect.objectContaining({
          data: { full_name: "Ada Lovelace" },
          captchaToken: TEST_TOKEN,
        }),
      }),
    );
  });

  it("blocks submit until the captcha is solved", async () => {
    renderForm(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/^password/i), "12345678");
    // Do NOT solve the captcha.
    await userEvent.click(await screen.findByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/verification/i)).toBeInTheDocument();
  });
});
