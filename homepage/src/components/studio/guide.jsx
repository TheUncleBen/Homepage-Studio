import { Fragment, useState } from "react";

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

function CopyValue({ label, value }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="studio-guide-copy">
      <span className="studio-guide-copy-label">{label}</span>
      <code>{value}</code>
      <button
        type="button"
        className="studio-text-button"
        aria-label={`Copy ${label.toLowerCase()} ${value}`}
        onClick={() =>
          navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

// Each secret the widget takes, with the exact names to use for it as a
// Docker secret (board 25; docs/DEPLOY.md, "Widget API keys as Docker
// secrets").
export function SecretSteps({ secrets, name }) {
  return (
    <div className="studio-guide-secrets">
      <h4>Keep {secrets.length > 1 ? "its secrets" : `the ${secrets[0].label.toLowerCase()}`} out of the files</h4>
      <p>
        A value typed into the settings stays in the snapshot history. Store it as a Docker secret instead, so the
        settings only name it.
      </p>
      {secrets.map((entry) => (
        <div key={entry.key} className="studio-guide-secret">
          {secrets.length > 1 && <h5>{entry.label}</h5>}
          <CopyValue label="Secret name" value={entry.secret} />
          <CopyValue label="Stack variable" value={`${entry.variable}: /run/secrets/${entry.secret}`} />
          <CopyValue
            label={`In ${entry.key.includes(".") ? "the YAML" : `the ${entry.label} field`}`}
            value={entry.reference}
          />
        </div>
      ))}
      <p>
        Add the secret to the stack&apos;s secrets on both levels (the top of the stack and Studio&apos;s service), add
        the variable to Studio&apos;s environment, update the stack, then enter the last line. For a second{" "}
        {name || "widget"} with different credentials, add a suffix such as <code>_2</code> to each name.
      </p>
    </div>
  );
}

export default function Guide({ blocks = [], notes = [], secrets = [], name, docs }) {
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
      {secrets.length > 0 && <SecretSteps secrets={secrets} name={name} />}
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
