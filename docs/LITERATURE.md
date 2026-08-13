# Scientific literature reference map

> Updated 2026-03 for the MilkDrop-led positioning. References below remain applicable to audio-reactive visualizer research and multisensory UX rationale.

This guide collects published scientific literature that serves as grounding for the Stims audio-reactive visualizer: browser-native, preset-driven visuals with audio, motion, and performance controls. Use these references when documenting the rationale for audio-visual mappings or multisensory experiences. It also links literature themes to product features so citations are specific rather than generic.

## How to use this list

- **Cite by claim**: pick references that directly support the user-facing statement you are making (e.g., audio-visual binding, crossmodal correspondences, sensory processing differences).
- **Avoid medical claims**: unless there is a direct study matching the exact claim, keep language descriptive (e.g., "audio-reactive visuals" or "sensory exploration") rather than therapeutic.
- **Prefer review papers** when summarizing broader phenomena; use primary studies for specific phenomena.
- **Connect to a feature**: each citation should point to a concrete UI or toy behavior (see the mapping below).

## Feature-to-literature map

Use the following table to tie literature to specific features so citations are meaningful and traceable.

| Feature or behavior | UI surface | Recommended literature focus |
| --- | --- | --- |
| Audio-reactive visuals (frequency to motion/color mapping) | Toy descriptions, audio onboarding copy | Multisensory integration & audio-visual binding; crossmodal correspondences |
| “Synesthetic” or linked audio-visual patterns | Toy description for synesthetic-themed visuals | Crossmodal correspondences & synesthesia-related perception |
| Sensory exploration language (non-therapeutic) | Library landing copy, toy overview cards | Sensory processing differences in neurodiversity (framed as diversity, not treatment) |
| Music-driven engagement/affect | Demo audio option, descriptions referencing musical response | Music, rhythm, and affective engagement |

## UI citation/footnote guidance

If the UI references scientific grounding, use lightweight footnotes so users can inspect sources without cluttering the interface.

- **Footnote trigger**: Only add citations when a claim implies scientific backing (e.g., “audio-visual binding,” “crossmodal mapping,” or “sensory processing diversity”). Avoid citations for purely aesthetic language.
- **Placement**: Prefer a footnote marker in the toy description block, settings tooltip, or info panel. If a toy has a “Learn more” link, put citations there instead of inline.
- **Format**: Use numeric footnotes with a short bibliography in the same UI panel or a linked “Sources” drawer. Keep them readable on mobile.
- **Linking**: Use DOI links when available; otherwise link to the publisher or journal landing page.

## Multisensory integration & audio-visual binding

These sources describe how auditory and visual stimuli are combined, perceived, and bound in human perception—useful for explaining audio-reactive visuals.

- Stein, B. E., & Meredith, M. A. (1993). *The Merging of the Senses*. MIT Press.
- Shams, L., Kamitani, Y., & Shimojo, S. (2000). What you see is what you hear. *Nature*, 408(6814), 788.
- Spence, C. (2011). Crossmodal correspondences: A tutorial review. *Attention, Perception, & Psychophysics*, 73(4), 971–995.

## Crossmodal correspondences & synesthesia-related perception

Relevant when describing systematic mappings between audio properties (pitch, timbre, rhythm) and visual properties (color, motion, spatial position).

- Marks, L. E. (1978). *The Unity of the Senses*. Academic Press.
- Ward, J. (2008). *The Frog Who Croaked Blue: Synesthesia and the Mixing of the Senses*. Routledge.

## Sensory processing differences in neurodiversity

These references cover sensory modulation and processing differences commonly discussed in neurodiversity research. Use when talking about sensory experience diversity or accessibility.

- Ben-Sasson, A., et al. (2009). A meta-analysis of sensory modulation symptoms in individuals with autism spectrum disorders. *Journal of Autism and Developmental Disorders*, 39, 1–11.
- Baranek, G. T. (2002). Efficacy of sensory and motor interventions for children with autism. *Journal of Autism and Developmental Disorders*, 32(5), 397–422.

## Music, rhythm, and affective engagement

If describing how rhythmic or musical inputs shape engagement or emotional response, these sources provide grounding.

- Thaut, M. H. (2005). *Rhythm, Music, and the Brain*. Routledge.
- Juslin, P. N., & Västfjäll, D. (2008). Emotional responses to music: The need to consider underlying mechanisms. *Behavioral and Brain Sciences*, 31(5), 559–621.

## Multisensory environment control & sensory sovereignty

Grounds the accessibility research program in [`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md) — specifically the claim that user control over a sensory environment (not just its intensity) changes engagement/comfort outcomes. **Do not cite these for a UI-copy footnote implying therapeutic benefit** — Unwin et al. measured behavioral outcomes in a controlled study population, not a general product claim.

- Unwin, K. L., Powell, G., & Jones, C. R. G. (2021/2022). The use of Multi-Sensory Environments with autistic children: Exploring the effect of having control of sensory changes. *Autism*, 26(6), 1379–1394. https://doi.org/10.1177/13623613211050176 — N=41; compared self-controlled vs. automatically-cycling (not "adult-controlled") sensory-room equipment; self-control associated with more attention and fewer repetitive/stereotyped behaviors.
- Unwin, K. L., Powell, G., & Jones, C. R. G. (2021). Autism, sensory differences and the built environment: A content analysis of professional guidance. *Research in Developmental Disabilities*, 118, 104061. https://doi.org/10.1016/j.ridd.2021.104061
- Unwin, K. L., Powell, G., Price, F., & Jones, C. R. G. (2023). Equipment preferences and patterns of use in Multi-Sensory Environments. *Autism*, 28(3), 644–655. https://doi.org/10.1177/13623613231180266
- MacLennan, K., Woolley, C., Heasman, B., Starns, J., George, B., & Manning, C. (2023). "It Is a Big Spider Web of Things": Sensory Experiences of Autistic Adults in Public Spaces. *Autism in Adulthood*, 5(4), 411–422. https://doi.org/10.1089/aut.2022.0024 — N=24 focus groups; themes include Predictability and Adjustments.
- MacLennan, K., O'Brien, S., & Tavassoli, T. (2021). In Our Own Words: The Complex Sensory Experiences of Autistic Adults. *Journal of Autism and Developmental Disorders*, 52(7), 3061–3075. https://doi.org/10.1007/s10803-021-05186-3 — N=49 mixed-methods; themes include Control and Tolerance and management.
- MacLennan, K., Rossow, T., & Tavassoli, T. (2021). The relationship between sensory reactivity, intolerance of uncertainty and anxiety in autistic preschool children. *Autism*, 25(8), 2305–2316. https://doi.org/10.1177/13623613211016110

## Sensory processing: trait vs. context-dependent models

- Dunn, W. (1997). The Impact of Sensory Processing Abilities on the Daily Lives of Young Children and Their Families: A Conceptual Model. *Infants & Young Children*, 9(4), 23–35. — origin of the seeking/avoiding/sensitivity/low-registration 2×2 model; still the dominant clinical framework, typically operationalized as a stable trait.
- Metz, A. E., Boling, D., DeVore, A., Holladay, H., Liao, J. F., & Vander Vlutch, K. (2019). Dunn's Model of Sensory Processing: An Investigation of the Axes of the Four-Quadrant Model in Healthy Adults. *Brain Sciences*, 9(2), 35. https://doi.org/10.3390/brainsci9020035 — the behavioral-response axis doesn't hold up as a stable ordinal trait empirically.
- Williams, Z. J., et al. (2023). Examining the latent structure and correlates of sensory reactivity in autism: a multi-site integrative data analysis by the Autism Sensory Research Consortium. *Molecular Autism*, 14, 31. https://doi.org/10.1186/s13229-023-00563-4 — N=3,868; hyporeactivity and sensory-seeking do not cohere as unified cross-modality traits.
- Manning, C., Mohan, G., Maher, L., Khan, A., & Tyler, S. L. (2025). Our understanding of autistic sensory processing is limited by our questionnaire measures. *Autism*. https://doi.org/10.1177/13623613251356060
- Chen, Y., Xi, Z., Greene, T., & Mandy, W. (2025). A systematic review of ecological momentary assessment in autism research. *Autism*, 29(6), 1374–1389. https://doi.org/10.1177/13623613241305722

## Control, predictability, and tolerance of stimulation

General psychology, not sensory- or autism-specific unless noted — useful for the mechanism, not as a direct citation for a Stims-specific claim.

- Glass, D. C., & Singer, J. E. (1972). *Urban Stress: Experiments on Noise and Social Stressors*. Academic Press. — perceived control over unpredictable aversive noise reduces adverse aftereffects, even when the control is never exercised.
- Geer, J. H., Davison, G. C., & Gatchel, R. I. (1970). Reduction of stress in humans through nonveridical perceived control of aversive stimulation. *Journal of Personality and Social Psychology*, 16(4), 731–738. — the effect holds even with false/nonveridical belief of control.
- Corah, N. L., & Boffa, J. (1970). Perceived control, self-observation, and response to aversive stimulation. *Journal of Personality and Social Psychology*, 16, 1–4.
- Mineka, S., & Kihlstrom, J. F. (1978). Unpredictable and uncontrollable events: A new perspective on experimental neurosis. *Journal of Abnormal Psychology*, 87, 256–271. — standard citation separating predictability from controllability as related but distinct constructs.
- Sinha, P., et al. (2014). Autism as a disorder of prediction. *PNAS*, 111(42), 15220–15225. — theoretical framework linking impaired prediction to heightened distress from sensory events in autism; not itself a controllability experiment.
- **Gap, not a citation**: no study was found directly testing self-administered vs. externally-administered *sensory* stimulation tolerance in autistic/neurodivergent populations specifically — see `SENSORY_ACCESSIBILITY.md` for why this is the most promising open question for original work.

## Stimulation-seeking and optimal arousal

- Yerkes, R. M., & Dodson, J. D. (1908). The relation of strength of stimulus to rapidity of habit-formation. *Journal of Comparative Neurology and Psychology*, 18, 459–482. — foundational inverted-U arousal-performance model.
- Zentall, S. S., & Zentall, T. R. (1983). Optimal stimulation: A model of disordered activity and performance in normal and deviant children. *Psychological Bulletin*, 94(3), 446–471. — proposes stimulation-seeking behavior as homeostatic regulation toward an individual optimal level.
- Piccardi, E. S., & Gliga, T. (2022). Understanding sensory regulation in typical and atypical development: The case of sensory seeking. *Developmental Review*, 65, 101037. — modern review evaluating competing explanations for sensory seeking in neurodevelopmental populations, including autism.

## Audiovisual coherence and preference — evidence is mixed, lean skeptical

Relevant to any claim that tighter audio-visual coupling ("coherence") is preferred over looser coupling, independent of raw intensity. **The literature currently found argues against this**, not for it — see the caveat in `SENSORY_ACCESSIBILITY.md` before using these to support a coherence-driven design decision.

- Fink, L., Fiehn, H., & Wald-Fuhrmann, M. (2024). The role of audiovisual congruence in aesthetic appreciation of contemporary music and visual art. *Scientific Reports*, 14, 20923. https://doi.org/10.1038/s41598-024-71399-y — pre-registered, N=201; matched audiovisual pairs were rated more congruent but not more liked.
- Krzyzaniak, M., Erdem, Ç., & Glette, K. (2022). What makes interactive art engaging? *Frontiers in Computer Science*, 4, 859496. https://doi.org/10.3389/fcomp.2022.859496 — manipulated response timescale in interactive art; no effect on engagement duration, unlike controllable parameters and ascribed agency.
- Palmer, S. E., Schloss, K. B., Xu, Z., & Prado-León, L. R. (2013). Music-color associations are mediated by emotion. *PNAS*, 110(22), 8836–8841. — the clearest positive audiovisual-mapping result available, but it's about emotion-mediated color association, not a preference-for-coupling-strength test.
- Watson, J. S.; Gergely, G., & Watson, J. S. (1999). Early social-biofeedback development of self-exploration. — developmental contingency-detection literature; establishes humans have finely-tuned, graded preferences for responsive (contingent) feedback on *their own actions*. Cite only as motivating background for a coupling-strength hypothesis, not as direct evidence — these paradigms are about self-generated contingency, not passive audio-visual perception.

## Notes on scope

- This list is not exhaustive; it is a starter set aligned with the historical positioning captured in this document.
- Add new references as new claims or toy mechanics emerge (e.g., motion coupling, haptic feedback, or attention effects).
- For the accessibility/sensory-control research program specifically (research questions, flash-safety specification, roadmap), see [`SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md) — this file holds citations, that one holds the argument and status tracking.
