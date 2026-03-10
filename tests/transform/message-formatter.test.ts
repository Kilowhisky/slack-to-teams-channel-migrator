import { describe, it, expect } from "vitest";
import {
  formatMessageForMigration,
  type UserMapping,
} from "../../src/transform/message-formatter";
import type { NormalizedSlackMessage } from "../../src/state/types";

const userMapping: UserMapping = {
  aadIds: new Map([["U001", "aad-guid-001"]]),
  displayNames: new Map([
    ["U001", "Alice"],
    ["U002", "Bob"],
  ]),
};

function makeMessage(
  overrides: Partial<NormalizedSlackMessage> = {}
): NormalizedSlackMessage {
  return {
    ts: "1705432800.000100",
    user: "U001",
    text: "Hello world",
    isThreadParent: false,
    ...overrides,
  };
}

describe("formatMessageForMigration", () => {
  it("sets createdDateTime from slack ts", () => {
    const msg = makeMessage();
    const result = formatMessageForMigration(msg, { userMapping });

    expect(result.createdDateTime).toBe(
      new Date(1705432800.0001 * 1000).toISOString()
    );
  });

  it("sets from user with AAD ID when available", () => {
    const msg = makeMessage({ user: "U001" });
    const result = formatMessageForMigration(msg, { userMapping });

    expect(result.from?.user.id).toBe("aad-guid-001");
    expect(result.from?.user.displayName).toBe("Alice");
    expect(result.from?.user.userIdentityType).toBe("aadUser");
  });

  it("sets from user as anonymous when no AAD mapping", () => {
    const msg = makeMessage({ user: "U002" });
    const result = formatMessageForMigration(msg, { userMapping });

    expect(result.from?.user.id).toBeUndefined();
    expect(result.from?.user.displayName).toBe("Bob");
    expect(result.from?.user.userIdentityType).toBe("anonymousGuest");
  });

  it("converts message text to HTML", () => {
    const msg = makeMessage({ text: "*bold* and _italic_" });
    const result = formatMessageForMigration(msg, { userMapping });

    expect(result.body.contentType).toBe("html");
    expect(result.body.content).toContain("<b>bold</b>");
    expect(result.body.content).toContain("<i>italic</i>");
  });

  it("appends reactions as text", () => {
    const msg = makeMessage({
      reactions: [
        { name: "thumbsup", count: 3, users: [] },
        { name: "heart", count: 1, users: [] },
      ],
    });
    const result = formatMessageForMigration(msg, { userMapping });

    expect(result.body.content).toContain("Reactions:");
    expect(result.body.content).toContain(":thumbsup: 3");
    expect(result.body.content).toContain(":heart: 1");
  });

  it("handles channel_join subtype", () => {
    const msg = makeMessage({ subtype: "channel_join" });
    const result = formatMessageForMigration(msg, { userMapping });

    expect(result.body.content).toContain("Alice joined the channel");
  });

  it("handles channel_leave subtype", () => {
    const msg = makeMessage({ subtype: "channel_leave" });
    const result = formatMessageForMigration(msg, { userMapping });

    expect(result.body.content).toContain("Alice left the channel");
  });

  it("includes file attachment references", () => {
    const msg = makeMessage({
      files: [
        {
          id: "F001",
          name: "doc.pdf",
          urlPrivate: "https://files.slack.com/...",
          mimetype: "application/pdf",
          size: 1024,
        },
      ],
    });

    const uploadedFiles = new Map([
      ["F001", { url: "https://sharepoint.com/doc.pdf", name: "doc.pdf" }],
    ]);

    const result = formatMessageForMigration(msg, {
      userMapping,
      uploadedFiles,
    });

    expect(result.body.content).toContain("doc.pdf");
    expect(result.body.content).toContain("sharepoint.com");
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments![0].name).toBe("doc.pdf");
  });

  it("handles message with no text but file attachments", () => {
    const msg = makeMessage({
      text: "",
      files: [
        {
          id: "F001",
          name: "image.png",
          urlPrivate: "https://files.slack.com/...",
          mimetype: "image/png",
          size: 2048,
        },
      ],
    });

    const result = formatMessageForMigration(msg, { userMapping });
    expect(result.body.content).toContain("image.png");
  });
});
