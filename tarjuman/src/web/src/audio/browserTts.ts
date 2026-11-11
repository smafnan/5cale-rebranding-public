/**
 * Last-resort voice: the browser's built-in speech synthesis.
 *
 * It cannot be routed to a chosen output device (it always plays on the system default),
 * so it is only a fallback for when the server cannot synthesize speech at all.
 */

let voices: SpeechSynthesisVoice[] = [];
let primed = false;

/**
 * Browsers load their voice list asynchronously: the first getVoices() call usually returns
 * nothing. Call this once at start-up so the list is there when it is needed.
 */
export function primeBrowserVoices(): void {
  const synth = globalThis.speechSynthesis;
  if (!synth || primed) return;
  primed = true;
  const refresh = () => {
    voices = synth.getVoices();
  };
  refresh();
  synth.addEventListener?.('voiceschanged', refresh);
}

function findVoice(locale: string): SpeechSynthesisVoice | undefined {
  const language = locale.split('-')[0]?.toLowerCase() ?? '';
  const sameLocale = voices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase());
  return (
    sameLocale ??
    voices.find(
      (voice) => voice.lang.toLowerCase().startsWith(`${language}-`) || voice.lang.toLowerCase() === language,
    )
  );
}

/**
 * Speak `text` with a built-in voice.
 *
 * `onSpeaking` is told when audible speech starts and stops, so the caller can keep the
 * microphone from picking it up.
 *
 * @returns false when the browser has voices but none for this language (nothing is spoken).
 */
export function speakWithBrowser(
  text: string,
  locale: string,
  rate: number,
  onSpeaking: (speaking: boolean) => void,
): boolean {
  const synth = globalThis.speechSynthesis;
  if (!synth) return false;
  primeBrowserVoices();
  const voice = findVoice(locale);
  // With a loaded list and no match, the default voice would read the text as gibberish.
  if (!voice && voices.length > 0) return false;

  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) utterance.voice = voice;
  // Without a voice object (list not loaded yet) the browser picks one by language.
  utterance.lang = voice?.lang ?? locale;
  utterance.rate = Math.min(2, Math.max(0.5, rate));
  utterance.onstart = () => onSpeaking(true);
  utterance.onend = () => onSpeaking(false);
  utterance.onerror = () => onSpeaking(false);
  synth.speak(utterance);
  return true;
}

export function cancelBrowserSpeech(): void {
  globalThis.speechSynthesis?.cancel();
}
