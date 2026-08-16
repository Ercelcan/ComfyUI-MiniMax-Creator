1. NLE Workflow & Keyboard Shortcuts (Pro Editor Feel)

    J-K-L Shuttling & Hotkeys:

        Space: Play / Pause.

        J / K / L: Reverse playback (

                
        2×
        2×

              

        ), Pause, Forward playback (

                
        2×
        2×

              

        ).

        I & O: Set Mark In and Mark Out points at playhead needle.

        S: Razor split at playhead.

        ← / →: Step backward/forward 1 frame (

                
        1/24s
        1/24s

              

        ).

    Drag-and-Drop Shot Reordering:

        Drag any shot block on Lane 2 to visually reorder shots on the timeline instead of using arrow buttons.

    Timeline Undo / Redo (Ctrl+Z / Ctrl+Y):

        Undo stack for razor splits, trims, shot deletions, and prompt edits so accidental changes can be undone instantly.

2. AI Directing & Storyboard Tools

    AI Script Breakdown ("Script

            
    →
    →

          

    Timeline"):

        Paste a complete narrative paragraph or script in the Master Prompt

                
        →
        →

              

        click "✨ AI Breakdown"

                
        →
        →

              

        the AI automatically cuts it into

                
        4–6
        4–6

              

        timed storyboard shots with continuity tags and places them onto the timeline.

    Visual Consistency & Continuity Linter:

        Highlights warnings if a prompt introduces conflicting conditions across a match cut (e.g. Shot 1 is sunny afternoon, Shot 2 suddenly describes rainy night with a match cut).

    Token & VRAM Estimation Meter:

        A lightweight gauge showing the estimated sampling time and memory footprint based on timeline duration and active LoRAs/references.

3. Audio Mixing & Soundscape Design

    Per-Shot Audio Levels & Ducking:

        A gain/volume fader on each shot (

                
        0–100%
        0–100%

              

        ) to balance spoken dialogue against background music.

        Auto-Ducking: Automatically lowers non-diegetic music volume when dialogue <d> tags are active.

    Waveform Color Coding:

        Color dialogue bursts green, ambient room soundscape amber, and music cues blue on the audio track.

4. Export & Post-Production Bridge

    Export to Premiere / DaVinci Resolve (.xml / .edl):

        Export an XML or EDL timeline file with all cut timings, audio tracks, and rendered video clips pre-arranged on tracks for color grading and finishing in professional editing software.

    Export Image Sequence / GIF:

        Direct one-click export as PNG sequence, high-bitrate WebM, or GIF.

5. Media & Library Improvements

    Shot Duplication with Variations:

        "Duplicate as Variant"

                
        →
        →

              

        keeps the shot timing and references but rolls a new seed or prompts alternative camera motion.

    Pre-render Cache Lock Indicators:

        A visual freeze indicator on the track when all shots are locked, giving you 100% confidence that no GPU time will be wasted on already-approved clips.