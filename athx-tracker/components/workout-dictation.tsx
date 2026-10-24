"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
type SpeechWindow = Window & {
  SpeechRecognition?: new () => Recognition;
  webkitSpeechRecognition?: new () => Recognition;
};
const subscribe = () => () => {};
const speechConstructor = () => {
  const browser = window as SpeechWindow;
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
};

export function WorkoutDictation({ value, onChange, disabled, listening, onListening }: {
  value: string; onChange: (value: string) => void; disabled: boolean;
  listening: boolean; onListening: (value: boolean) => void;
}) {
  const supported = useSyncExternalStore(subscribe, () => Boolean(speechConstructor()), () => false);
  const current = useRef<Recognition | null>(null);
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (current.current) {
      current.current.onresult = null;
      current.current.onerror = null;
      current.current.onend = null;
      current.current.abort();
    }
  }, []);

  function start() {
    const Constructor = speechConstructor();
    if (!Constructor) return;
    const recognition = new Constructor();
    current.current = recognition;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    const prefix = value.trim();
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map(result => result[0].transcript).join(" ");
      onChange(`${prefix}${prefix ? " " : ""}${transcript}`.slice(0, 4000));
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" || event.error === "service-not-allowed"
        ? "Microphone access was blocked. Allow it in your browser, type your workout, or use your keyboard's microphone."
        : "Dictation stopped. Your words are kept; try again or continue typing.");
      onListening(false);
    };
    recognition.onend = () => {
      if (current.current !== recognition) return;
      onListening(false);
      current.current = null;
    };
    setError("");
    onListening(true);
    try { recognition.start(); } catch {
      onListening(false);
      current.current = null;
      setError("Dictation could not start. Type your workout or use your keyboard's microphone.");
    }
  }

  return (
    <div className="space-y-2">
      {supported ? (
        <Button type="button" size="sm" variant="outline" disabled={disabled}
          aria-pressed={listening} onClick={() => listening ? current.current?.stop() : start()}>
          {listening ? <Square /> : <Mic />}
          {listening ? "Stop dictation" : "Dictate workout"}
        </Button>
      ) : <p className="text-xs text-muted-foreground">To dictate, use the microphone on your phone or computer keyboard.</p>}
      {listening ? <p role="status" className="text-xs text-muted-foreground">Listening… Stop dictation to review your words and fill the workout.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
