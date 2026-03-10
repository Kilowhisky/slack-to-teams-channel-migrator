import { describe, it, expect } from "vitest";
import { convertMrkdwnToHtml, escapeHtml } from "../../src/transform/mrkdwn-to-html";

const noopResolver = (id: string) => id;
const testResolver = (id: string) => {
  const names: Record<string, string> = {
    U012AB3CD: "Alice",
    U098ZYX: "Bob",
  };
  return names[id] ?? id;
};

describe("convertMrkdwnToHtml", () => {
  describe("basic formatting", () => {
    it("converts bold", () => {
      expect(convertMrkdwnToHtml("*hello*", noopResolver)).toBe("<b>hello</b>");
    });

    it("converts italic", () => {
      expect(convertMrkdwnToHtml("_hello_", noopResolver)).toBe("<i>hello</i>");
    });

    it("converts strikethrough", () => {
      expect(convertMrkdwnToHtml("~hello~", noopResolver)).toBe("<s>hello</s>");
    });

    it("converts inline code", () => {
      expect(convertMrkdwnToHtml("`hello`", noopResolver)).toBe(
        "<code>hello</code>"
      );
    });

    it("converts code blocks", () => {
      expect(convertMrkdwnToHtml("```\ncode here\n```", noopResolver)).toBe(
        "<pre>code here</pre>"
      );
    });

    it("converts multiple format types together", () => {
      const result = convertMrkdwnToHtml("*bold* and _italic_ and ~strike~", noopResolver);
      expect(result).toBe("<b>bold</b> and <i>italic</i> and <s>strike</s>");
    });
  });

  describe("links", () => {
    it("converts URL with label", () => {
      const result = convertMrkdwnToHtml("<https://example.com|Example>", noopResolver);
      expect(result).toBe('<a href="https://example.com">Example</a>');
    });

    it("converts bare URL", () => {
      const result = convertMrkdwnToHtml("<https://example.com>", noopResolver);
      expect(result).toBe('<a href="https://example.com">https://example.com</a>');
    });

    it("converts mailto with label", () => {
      const result = convertMrkdwnToHtml(
        "<mailto:user@example.com|user@example.com>",
        noopResolver
      );
      expect(result).toBe(
        '<a href="mailto:user@example.com">user@example.com</a>'
      );
    });
  });

  describe("mentions", () => {
    it("converts user mentions", () => {
      const result = convertMrkdwnToHtml("<@U012AB3CD>", testResolver);
      expect(result).toBe("<b>@Alice</b>");
    });

    it("converts channel mentions with name", () => {
      const result = convertMrkdwnToHtml("<#C123ABC|general>", noopResolver);
      expect(result).toBe("<b>#general</b>");
    });

    it("converts special mentions", () => {
      expect(convertMrkdwnToHtml("<!here>", noopResolver)).toBe("<b>@here</b>");
      expect(convertMrkdwnToHtml("<!channel>", noopResolver)).toBe(
        "<b>@channel</b>"
      );
      expect(convertMrkdwnToHtml("<!everyone>", noopResolver)).toBe(
        "<b>@everyone</b>"
      );
    });
  });

  describe("blockquotes", () => {
    it("converts single-line blockquote", () => {
      const result = convertMrkdwnToHtml("&gt; quoted text", noopResolver);
      expect(result).toBe("<blockquote>quoted text</blockquote>");
    });

    it("merges consecutive blockquote lines", () => {
      const result = convertMrkdwnToHtml(
        "&gt; line one\n&gt; line two",
        noopResolver
      );
      expect(result).toBe("<blockquote>line one<br>line two</blockquote>");
    });
  });

  describe("emoji", () => {
    it("converts known emoji", () => {
      expect(convertMrkdwnToHtml(":thumbsup:", noopResolver)).toBe("\u{1F44D}");
      expect(convertMrkdwnToHtml(":heart:", noopResolver)).toBe("\u{2764}\u{FE0F}");
      expect(convertMrkdwnToHtml(":fire:", noopResolver)).toBe("\u{1F525}");
    });

    it("passes through unknown emoji", () => {
      expect(convertMrkdwnToHtml(":custom_emoji:", noopResolver)).toBe(
        ":custom_emoji:"
      );
    });
  });

  describe("newlines", () => {
    it("converts newlines to br", () => {
      const result = convertMrkdwnToHtml("line one\nline two", noopResolver);
      expect(result).toBe("line one<br>line two");
    });
  });

  describe("code protection", () => {
    it("does not format inside inline code", () => {
      const result = convertMrkdwnToHtml("`*not bold*`", noopResolver);
      expect(result).toBe("<code>*not bold*</code>");
    });

    it("does not format inside code blocks", () => {
      const result = convertMrkdwnToHtml("```\n*not bold* _not italic_\n```", noopResolver);
      expect(result).toBe("<pre>*not bold* _not italic_</pre>");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(convertMrkdwnToHtml("", noopResolver)).toBe("");
    });

    it("handles plain text", () => {
      expect(convertMrkdwnToHtml("just plain text", noopResolver)).toBe(
        "just plain text"
      );
    });

    it("handles Slack HTML entities", () => {
      const result = convertMrkdwnToHtml("a &amp; b &lt; c &gt; d", noopResolver);
      // Slack encodes these; converter decodes then re-escapes < and >
      expect(result).toContain("a &");
      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
    });

    it("handles complex real-world message", () => {
      const input =
        "Hey <@U012AB3CD>, check out *this* link: <https://github.com|GitHub>\n\n" +
        "&gt; Some quoted text\n\n" +
        "`inline code` and :thumbsup:";

      const result = convertMrkdwnToHtml(input, testResolver);

      expect(result).toContain("<b>@Alice</b>");
      expect(result).toContain("<b>this</b>");
      expect(result).toContain('<a href="https://github.com">GitHub</a>');
      expect(result).toContain("<blockquote>Some quoted text</blockquote>");
      expect(result).toContain("<code>inline code</code>");
      expect(result).toContain("\u{1F44D}");
    });
  });
});

describe("escapeHtml", () => {
  it("escapes special characters", () => {
    expect(escapeHtml('<script>"alert"&</script>')).toBe(
      "&lt;script&gt;&quot;alert&quot;&amp;&lt;/script&gt;"
    );
  });
});
