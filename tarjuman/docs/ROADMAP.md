# Roadmap

What the proof of concept does today is described in the README. This is what comes next,
in the order that makes it more useful per unit of effort.

## 1. Confirm on real calls

- Run `npm run doctor` with real keys and fix whatever the providers have changed since.
- A bake-off on your own voices: 20 Urdu sentences (several with English terms) and 20
  German ones through each recognizer, to confirm the default order.
- Tune "Pause that ends a sentence" and the detection sensitivity for your rooms and headsets.
- One full Teams meeting per operating system in use, following `docs/TEAMS-SETUP.md`.

## 2. Streaming engine: Google Live Translate

Google's `gemini-3.5-live-translate-preview` translates speech to speech while the speaker
is still talking, covers Urdu and German, and runs on a free AI Studio key (a handful of
concurrent sessions; two are needed). It would cut the delay from "after the sentence" to
"during the sentence" and removes the weakest link, Urdu recognition.

Planned as a second engine next to the sentence-by-sentence pipeline, selectable per call,
with automatic fallback:

- the browser streams speech-gated 16 kHz audio instead of whole utterances;
- the server holds one Live session per direction and relays 24 kHz audio and transcripts;
- English captions come from the existing translation chain, run on the transcripts;
- session renewal on the service's "go away" notice.

Open points to measure first: the free quota, translation quality for Urdu ⇄ German, and
that it accepts no glossary or instructions.

## 3. Quality

- Interim captions while a sentence is still being spoken.
- A glossary that learns: one click on a wrong term in the transcript adds a correction.
- Speaker names in the transcript when several people share one side.
- Roman Urdu captions as an option.
- A meeting summary and action items from the exported transcript.
- Speech detection model v6, after comparing it with v5 on real recordings.

## 4. Easier setup

- A desktop package (Electron or Tauri) that ships its own virtual audio device handling
  and captures the Teams application's audio directly, so there is no cable to install and
  no sharing dialog.
- Captions inside Teams itself: Teams accepts caption lines from external captioners
  (CART) through a per-meeting URL, so everyone in the meeting could switch on Tarjuman's
  captions in the normal Teams caption view.
- A shared room: a link the other side opens on a phone to read and hear the translation,
  for meetings outside Teams.

## 5. Production

- Paid tiers for the providers already integrated (see `docs/PROVIDERS.md`): Azure AI
  Speech in an EU region for voices, Gemini with billing for recognition and translation.
- Hosted deployment behind single sign-on, with per-user settings and usage reporting.
- A data-protection review: processing agreements with the providers, a retention policy
  (today nothing is stored), consent wording for participants.
- An interpreter that joins the meeting as a participant, so nobody runs anything locally.
  Microsoft's route for that (a real-time media bot) requires a C#/.NET service on Windows
  in Azure and tenant-admin consent; Azure Communication Services is the alternative.
- More language pairs: adding one is a registry entry, voices and a few phrases.

## Not planned

- Microsoft's own Interpreter in Teams does not offer Urdu, and Teams' translated captions
  are text only and need a paid licence; Tarjuman exists because of that gap, and would be
  retired for any language pair Teams starts to cover well.
- Meta's SeamlessM4T covers Urdu and German speech to speech, but its licence is
  non-commercial.
