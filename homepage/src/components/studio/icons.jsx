export default function StudioIcon({ name, size = 18, ...props }) {
  const paths = {
    plus: "M12 5v14M5 12h14",
    close: "m6 6 12 12M6 18 18 6",
    search: "m21 21-4.3-4.3M10.8 18a7.2 7.2 0 1 0 0-14.4 7.2 7.2 0 0 0 0 14.4Z",
    edit: "m15 5 4 4M5 19l4-1L20 7a2.8 2.8 0 0 0-4-4L5 14l-1 6Z",
    check: "m5 12 4 4L19 6",
    layout: "M4 4h6v7H4zM14 4h6v11h-6zM4 15h6v5H4zM14 19h6v1h-6z",
    play: "m8 5 11 7-11 7Z",
    pause: "M8 5v14M16 5v14",
    stack: "m3 8 9-5 9 5-9 5ZM3 12l9 5 9-5M3 16l9 5 9-5",
    // Sliders, not a sun: the previous rayed circle read as a theme toggle.
    settings: "M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4",
    grip: "M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01",
    resize: "m8 20 12-12M15 20l5-5",
    undo: "M4 10h10a6 6 0 0 1 0 12M4 10l5-5M4 10l5 5",
    trash: "M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7",
    link: "m10 14 4-4M8 15l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16 9l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0",
    chevron: "m9 5 7 7-7 7",
    down: "m6 9 6 6 6-6",
    grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v6M12 7.5h.01",
    menu: "M4 7h16M4 12h16M4 17h16",
    more: "M5 12h.01M12 12h.01M19 12h.01",
    clock: "M12 8v4l3 2M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0Z",
    user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0",
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "grip" || name === "more" ? 3.5 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.layout} />
    </svg>
  );
}
