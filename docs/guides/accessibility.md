# Sensory control in Stims

You decide how much is happening on screen, how it changes, and when it stops.

## What you control

- **When sound starts.** The home page makes no sound until you choose an audio source. A link to a specific preset starts the demo track by itself; most browsers hold that sound until your first click, tap, or key press, and Stims says so on screen.
- **Brightness.** *Stage brightness* in Settings caps how bright the picture can get, down to 30%. The cap applies to every preset, on either renderer, and to picture-in-picture and the projector window. Recordings leave it out: it suits your screen, not the screens of the people who watch the file.
- **Motion.** The *Motion* slider in Settings scales the camera movement: zoom, spin, and drift. At 0% the picture holds its position while the waveforms keep reacting to the music. *Freeze visuals* holds the current frame still, and Space pauses and resumes the picture.
- **Reduce flashing.** Switch it on in Settings, from the dock menu, or from the command palette. Browse then hides the presets measured above the WCAG 2.3.1 flash limit and says how many, with a button to show them again. Shuffle and autoplay skip those presets, and while a preset plays, the stage dims whenever strobing is detected, with a "Dimming flashes" notice. The dimming also reaches picture-in-picture, the projector window and browser recordings. It reacts after it sees a flash, so the first one or two get through: it reduces flashing rather than preventing it.
- **Shared screens.** A link ending in `reduceFlashing=1` turns Reduce flashing on for that visit only, so a party display or stream source dims flashes for people who never opened Settings. No link can turn it off.
- **Your system settings.** If your operating system asks for reduced motion, Stims starts with Reduce flashing on, the Motion slider at 40%, and a still home page instead of an animated one. Changing either setting yourself overrides that.
- **How presets change.** Cut switches instantly. Blend crossfades over a duration you choose, from half a second to eight, however bright or busy the presets on either side are.
- **Stop.** One action stops the audio and returns to the start page.
- **Where you left off.** Your last session and settings are saved on your device, so a setup you liked is there when you return.
- **The equations.** The live editor changes the equations that connect the sound to the picture while the preset runs.

## Flash labels, and what has not been measured

Presets measured above the WCAG flash limit carry a ⚡ **Flashing** label in Browse. Most presets in the catalog have not been measured yet. A preset without the label is unmeasured rather than cleared, and Reduce flashing leaves unmeasured presets in the list. The [sensory accessibility notes](../SENSORY_ACCESSIBILITY.md#layer-0--safety-first-sample-run-complete) record what has been measured and how.

## Why the controls are built this way

The visuals respond to the sound rather than playing alongside it: measured properties of the audio, such as frequency bands, transients, and beats, drive motion and colour as the music plays. That is why the controls above work on the response (how far the camera travels, how bright the picture gets, how abruptly presets change) as well as on what is playing.

## Who this is for

Anyone who wants a visualizer, first. For some people — including autistic and ADHD people — having this degree of control over the pace, intensity, and predictability of sensory input is, as part of managing sensory environments generally, linked to more comfort with stimulation, not less.[^1] That's a general finding about control and predictability, not a claim that Stims changes any particular outcome for any particular person — sensory preferences vary a lot from person to person, and what helps one person may not help another.

## What this isn't

Stims isn't a clinical or therapeutic tool. Nothing here is medical advice, and these controls aren't a treatment for anything. They are controls, available to everyone who uses Stims.

[^1]: See [`docs/LITERATURE.md`](../LITERATURE.md) and [`docs/SENSORY_ACCESSIBILITY.md`](../SENSORY_ACCESSIBILITY.md) for the underlying citations and their limits. Some of this is general research (not Stims- or autism-specific); the autism-specific finding it's closest to (Unwin et al., self-controlled vs. automatically-cycling sensory-room equipment) is a single study, not a settled result; and whether it applies to Stims specifically is an open question we haven't tested.
