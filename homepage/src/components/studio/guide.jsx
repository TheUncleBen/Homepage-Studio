import { Fragment } from "react";

import StudioIcon from "./icons";

// Setup guidance from the widget catalog (scripts/build-catalog.mjs): plain
// blocks whose text keeps a little inline Markdown. It is drawn as React
// elements, never as HTML, and only http(s) links become links.
const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(_[^_]+_)|(\*[^*]+\*)/g;

export function GuideText({ text }) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const [token] = match;
    if (match[1]) parts.push(<code key={match.index}>{token.slice(1, -1)}</code>);
    else if (match[2]) parts.push(<strong key={match.index}>{token.slice(2, -2)}</strong>);
    else if (match[3]) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      parts.push(
        /^https?:\/\//i.test(href) ? (
          <a key={match.index} href={href} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        ) : (
          label
        ),
      );
    } else parts.push(<em key={match.index}>{token.slice(1, -1)}</em>);
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.map((part, index) => <Fragment key={index}>{part}</Fragment>);
}

function Block({ block }) {
  switch (block.type) {
    case "heading":
      return (
        <h4>
          <GuideText text={block.text} />
        </h4>
      );
    case "ul":
    case "ol": {
      const List = block.type;
      return (
        <List>
          {block.items.map((item, index) => (
            <li key={index}>
              <GuideText text={item} />
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div className="studio-guide-table">
          <table>
            <thead>
              <tr>
                {block.rows[0].map((cell, index) => (
                  <th key={index}>
                    <GuideText text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.slice(1).map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index}>
                      <GuideText text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "code":
      return <pre>{block.text}</pre>;
    case "note":
      return (
        <div className={`studio-guide-note studio-guide-${block.tone}`}>
          {block.blocks.map((child, index) => (
            <Block key={index} block={child} />
          ))}
        </div>
      );
    default:
      return (
        <p>
          <GuideText text={block.text} />
        </p>
      );
  }
}

export default function Guide({ blocks = [], notes = [], docs }) {
  return (
    <div className="studio-guide">
      {notes.map((note, index) => (
        <div key={`note-${index}`} className="studio-guide-note studio-guide-note-studio">
          <p>{note}</p>
        </div>
      ))}
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
      {docs && (
        <a className="studio-guide-docs" href={docs} target="_blank" rel="noopener noreferrer">
          <StudioIcon name="book" size={16} />
          Full documentation and examples
          <StudioIcon name="external" size={14} />
        </a>
      )}
    </div>
  );
}
