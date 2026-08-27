import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdminHeader } from "../AdminHeader";

describe("AdminHeader", () => {
  it("marks the surface as Admin and offers skip + section anchors", () => {
    render(<AdminHeader />);
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to content/i })).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "#overview");
    expect(screen.getByRole("link", { name: "Feedback" })).toHaveAttribute("href", "#feedback");
  });
});
