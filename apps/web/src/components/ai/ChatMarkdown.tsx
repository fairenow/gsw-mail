import { Fragment, type ReactNode } from "react";

const inlinePattern = /(\*\*[^*]+\*\*|\*[^*]+\*|\`[^\`]+\`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;

function inlineNodes(value: string): ReactNode[] {
  const parts = value.split(inlinePattern).filter((part) => part !== "");
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (link) {
      return <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a>;
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

type Block =
  | { type: "paragraph"; lines: string[] }
  | { type: "ordered"; items: string[]; start: number }
  | { type: "unordered"; items: string[] }
  | { type: "heading"; level: number; text: string };

function blocks(content: string): Block[] {
  const output: Block[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let ordered: string[] = [];
  let orderedStart = 1;
  let unordered: string[] = [];

  const flush = () => {
    if (paragraph.length) output.push({ type: "paragraph", lines: paragraph });
    if (ordered.length) output.push({ type: "ordered", items: ordered, start: orderedStart });
    if (unordered.length) output.push({ type: "unordered", items: unordered });
    paragraph = [];
    ordered = [];
    orderedStart = 1;
    unordered = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      // Markdown models often place blank lines between numbered items. Keep an
      // active list open so the browser renders 1, 2, 3 instead of restarting
      // a new <ol> at 1 for every item.
      if (!ordered.length && !unordered.length) flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) {
      flush();
      output.push({ type: "heading", level: heading[1]!.length, text: heading[2]! });
      continue;
    }
    const orderedMatch = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (orderedMatch) {
      if (paragraph.length || unordered.length) flush();
      if (!ordered.length) orderedStart = Number(line.trim().match(/^\d+/)?.[0] ?? "1");
      ordered.push(orderedMatch[1]!);
      continue;
    }
    const unorderedMatch = /^\s*[-*+]\s+(.+)$/.exec(line);
    if (unorderedMatch) {
      if (paragraph.length || ordered.length) flush();
      unordered.push(unorderedMatch[1]!);
      continue;
    }
    if (ordered.length || unordered.length) flush();
    paragraph.push(line);
  }
  flush();
  return output;
}

export function ChatMarkdown({ content }: { content: string }) {
  return <div className="gsw-chat-markdown">
    {blocks(content).map((block, index) => {
      if (block.type === "heading") {
        const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
        return <Tag key={index}>{inlineNodes(block.text)}</Tag>;
      }
      if (block.type === "ordered") {
        return <ol key={index} start={block.start}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineNodes(item)}</li>)}</ol>;
      }
      if (block.type === "unordered") {
        return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineNodes(item)}</li>)}</ul>;
      }
      return <p key={index}>{block.lines.map((line, lineIndex) => <Fragment key={lineIndex}>{lineIndex > 0 && <br />}{inlineNodes(line)}</Fragment>)}</p>;
    })}
  </div>;
}
