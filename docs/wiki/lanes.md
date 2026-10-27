# Lanes

Verified: 2026-10-27 · Sources: none

The five ways Surtitle gets used, defined by where the audio comes from and where the captions go. Lanes are named presets over one pipeline. Today only the input device and the profile flags differ; the source profiles below are planned. Standing and next steps live in [status](status.md); the order is in [roadmap](roadmap.md).

## The five lanes

| Lane | Edge | Audio source | Caption target |
| --- | --- | --- | --- |
| Remote call | Everyone joins from their own connection; nobody shares a room | Listening: the meeting app's audio. Presenting: your close microphone | Listening: your own screen. Presenting: OBS Virtual Camera or a shared OBS window into the meeting |
| Hosted stage | In-person event, but the organizer's host computer drives the display and presenters take turns sharing into meeting software | Venue mixer feed into an audio interface; the meeting's audio, joined as a participant; a room microphone as a last resort | Whatever the host shows; your captions reach the screen only through your own share |
| Direct stage | Your laptop drives the display over HDMI or AirPlay | Close microphone, or a mixer feed into your laptop | OBS projector or Browser Source composed over slides, a browser, a terminal or a webcam |
| Open floor | No stage: breakouts, group discussion, conversation | Far field: the built-in microphone, an iPhone as a Continuity microphone, or a room microphone | Your own screen |
| Audience seat | You are listening to someone else's talk, in person | A microphone hearing the PA, or a venue assistive-listening or interpretation feed | Your own screen |

Every lane uses one English pair per session. Open floor is the stress test for automatic direction within that pair. Several languages at once is a long-term possibility in the [roadmap](roadmap.md).

Every input is an ordinary macOS input device that Chrome can open: a USB or Thunderbolt interface, an iPhone through Continuity, or a virtual loopback device for meeting audio. No network microphone is planned.

## Source profiles

Today echo cancellation and noise suppression are hardcoded on, and every input shares one detector setup. That suits a close microphone and is the leading hypothesis for false rejection on the open floor. The plan replaces the fixed flags with a profile the operator picks per session:

| Profile | Echo cancellation, noise suppression, auto gain | Gate | Lanes |
| --- | --- | --- | --- |
| Close mic | on, on, off | calibrated, as today | Direct stage, Remote call presenting |
| Line feed | off, off, off | fixed low threshold, no room calibration | Hosted stage, Direct stage with a mixer |
| Far field | off, off, deterministic per-turn gain in the worker before the speech gate | calibrated, more sensitive | Open floor, Audience seat |
| App audio | off, off, off | fixed | Remote call listening |

Values in the gate column are starting points to test with the planned faint-level sweep and the processing on-versus-off room session. Diagnostics record the active profile so field logs say which one ran.

## Sources and direction

Each audio frame, turn trace and row gains a source identifier, even while one source is active. With it, a later step can run two sources at once: your microphone plus the meeting audio in a remote call, or a lapel microphone plus a room microphone on the open floor. The source then supplies the direction hint, because the operator knows which language each source carries. That replaces echo cancellation and cross-source deduplication with separate streams, and addresses language drift where it matters. It needs a detector per source and measured worker load before it ships.

## Known edges

- Direct stage: audio from a video in the slides plays through HDMI and reaches the microphone.
- Hosted stage: captions cannot appear on the host's screen unless the presenter running Surtitle shares them.
- Remote call listening: a virtual loopback device is the zero-code path; per-app capture through ScreenCaptureKit or Core Audio process taps would need a native helper and comes last.
- Hybrid or livestreamed events add a second output, such as a caption track on a stream, on top of a stage lane. That is an output requirement, not a lane.
