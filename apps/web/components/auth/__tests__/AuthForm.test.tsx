import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AuthForm } from "../AuthForm";

function fillFields(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: password } });
}

describe("AuthForm", () => {
  it("shows the validation panel and does not call onSuccess when the password is too short", () => {
    const onSuccess = vi.fn();
    render(<AuthForm onSuccess={onSuccess} />);

    fillFields("a@b.com", "1234");
    fireEvent.click(screen.getByRole("button", { name: "SIGN IN AND RUN THE CHECK" }));

    expect(
      screen.getByText("Enter an email and a password of at least 8 characters to continue."),
    ).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("calls onSuccess with the email on a valid submit", () => {
    const onSuccess = vi.fn();
    render(<AuthForm onSuccess={onSuccess} />);

    fillFields("a@b.com", "longenough1");
    fireEvent.click(screen.getByRole("button", { name: "SIGN IN AND RUN THE CHECK" }));

    expect(onSuccess).toHaveBeenCalledWith("a@b.com", "signin");
  });

  it("switches the CTA to CREATE ACCOUNT AND RUN THE CHECK when toggled to Create account", () => {
    render(<AuthForm onSuccess={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.getByRole("button", { name: "CREATE ACCOUNT AND RUN THE CHECK" })).toBeTruthy();
  });

  it("calls onSuccess with mode 'create' after toggling to Create account and submitting valid fields", () => {
    const onSuccess = vi.fn();
    render(<AuthForm onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fillFields("new@b.com", "longenough1");
    fireEvent.click(screen.getByRole("button", { name: "CREATE ACCOUNT AND RUN THE CHECK" }));

    expect(onSuccess).toHaveBeenCalledWith("new@b.com", "create");
  });
});
