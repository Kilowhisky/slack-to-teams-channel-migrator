// Common Slack emoji to Unicode mappings
const EMOJI_MAP: Record<string, string> = {
  "+1": "\u{1F44D}",
  thumbsup: "\u{1F44D}",
  "-1": "\u{1F44E}",
  thumbsdown: "\u{1F44E}",
  heart: "\u{2764}\u{FE0F}",
  smile: "\u{1F604}",
  laughing: "\u{1F606}",
  joy: "\u{1F602}",
  wink: "\u{1F609}",
  blush: "\u{1F60A}",
  thinking_face: "\u{1F914}",
  eyes: "\u{1F440}",
  fire: "\u{1F525}",
  tada: "\u{1F389}",
  rocket: "\u{1F680}",
  white_check_mark: "\u{2705}",
  x: "\u{274C}",
  warning: "\u{26A0}\u{FE0F}",
  bulb: "\u{1F4A1}",
  memo: "\u{1F4DD}",
  pray: "\u{1F64F}",
  clap: "\u{1F44F}",
  wave: "\u{1F44B}",
  raised_hands: "\u{1F64C}",
  ok_hand: "\u{1F44C}",
  point_up: "\u{261D}\u{FE0F}",
  point_down: "\u{1F447}",
  point_left: "\u{1F448}",
  point_right: "\u{1F449}",
  100: "\u{1F4AF}",
  heavy_check_mark: "\u{2714}\u{FE0F}",
  star: "\u{2B50}",
  sparkles: "\u{2728}",
  zap: "\u{26A1}",
  boom: "\u{1F4A5}",
  muscle: "\u{1F4AA}",
  sob: "\u{1F62D}",
  sweat_smile: "\u{1F605}",
  slightly_smiling_face: "\u{1F642}",
  upside_down_face: "\u{1F643}",
  grimacing: "\u{1F62C}",
  rolling_on_the_floor_laughing: "\u{1F923}",
  see_no_evil: "\u{1F648}",
  hear_no_evil: "\u{1F649}",
  speak_no_evil: "\u{1F64A}",
  exclamation: "\u{2757}",
  question: "\u{2753}",
  check: "\u{2714}\u{FE0F}",
  red_circle: "\u{1F534}",
  large_blue_circle: "\u{1F535}",
  large_green_circle: "\u{1F7E2}",
  party_popper: "\u{1F389}",
};

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type UserResolver = (userId: string) => string;

export function convertMrkdwnToHtml(
  text: string,
  userResolver: UserResolver
): string {
  if (!text) return "";

  // Step 1: Decode Slack's HTML entities first
  let result = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

  // Step 2: Extract code blocks to protect them from further processing
  const codeBlocks: string[] = [];
  result = result.replace(/```([\s\S]*?)```/g, (_match, code: string) => {
    const index = codeBlocks.length;
    codeBlocks.push(code);
    return `\x00CODEBLOCK_${index}\x00`;
  });

  // Step 3: Extract inline code
  const inlineCodes: string[] = [];
  result = result.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = inlineCodes.length;
    inlineCodes.push(code);
    return `\x00INLINECODE_${index}\x00`;
  });

  // Step 4: Process links and mentions (angle bracket syntax)
  // User mentions: <@U123ABC>
  result = result.replace(/<@([A-Z0-9]+)>/g, (_match, userId: string) => {
    const name = userResolver(userId);
    return `<b>@${escapeHtml(name)}</b>`;
  });

  // Channel mentions: <#C123ABC|channel-name> or <#C123ABC>
  result = result.replace(/<#([A-Z0-9]+)(?:\|([^>]+))?>/g, (_match, _id: string, name?: string) => {
    return `<b>#${escapeHtml(name || _id)}</b>`;
  });

  // Special mentions
  result = result.replace(/<!here>/g, "<b>@here</b>");
  result = result.replace(/<!channel>/g, "<b>@channel</b>");
  result = result.replace(/<!everyone>/g, "<b>@everyone</b>");

  // Subteam mentions: <!subteam^S123|@team-name>
  result = result.replace(/<!subteam\^[A-Z0-9]+\|@([^>]+)>/g, (_match, name: string) => {
    return `<b>@${escapeHtml(name)}</b>`;
  });

  // URLs with labels: <https://example.com|Example>
  result = result.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_match, url: string, label: string) => {
    return `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;
  });

  // Bare URLs: <https://example.com>
  result = result.replace(/<(https?:\/\/[^>]+)>/g, (_match, url: string) => {
    return `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  });

  // mailto links: <mailto:user@example.com|user@example.com>
  result = result.replace(/<mailto:([^|>]+)\|([^>]+)>/g, (_match, email: string, label: string) => {
    return `<a href="mailto:${escapeHtml(email)}">${escapeHtml(label)}</a>`;
  });

  // Bare mailto: <mailto:user@example.com>
  result = result.replace(/<mailto:([^>]+)>/g, (_match, email: string) => {
    return `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`;
  });

  // Step 5: Now escape remaining raw HTML characters in text
  // But preserve already-created HTML tags
  const htmlTags: string[] = [];
  result = result.replace(/<[^>]+>/g, (tag) => {
    // Only preserve our generated HTML tags (a, b, etc.)
    if (/^<\/?(?:a|b|i|s|br|blockquote|pre|code)([\s>])/.test(tag) || /^<a\s/.test(tag)) {
      const idx = htmlTags.length;
      htmlTags.push(tag);
      return `\x00HTMLTAG_${idx}\x00`;
    }
    return escapeHtml(tag);
  });

  // Escape remaining angle brackets
  result = result.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Restore HTML tags
  result = result.replace(/\x00HTMLTAG_(\d+)\x00/g, (_match, idx: string) => {
    return htmlTags[parseInt(idx, 10)];
  });

  // Step 6: Process text formatting
  // Bold: *text*
  result = result.replace(/(?<!\w)\*([^\*\n]+)\*(?!\w)/g, "<b>$1</b>");

  // Italic: _text_
  result = result.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~text~
  result = result.replace(/(?<!\w)~([^~\n]+)~(?!\w)/g, "<s>$1</s>");

  // Step 7: Process blockquotes (lines starting with >)
  const lines = result.split("\n");
  const processedLines: string[] = [];
  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^&gt;\s?(.*)/);
    if (match) {
      if (!inBlockquote) {
        inBlockquote = true;
        blockquoteLines = [];
      }
      blockquoteLines.push(match[1]);
    } else {
      if (inBlockquote) {
        processedLines.push(`<blockquote>${blockquoteLines.join("<br>")}</blockquote>`);
        inBlockquote = false;
        blockquoteLines = [];
      }
      processedLines.push(line);
    }
  }
  if (inBlockquote) {
    processedLines.push(`<blockquote>${blockquoteLines.join("<br>")}</blockquote>`);
  }
  result = processedLines.join("\n");

  // Step 8: Process emoji
  result = result.replace(/:([a-z0-9_+-]+):/g, (_match, name: string) => {
    return EMOJI_MAP[name] || `:${name}:`;
  });

  // Step 9: Convert newlines to <br>
  result = result.replace(/\n/g, "<br>");

  // Step 10: Restore code blocks and inline code
  result = result.replace(/\x00CODEBLOCK_(\d+)\x00/g, (_match, idx: string) => {
    const code = codeBlocks[parseInt(idx, 10)];
    return `<pre>${escapeHtml(code.trim())}</pre>`;
  });

  result = result.replace(/\x00INLINECODE_(\d+)\x00/g, (_match, idx: string) => {
    const code = inlineCodes[parseInt(idx, 10)];
    return `<code>${escapeHtml(code)}</code>`;
  });

  return result;
}
