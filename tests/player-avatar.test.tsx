// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PlayerAvatar } from "@/components/app/PlayerAvatar";
import { validateAvatarInput } from "@/lib/avatarImage";

afterEach(cleanup);

describe("player avatar", () => {
  it("falls back for a missing image, then retries a changed source", () => {
    const props = { imageClassName: "avatar-image", fallbackClassName: "avatar-fallback" };
    const view = render(<PlayerAvatar {...props} src="https://example.com/old.png" />);
    const img = view.container.querySelector("img")!;
    fireEvent.error(img);
    expect(view.container.querySelector("img")).toBeNull();
    expect(view.container.querySelector(".avatar-fallback")).not.toBeNull();
    view.rerender(<PlayerAvatar {...props} src="https://example.com/new.png" />);
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe("https://example.com/new.png");
  });

  it("uses a fallback when no avatar is saved", () => {
    const view = render(<PlayerAvatar src={null} imageClassName="avatar-image" fallbackClassName="avatar-fallback" />);
    expect(view.container.querySelector(".avatar-fallback")).not.toBeNull();
  });

  it("rejects unsupported files, empty images and oversized input", () => {
    expect(() => validateAvatarInput({ type: "image/svg+xml", size: 100 })).toThrow();
    expect(() => validateAvatarInput({ type: "image/png", size: 0 })).toThrow();
    expect(() => validateAvatarInput({ type: "image/jpeg", size: 12 * 1024 * 1024 + 1 })).toThrow();
    expect(() => validateAvatarInput({ type: "image/heic", size: 100 })).not.toThrow();
    expect(() => validateAvatarInput({ type: "image/png", size: 100 })).not.toThrow();
  });
});
