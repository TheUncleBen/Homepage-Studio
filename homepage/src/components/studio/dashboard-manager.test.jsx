// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deploymentRequest } from "./api.mjs";
import DashboardManager from "./dashboard-manager";
import { EditorDraftContext } from "./draft-guard";

vi.mock("./api.mjs", () => ({ deploymentRequest: vi.fn() }));
const original = {
  version: 1,
  revision: "revision-one",
  dashboards: [
    { id: "default", name: "Main", slug: "", archived: false },
    { id: "family-id", name: "Family", slug: "family", archived: false },
    { id: "archived-id", name: "Previous family", slug: "family-copy", archived: true },
  ],
};
function answer(action, entry, revision = "revision-two") {
  const dashboards = original.dashboards.filter((item) => item.id !== entry.id);
  dashboards.push(entry);
  return { registry: { ...original, revision, dashboards }, dashboard: entry };
}
async function mount(extra = {}) {
  const report = vi.fn();
  const onNavigate = vi.fn();
  const props = { onClose: vi.fn(), onNavigate, ...extra };
  render(
    <EditorDraftContext.Provider value={report}>
      <DashboardManager {...props} />
    </EditorDraftContext.Provider>,
  );
  await screen.findByRole("region", { name: "Dashboard Main" });
  return { report, ...props };
}
beforeEach(() => {
  deploymentRequest.mockReset().mockResolvedValueOnce(structuredClone(original));
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("Independent dashboard manager", () => {
  it("creates empty dashboards and duplicates a source without reusing a reserved archived slug", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard", exact: true }));
    expect(screen.getByLabelText("Dashboard name")).toHaveFocus();
    expect(screen.getByLabelText("Starting configuration")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Dashboard name"), { target: { value: "Guest" } });
    fireEvent.change(screen.getByLabelText("Address slug"), { target: { value: "-guest" } });
    expect(screen.getByLabelText("Address slug")).toBeInvalid();
    fireEvent.change(screen.getByLabelText("Address slug"), { target: { value: "guest-" } });
    expect(screen.getByLabelText("Address slug")).toBeInvalid();
    fireEvent.change(screen.getByLabelText("Address slug"), { target: { value: "guest--family" } });
    expect(screen.getByLabelText("Address slug")).toBeValid();
    deploymentRequest.mockResolvedValueOnce(
      answer("create", { id: "guest-id", name: "Guest", slug: "guest--family", archived: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard", exact: true }));
    await screen.findByRole("region", { name: "Dashboard Guest" });
    expect(deploymentRequest).toHaveBeenLastCalledWith("/__studio/api/dashboards", {
      action: "create",
      revision: "revision-one",
      name: "Guest",
      slug: "guest--family",
    });
    fireEvent.click(screen.getByRole("button", { name: "Duplicate Family", exact: true }));
    expect(screen.getByLabelText("Starting configuration")).toHaveValue("family-id");
    expect(screen.getByLabelText("Address slug")).toHaveValue("family-copy-2");
    deploymentRequest.mockResolvedValueOnce(
      answer("create", { id: "copy-id", name: "Family copy", slug: "family-copy-2", archived: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard", exact: true }));
    await screen.findByRole("region", { name: "Dashboard Family copy" });
    expect(deploymentRequest).toHaveBeenLastCalledWith("/__studio/api/dashboards", {
      action: "create",
      revision: "revision-two",
      name: "Family copy",
      slug: "family-copy-2",
      sourceId: "family-id",
    });
  });

  it("reports dirty and pending state, protects back navigation and serializes each write once", async () => {
    const { report } = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit Family", exact: true }));
    fireEvent.change(screen.getByLabelText("Dashboard name"), { target: { value: "Family draft" } });
    expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: false });
    fireEvent.click(screen.getByRole("button", { name: "Back to dashboards" }));
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Discard dashboard draft" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Dashboard name")).toHaveValue("Family draft");
    let resolve;
    deploymentRequest.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const save = screen.getByRole("button", { name: "Save dashboard" });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(deploymentRequest).toHaveBeenCalledTimes(2);
    expect(report).toHaveBeenLastCalledWith({ dirty: true, pending: true });
    expect(screen.getByLabelText("Dashboard name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Close", exact: true })).toBeDisabled();
    await act(async () => resolve(answer("update", { ...original.dashboards[1], name: "Family draft" })));
    await screen.findByRole("region", { name: "Dashboard Family draft" });
    expect(report).toHaveBeenLastCalledWith({ dirty: false, pending: false });
  });

  it("retains a conflicting draft until an explicit latest-list review and uses that revision on retry", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit Family", exact: true }));
    fireEvent.change(screen.getByLabelText("Dashboard name"), { target: { value: "My retained draft" } });
    deploymentRequest.mockRejectedValueOnce(Object.assign(new Error("The registry changed"), { status: 409 }));
    fireEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Dashboard name")).toHaveValue("My retained draft");
    expect(screen.getByRole("button", { name: "Save dashboard" })).toBeDisabled();
    expect(deploymentRequest).toHaveBeenCalledTimes(2);
    const latest = {
      ...original,
      revision: "revision-latest",
      dashboards: original.dashboards.map((item) =>
        item.id === "family-id" ? { ...item, name: "Externally changed" } : item,
      ),
    };
    deploymentRequest.mockResolvedValueOnce(latest);
    fireEvent.click(screen.getByRole("button", { name: "Review latest dashboard list" }));
    await screen.findByText(/Currently saved: Externally changed/);
    expect(screen.getByLabelText("Dashboard name")).toHaveValue("My retained draft");
    expect(deploymentRequest).toHaveBeenCalledTimes(3);
    deploymentRequest.mockResolvedValueOnce(answer("update", { ...original.dashboards[1], name: "My retained draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
    await screen.findByRole("region", { name: "Dashboard My retained draft" });
    expect(deploymentRequest).toHaveBeenLastCalledWith("/__studio/api/dashboards", {
      action: "update",
      revision: "revision-latest",
      id: "family-id",
      name: "My retained draft",
      slug: "family",
    });
  });

  it("requires archive confirmation, preserves root, and offers explicit restoration", async () => {
    await mount();
    expect(
      within(screen.getByRole("region", { name: "Dashboard Main" })).queryByRole("button", { name: /Archive/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Archive Family", exact: true }));
    expect(screen.getByRole("button", { name: "Archive dashboard", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("I want to archive this dashboard"));
    deploymentRequest.mockResolvedValueOnce(answer("archive", { ...original.dashboards[1], archived: true }));
    fireEvent.click(screen.getByRole("button", { name: "Archive dashboard", exact: true }));
    await screen.findByRole("region", { name: "Archived dashboard Family", exact: true });
    expect(deploymentRequest).toHaveBeenLastCalledWith("/__studio/api/dashboards", {
      action: "archive",
      revision: "revision-one",
      id: "family-id",
      confirmed: true,
    });
    deploymentRequest.mockResolvedValueOnce(answer("restore", original.dashboards[1], "revision-three"));
    fireEvent.click(screen.getByRole("button", { name: "Restore Family", exact: true }));
    await screen.findByRole("region", { name: "Dashboard Family", exact: true });
    expect(deploymentRequest).toHaveBeenLastCalledWith("/__studio/api/dashboards", {
      action: "restore",
      revision: "revision-two",
      id: "family-id",
    });
  });

  it("uses explicit navigation for opening pages, changing the current address and archiving the current page", async () => {
    const { onNavigate } = await mount({ currentDashboard: { id: "family-id", basePath: "/family" } });
    fireEvent.click(screen.getByRole("button", { name: "Open Main", exact: true }));
    expect(onNavigate).toHaveBeenCalledWith("/");
    fireEvent.click(screen.getByRole("button", { name: "Edit Family", exact: true }));
    fireEvent.change(screen.getByLabelText("Address slug"), { target: { value: "shared" } });
    deploymentRequest.mockResolvedValueOnce(answer("update", { ...original.dashboards[1], slug: "shared" }));
    fireEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith("/shared"));
    expect(deploymentRequest).toHaveBeenLastCalledWith("/__studio/api/dashboards", {
      action: "update",
      revision: "revision-one",
      id: "family-id",
      name: "Family",
      slug: "shared",
    });
    fireEvent.click(screen.getByRole("button", { name: "Archive Family", exact: true }));
    fireEvent.click(screen.getByLabelText("I want to archive this dashboard"));
    deploymentRequest.mockResolvedValueOnce(
      answer("archive", { ...original.dashboards[1], slug: "shared", archived: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive dashboard", exact: true }));
    await waitFor(() => expect(onNavigate).toHaveBeenLastCalledWith("/"));
  });
});

describe("Address slug validation", () => {
  it("says inline what is wrong with the slug, linked to the field, instead of the browser bubble", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard", exact: true }));
    const slug = screen.getByLabelText("Address slug");
    expect(slug).toHaveAccessibleDescription(/^Lowercase letters, numbers and hyphens\./);
    expect(slug).not.toHaveAttribute("aria-invalid");
    fireEvent.change(screen.getByLabelText("Dashboard name"), { target: { value: "Family Board" } });
    fireEvent.change(slug, { target: { value: "Family Board" } });
    // Typing alone does not interrupt; a submit attempt reports the problem.
    expect(screen.queryByText(/capital letters are not allowed/)).not.toBeInTheDocument();
    const bubble = vi.fn();
    slug.addEventListener("invalid", (event) => bubble(event.defaultPrevented));
    fireEvent.click(screen.getByRole("button", { name: "Create dashboard", exact: true }));
    expect(bubble).toHaveBeenCalledWith(true);
    expect(deploymentRequest).toHaveBeenCalledTimes(1);
    expect(slug).toHaveFocus();
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(slug).toHaveAccessibleDescription(
      /^Use lowercase letters only; capital letters are not allowed\. Lowercase letters/,
    );
    fireEvent.change(slug, { target: { value: "family board" } });
    expect(slug).toHaveAccessibleDescription(/^Replace spaces with hyphens/);
    fireEvent.change(slug, { target: { value: "family/board" } });
    expect(slug).toHaveAccessibleDescription(/^Remove the slashes/);
    fireEvent.change(slug, { target: { value: "family-" } });
    expect(slug).toHaveAccessibleDescription(/^Start and end the slug with a letter or number/);
    fireEvent.change(slug, { target: { value: "" } });
    expect(slug).toHaveAccessibleDescription(/^Enter an address slug/);
    fireEvent.change(slug, { target: { value: "family-board" } });
    expect(slug).not.toHaveAttribute("aria-invalid");
    expect(slug).toHaveAccessibleDescription(/^Lowercase letters, numbers and hyphens\./);
    expect(screen.queryByText(/capital letters|Replace spaces|Enter an address slug/)).not.toBeInTheDocument();
  });

  it("checks the slug when the field is left, allows an empty main address and keeps server errors", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Edit Main", exact: true }));
    const slug = screen.getByLabelText("Address slug");
    fireEvent.blur(slug);
    expect(slug).not.toHaveAttribute("aria-invalid");
    fireEvent.change(slug, { target: { value: "-main" } });
    expect(slug).toHaveAttribute("aria-invalid", "true");
    expect(slug).toHaveAccessibleDescription(/^Start and end the slug/);
    fireEvent.change(slug, { target: { value: "family" } });
    deploymentRequest.mockRejectedValueOnce(Object.assign(new Error("The address /family is in use."), { status: 400 }));
    fireEvent.click(screen.getByRole("button", { name: "Save dashboard" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The address /family is in use.");
    expect(slug).not.toHaveAttribute("aria-invalid");
  });
});
