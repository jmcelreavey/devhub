/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { JiraStep } from "@/app/setup/steps";

const form = { domain: "example.atlassian.net", email: "dev@example.com", apiToken: "" };

describe("JiraStep", () => {
  it("still shows email and token fields when credentials are already saved", () => {
    render(
      <JiraStep
        form={form}
        setForm={vi.fn()}
        showSecrets={{}}
        toggleSecret={vi.fn()}
        configured
        checking={false}
        onCheckConnection={vi.fn()}
        error=""
      />,
    );

    expect(screen.getByText("Jira credentials saved")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("Replace API token")).toBeTruthy();
    expect(screen.getByPlaceholderText(/paste a new token to replace/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check connection" })).toBeTruthy();
  });

  it("shows first-run labels when nothing is saved yet", () => {
    render(
      <JiraStep
        form={{ domain: "", email: "", apiToken: "" }}
        setForm={vi.fn()}
        showSecrets={{}}
        toggleSecret={vi.fn()}
        configured={false}
        checking={false}
        onCheckConnection={vi.fn()}
        error=""
      />,
    );

    expect(screen.getByText("Jira is not connected yet")).toBeTruthy();
    expect(screen.getByText("API Token")).toBeTruthy();
    expect(screen.queryByText("Replace API token")).toBeNull();
  });

  it("surfaces a check-connection failure", () => {
    render(
      <JiraStep
        form={form}
        setForm={vi.fn()}
        showSecrets={{}}
        toggleSecret={vi.fn()}
        configured
        checking={false}
        onCheckConnection={vi.fn()}
        error="Jira authentication failed (HTTP 401). Mint a new API token and paste it above."
      />,
    );

    expect(screen.getByText(/HTTP 401/)).toBeTruthy();
  });

  it("surfaces a check-connection success", () => {
    render(
      <JiraStep
        form={form}
        setForm={vi.fn()}
        showSecrets={{}}
        toggleSecret={vi.fn()}
        configured
        checking={false}
        onCheckConnection={vi.fn()}
        error=""
        checkOk="Connected to Jira successfully."
      />,
    );

    expect(screen.getByText("Connected to Jira successfully.")).toBeTruthy();
  });

  it("reveal control calls toggle without requiring a form submit", () => {
    const toggleSecret = vi.fn();
    render(
      <JiraStep
        form={{ ...form, apiToken: "typed-token" }}
        setForm={vi.fn()}
        showSecrets={{}}
        toggleSecret={toggleSecret}
        configured
        checking={false}
        onCheckConnection={vi.fn()}
        error=""
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show Replace API token" }));
    expect(toggleSecret).toHaveBeenCalledWith("jira-token");
    expect(screen.getByDisplayValue("typed-token")).toBeTruthy();
  });
});
