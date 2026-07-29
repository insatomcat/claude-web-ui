import type { TerminalHandle } from "./TerminalView";

type Props = {
  onKey: (data: string) => void;
  onFocusTerminal: () => void;
};

const KEYS: Array<{ label: string; seq: string }> = [
  { label: "Tab", seq: "\t" },
  { label: "Esc", seq: "\x1b" },
  { label: "Ctrl+C", seq: "\x03" },
  { label: "Ctrl+D", seq: "\x04" },
  { label: "↑", seq: "\x1b[A" },
  { label: "↓", seq: "\x1b[B" },
  { label: "←", seq: "\x1b[D" },
  { label: "→", seq: "\x1b[C" },
];

export function MobileKeys({ onKey, onFocusTerminal }: Props) {
  return (
    <div className="mobile-keys">
      {KEYS.map((k) => (
        <button
          key={k.label}
          type="button"
          className="key-chip"
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          onClick={() => {
            onKey(k.seq);
            onFocusTerminal();
          }}
        >
          {k.label}
        </button>
      ))}
    </div>
  );
}

export function injectKeys(handle: TerminalHandle | null, seq: string) {
  handle?.send(seq);
  handle?.focus();
}
