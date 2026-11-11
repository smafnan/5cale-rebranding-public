/**
 * Last-resort voice: the browser's built-in speech synthesis.
 *
 * It cannot be routed to a chosen output device (it always plays on the system default),
 * so it is only a fallback for when the server cannot synthesize speech at all.
 */

function findVoice(locale: string): SpeechSynthesisVoice | undefined {
  const voices = globalThis.speechSynthesis?.getVoices() ?? [];
  const language = locale.split('-')[0]?.toLowerCase() ?? '';
  const sameLocale = voices.find((voice) => voice.lang.toLowerCase() === locale.toLowerCase());
  return (
    sameLocale ??
    voices.find(
      (voice) => voice.lang.toLowerCase().startsWith(`${language}-`) || voice.lang.toLowerCase() === language,
    )
  );
}

/** True when the browser has a voice for this locale's language. */
export function browserCanSpeak(locale: string): boolean {
  return findVoice(locale) !== undefined;
}

/**
 * Speak `text` with a built-in voice.
 * @returns false when the browser has no voice for the language (nothing is spoken).
 */
export function speakWithBrowser(text: string, locale: string, rate: number): boolean {
  const synth = globalThis.speechSynthesis;
  const voice = findVoice(locale);
  if (!synth || !voice) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = Math.min(2, Math.max(0.5, rate));
  synth.speak(utterance);
  return true;
}

export function cancelBrowserSpeech(): void {
  globalThis.speechSynthesis?.cancel();
}
