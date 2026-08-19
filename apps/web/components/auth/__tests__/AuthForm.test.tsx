import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null });
const signUp = vi.fn().mockResolvedValue({ data: {}, error: null });
const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });
vi.mock("../../../lib/supabase/client", () => ({
  createClient: () => ({ auth: { signInWithPassword, signUp, signInWithOAuth } }),
}));
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { AuthForm } from "../AuthForm";

beforeEach(() => vi.clearAllMocks());

describe("AuthForm", () => {
  it("blocks submit and shows a message when password < 8 chars", async () => {
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "short");
    await userEvent.click(screen.getByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
  });

  it("calls signInWithPassword with valid credentials", async () => {
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "12345678");
    await userEvent.click(screen.getByRole("button", { name: /sign in and run/i }));
    expect(signInWithPassword).toHaveBeenCalledWith({ email: "a@b.com", password: "12345678" });
  });

  it("shows the auth error message when Supabase rejects", async () => {
    signInWithPassword.mockResolvedValueOnce({ data: {}, error: { message: "Invalid login credentials" } });
    render(<AuthForm />);
    await userEvent.type(screen.getByLabelText(/email/i), "a@b.com");
    await userEvent.type(screen.getByLabelText(/password/i), "12345678");
    await userEvent.click(screen.getByRole("button", { name: /sign in and run/i }));
    expect(await screen.findByText(/invalid login credentials/i)).toBeInTheDocument();
  });

  it("triggers Google OAuth from the Google button", async () => {
    render(<AuthForm />);
    await userEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "google" }),
    );
  });
});
