import type { Node } from "./ast";

const SPACE: Node = { type: "text", text: " " };

/** An inline node with any line break inside it (bold over two lines, say) turned into a space. */
function oneLine(node: Node): Node {
  if (node.type === "br") return SPACE;
  return "children" in node ? ({ ...node, children: node.children.map(oneLine) } as Node) : node;
}

/**
 * A message's markdown laid flat into one line, for a preview of it such as
 * the line over a reply. Its formatting stays: bold, italics, underline,
 * strikethrough, colour, spoilers, emoji and mentions. Its blocks give up
 * their shape and keep their words: headings, quotes, lists, callouts and
 * collapsible sections read as the words in them, a code block as inline
 * code, and rules, footnotes and task boxes go.
 */
export function flattenInline(nodes: Node[]): Node[] {
  const out: Node[] = [];
  const gap = () => {
    const last = out[out.length - 1];
    if (last && !(last.type === "text" && /\s$/.test(last.text))) out.push(SPACE);
  };
  const walk = (list: Node[]): void => {
    for (const node of list) {
      switch (node.type) {
        case "paragraph":
        case "heading":
        case "subtext":
        case "quote":
        case "alert":
          gap();
          walk(node.children);
          break;
        case "list":
          for (const item of node.items) {
            gap();
            walk(item);
          }
          break;
        case "details":
          gap();
          walk(node.summary);
          gap();
          walk(node.children);
          break;
        case "table":
          for (const row of [node.head, ...node.rows]) {
            for (const cell of row) {
              gap();
              walk(cell);
            }
          }
          break;
        case "codeblock": {
          const text = node.text.replace(/\s+/g, " ").trim();
          if (text) {
            gap();
            out.push({ type: "code", text });
          }
          break;
        }
        case "br":
          gap();
          break;
        case "hr":
        case "file":
        case "footnotes":
        case "footnoteRef":
        case "task":
          break;
        default:
          out.push(oneLine(node));
      }
    }
  };
  walk(nodes);
  while (out[0] === SPACE) out.shift();
  return out;
}
