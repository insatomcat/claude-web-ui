import { useCallback, useEffect, useRef, useState } from "react";
import type { TerminalHandle } from "./TerminalView";

type Props = {
  onSend: (text: string, options: { appendNewline: boolean }) => void;
  disabled?: boolean;
};

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function VoiceComposer({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(true);
  const recognitionRef = useRef<SpeechRecognition | null>(null);

  useEffect(() => {
    setSupported(getSpeechRecognition() != null);
  }, []);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = navigator.language || "fr-FR";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let chunk = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        chunk += ev.results[i][0].transcript;
      }
      if (chunk) setText((prev) => (prev ? `${prev} ${chunk}` : chunk));
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }, []);

  const toggleMic = () => {
    if (listening) stopListening();
    else startListening();
  };

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        placeholder="Prompt (ou dictée micro)…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        disabled={disabled}
      />
      <div className="composer-actions">
        {supported && (
          <button
            type="button"
            className={`btn icon ${listening ? "active" : ""}`}
            onClick={toggleMic}
            disabled={disabled}
            title="Dictée vocale"
            aria-pressed={listening}
          >
            {listening ? "⏹" : "🎤"}
          </button>
        )}
        <button
          type="button"
          className="btn primary"
          disabled={disabled || !text.trim()}
          onClick={() => {
            onSend(text.trim(), { appendNewline: true });
            setText("");
            stopListening();
          }}
        >
          Envoyer ↵
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || !text.trim()}
          onClick={() => {
            onSend(text.trim(), { appendNewline: false });
          }}
          title="Coller sans valider"
        >
          Coller
        </button>
      </div>
    </div>
  );
}

export function useTerminalBridge() {
  const ref = useRef<TerminalHandle | null>(null);
  const setHandle = useCallback((h: TerminalHandle) => {
    ref.current = h;
  }, []);
  const sendToTerminal = useCallback(
    (text: string, options: { appendNewline: boolean }) => {
      const h = ref.current;
      if (!h) return;
      if (options.appendNewline) h.sendLine(text);
      else h.send(text);
      h.focus();
    },
    [],
  );
  return { setHandle, sendToTerminal };
}
