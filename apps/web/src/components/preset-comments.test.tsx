import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment } from "@/lib/api";
import PresetComments from "./preset-comments";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const apiMock = vi.hoisted(() => ({
  listComments: vi.fn(),
  postComment: vi.fn(),
  updateComment: vi.fn(),
  deleteComment: vi.fn(),
  reportContent: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/api")>();
  return { ...mod, ...apiMock };
});

const reply: Comment = {
  id: "c2",
  parentId: "c1",
  bodyMd: "thanks!",
  bodyHtml: "<p>thanks!</p>",
  createdAt: "2026-01-01T01:00:00Z",
  editedAt: null,
  deleted: false,
  author: { id: "u2", displayName: "Bob", verified: false },
  replies: [],
};

const top: Comment = {
  id: "c1",
  parentId: null,
  bodyMd: "love this",
  bodyHtml: "<p>love this</p>",
  createdAt: "2026-01-01T00:00:00Z",
  editedAt: null,
  deleted: false,
  author: { id: "u1", displayName: "Alice", verified: true },
  replies: [reply],
};

beforeEach(() => {
  apiMock.listComments.mockReset();
  apiMock.postComment.mockReset();
  apiMock.updateComment.mockReset();
  apiMock.deleteComment.mockReset();
  apiMock.reportContent.mockReset();
  apiMock.listComments.mockResolvedValue({ comments: [top], nextCursor: null, total: 1 });
});

function renderComments() {
  return render(<PresetComments presetId="preset_1" signedIn currentUserId="u1" />);
}

describe("PresetComments", () => {
  it("loads and renders threads with replies", async () => {
    renderComments();
    expect(await screen.findByText("love this")).toBeTruthy();
    expect(screen.getByText("thanks!")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText(/\(verified\)/)).toBeTruthy();
    expect(screen.getByText(/^Comments \(1\)$/)).toBeTruthy();
  });

  it("posts a top-level comment", async () => {
    const user = userEvent.setup();
    apiMock.postComment.mockResolvedValue({
      id: "c3",
      parentId: null,
      bodyMd: "Fresh take",
      bodyHtml: "<p>Fresh take</p>",
      createdAt: "2026-01-02T00:00:00Z",
      editedAt: null,
      deleted: false,
      author: { id: "u1", displayName: "Alice", verified: true },
      replies: [],
    });
    renderComments();
    await screen.findByText("love this");

    await user.type(screen.getByLabelText("Write a comment"), "Fresh take");
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await screen.findByText("Fresh take");
    expect(apiMock.postComment).toHaveBeenCalledWith("preset_1", "Fresh take");
    expect(screen.getByText(/^Comments \(2\)$/)).toBeTruthy();
  });

  it("replies to a top-level comment", async () => {
    const user = userEvent.setup();
    apiMock.postComment.mockResolvedValue({
      id: "c4",
      parentId: "c1",
      bodyMd: "Nice work",
      bodyHtml: "<p>Nice work</p>",
      createdAt: "2026-01-02T00:00:00Z",
      editedAt: null,
      deleted: false,
      author: { id: "u1", displayName: "Alice", verified: true },
      replies: [],
    });
    renderComments();
    await screen.findByText("love this");

    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await user.type(screen.getByLabelText("Write a reply"), "Nice work");
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));

    await screen.findByText("Nice work");
    expect(apiMock.postComment).toHaveBeenCalledWith("preset_1", "Nice work", "c1");
  });

  it("edits and deletes your own comment", async () => {
    const user = userEvent.setup();
    apiMock.updateComment.mockResolvedValue({
      ...top,
      bodyMd: "updated version",
      bodyHtml: "<p>updated version</p>",
      editedAt: "2026-01-02T00:00:00Z",
    });
    apiMock.deleteComment.mockResolvedValue(undefined);
    renderComments();
    await screen.findByText("love this");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Edit comment"));
    await user.type(screen.getByLabelText("Edit comment"), "updated version");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("updated version");
    expect(apiMock.updateComment).toHaveBeenCalledWith("c1", "updated version");
    expect(screen.getByText(/edited$/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("[comment deleted]");
    expect(apiMock.deleteComment).toHaveBeenCalledWith("c1");
  });

  it("reports someone else's comment", async () => {
    const user = userEvent.setup();
    apiMock.reportContent.mockResolvedValue({ report: { id: "r1", status: "open" } });
    renderComments();
    await screen.findByText("thanks!");

    fireEvent.click(screen.getByText("Report"));
    await user.type(screen.getByLabelText("Report reason"), "Spammy link content here");
    fireEvent.click(screen.getByRole("button", { name: "Submit report" }));

    await screen.findByText("Reported");
    expect(apiMock.reportContent).toHaveBeenCalledWith({
      targetType: "comment",
      targetId: "c2",
      reason: "Spammy link content here",
    });
  });
});