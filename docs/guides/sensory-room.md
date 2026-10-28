# Run Stims in a sensory room

A room link turns a screen or projector into a display nobody has to operate: a multisensory room, a waiting area, a classroom wall. You choose the settings once, and the computer in the room opens one address.

## What a room link changes

A link containing `room=1` sets up that visit, and only that visit:

- **It starts on its own.** The link opens straight onto the visuals, with the demo track or the room's microphone driving them. No launch page, no Play button.
- **Reduce flashing is on.** Presets measured above the WCAG flash limit are skipped, and the stage dims when it detects strobing.
- **Presets change slowly.** Autoplay holds each preset for the time you choose (three minutes unless the link says otherwise) and moves to the next with an eight-second dissolve.
- **Brightness and motion can be capped.** The link can lower the brightness ceiling and the camera motion. It cannot raise either above what that computer already has saved.
- **The screen stays awake.** Stims asks the browser to keep the display on, and keeps drawing when the window loses focus.
- **Nothing is on top of the picture.** The controls, preset names, notices and pointer are hidden.
- **Nothing in the room changes it.** Keys and taps on the stage do nothing, including the blackout and white-flash keys.
- **Nothing is saved.** Trying a room link on your own laptop leaves your settings, your last preset and your "Welcome back" page as they were.

## Make the link

In Stims, open **Settings → Playback and audio → Room display**. Choose the sound, how often the preset changes, the brightness ceiling and the motion, then **Copy room link**. **Open it here** shows the room view on the computer you are using.

You can also write the link by hand. Start from `https://toil.fyi/?room=1` and add any of these:

| Add            | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| `&audio=demo`  | The built-in demo track drives the visuals. The default.                              |
| `&audio=mic`   | The room's microphone drives the visuals. The browser asks for permission once.       |
| `&dwell=300`   | Seconds each preset stays up, from 30 to 3600. Default 180.                           |
| `&brightness=0.6` | Brightness ceiling, from 0.3 (the darkest Stims allows) to 1.                      |
| `&motion=0.3`  | Share of the camera's zoom, spin and drift that reaches the screen, 0 to 1. At 0 the picture holds still and the waveforms keep moving. |

`brightness` and `motion` also work without `room=1`, on any link you share.

## Set up the room's computer

1. Open the room link in Chrome or Edge.
2. Press F11 (Ctrl+Cmd+F on a Mac) for full screen.
3. Click the screen once. Browsers keep sound off until someone clicks the page, and the visuals have nothing to react to until then.
4. If you chose the microphone, allow it when the browser asks. The browser remembers the answer for that site.

### A computer kept for the room

To skip the click and the full-screen step every time the computer starts, open the link in Chrome's kiosk mode with the autoplay restriction lifted. Replace the address with your own link, and keep the quotes.

On Windows:

```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required "https://toil.fyi/?room=1&dwell=300&brightness=0.6"
```

On macOS, with Chrome closed first (otherwise the flags are ignored):

```bash
open -a "Google Chrome" --args --kiosk --autoplay-policy=no-user-gesture-required "https://toil.fyi/?room=1&dwell=300&brightness=0.6"
```

On Linux:

```bash
google-chrome --kiosk --autoplay-policy=no-user-gesture-required "https://toil.fyi/?room=1&dwell=300&brightness=0.6"
```

Put the same command in the computer's startup items so the room comes back on its own after a restart or power cut. Set the operating system's own sleep and screen-saver timers to never as well: the browser's wake lock covers the screen while the page is showing, not the computer's update or power schedule.

## Change or leave a room display

The page ignores keys, so use the browser's and the operating system's own:

- **A normal window:** press F11 to leave full screen, then edit the address or open Stims without `room=1`.
- **Kiosk mode:** close the window with Alt+F4 (Windows, Linux) or Cmd+Q (macOS), then start Chrome again with a new link.

## What it does not do

- **It cannot vouch for every preset.** Most of the catalog has not been measured for flashing, and Reduce flashing can only skip measured presets. The live dimming reacts after a flash, so the first one or two get through. Watch a session through before leaving the room unattended, and lower the brightness ceiling if anything is too much. The [sensory controls guide](./accessibility.md#flash-labels-and-what-has-not-been-measured) explains what has been measured.
- **It does not choose calm presets.** Autoplay draws from the whole catalog, minus the presets measured as flashing. A lower motion setting is the strongest control over how busy the picture is.
- **It keeps drawing only while the window is on screen.** A browser stops drawing a tab that is hidden behind another tab or minimized, whatever the page asks.
- **It is not a therapy tool.** Stims makes no clinical claims; see [what this isn't](./accessibility.md#what-this-isnt).
