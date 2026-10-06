# MilkDrop presets in your browser

Stims plays MilkDrop presets in a browser tab. There is nothing to install: open [toil.fyi](https://toil.fyi) and a preset is already animating, silently, until you start some audio.

MilkDrop is the music visualizer Ryan Geiss wrote for Winamp. A MilkDrop *preset* is a small text file of equations that decides how the picture moves, and it reacts to whatever is playing. People have been trading and remixing those files for more than two decades, and Stims runs them on the web.

## What you can do with it

- **Watch.** Pick a preset from the catalog, or follow a link like [toil.fyi/?preset=krash-rovastar-cerebral-demons-stars](https://toil.fyi/?preset=krash-rovastar-cerebral-demons-stars) and it plays with demo audio straight away.
- **Play your own music.** Start audio from a browser tab, a YouTube link, or your microphone, and the presets react to it.
- **Browse.** The catalog has well over 1,700 presets, searchable by description, with collections, previews, and favorites. The [discover hubs](/discover/audio-reactive) group them by look and by author.
- **Edit and remix.** Open the editor to see the real `.milk` source and which part of the sound drives each control, then drag live sliders or change the equations. A remix keeps the credit of whoever you built on.
- **Bring your own presets.** Import `.milk` files (or a `.zip` pack), export them in the format MilkDrop 2 itself saves — comments, shader code, and fields Stims does not use kept intact — or share a link that carries your edited preset inside the address.

## Coming from Winamp?

If you remember MilkDrop from Winamp, this is the same kind of preset file running in a web page, so there is no player to install and no plugin to hunt down. Stims is an independent project. It is not made by, or affiliated with, Winamp or Ryan Geiss, and it credits the preset authors on every entry.

## Learn to make your own

The [Learn section](/learn/) is a free curriculum for writing presets, from dragging sliders to writing shaders. [Track 0 — Play](/learn/play/) needs no code and takes about fifteen minutes.

## How Stims compares to Butterchurn and projectM

Butterchurn and projectM are the projects most people arrive from. See [Stims vs Butterchurn vs projectM](/learn/milkdrop-vs-butterchurn-projectm/) for an honest side-by-side.

## FAQ

### Do I need to install anything to run MilkDrop in a browser?

No. Stims runs in the browser tab using WebGL or WebGPU. The [compatibility and performance guide](/performance/) lists which browsers and devices run it well.

### Is it free?

Yes. The visualizer is free to use.

### Will it make sound as soon as I open it?

No. Stims is silent until you start some audio, and one action stops everything. Motion also follows your operating system's reduce-motion setting.

### Can I use my existing .milk preset files?

Yes. Import `.milk` files into the editor and export them back out as `.milk`. Some presets use features that are approximated, and each preset is labeled with how faithfully it runs.

### Can I make my own MilkDrop presets here?

Yes. The editor shows the real preset source with completions and error messages, and the [authoring curriculum](/learn/) teaches the format step by step.
