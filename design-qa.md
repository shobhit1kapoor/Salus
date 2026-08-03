# Salus landing page design QA

## Review target

- Source visual truth: `C:\Users\shobh\.codex\generated_images\019fc30a-f5b5-7390-9aff-da3d21114b2c\exec-b3ad6448-8308-4427-a0b6-6138745107f9.png`
- Browser-rendered implementation: `C:\Users\shobh\OneDrive\Documents\Salas\.codex-audit\landing-option-3\desktop-final.png`
- Normalized side-by-side comparison: `C:\Users\shobh\OneDrive\Documents\Salas\.codex-audit\landing-option-3\design-comparison.png`
- Source pixels: 1488 × 1058
- Implementation pixels: 1584 × 889
- Viewport and normalization: desktop Codex in-app browser; each artifact was proportionally contained within an equal 760 × 570 comparison region without stretching.
- State: signed-out public landing page with the option 3 hero video loaded.

## Findings

No actionable P0, P1, or P2 differences remain. The implementation preserves option 3's patient-first narrative, split dark/cinematic hero, violet conversion actions, editorial serif hierarchy, caregiver utility row, and protected-operation evidence panel. The implementation viewport is shorter than the source board, so the panel continues below the captured fold; this is an expected viewport difference rather than hidden or clipped page content.

## Required fidelity surfaces

- Fonts and typography: Instrument Serif carries the two-line editorial headline and panel headings. Sans-serif navigation, descriptions, control labels, and evidence metadata retain the source's compact optical weight and hierarchy.
- Spacing and layout rhythm: the capsule navigation, left-aligned copy, dual actions, trust markers, right-side cinematic subject, and wide two-column evidence panel follow the source order and alignment. The wider final grid prevents the headline and pipeline labels from wrapping incorrectly.
- Colors and visual tokens: the near-black-to-blue canvas, violet primary actions, mint protection states, restrained white borders, and translucent glass surfaces match the selected direction.
- Image quality and asset fidelity: the supplied cinematic person-over-clouds video is used as the real hero asset with a left-side readability gradient and a focal crop that keeps the subject away from the copy. Lucide provides the consistent line-icon family; no placeholder, CSS-drawn, or handcrafted SVG imagery is present.
- Copy and content: the hero accurately describes patient/caregiver workflows and states that raw identifiers and unprotected sensitive values are protected before storage or AI processing. The evidence panel explicitly states that the AI receives pseudonymized, minimum-necessary clinical context.
- Responsiveness and accessibility: navigation simplifies, care features reflow, the operation pipeline becomes horizontally scrollable, and cards stack at smaller breakpoints. Links remain semantic and keyboard reachable; headings and lists are labelled; videos are decorative and honor reduced motion.

## Interaction and runtime evidence

- “Create a health profile” was tested and resolves to `/login` for a signed-out visitor.
- “Explore privacy proof” was tested and resolves to `/#evidence`.
- Navigation, workspace, caregiver, protection, and evidence links remain functional.
- Browser console errors checked: none.

## Comparison history

1. First option 3 pass: the headline wrapped to three lines, the hero subject sat too close to the copy, and the trust markers collided with the evidence panel. These were P2 hierarchy and spacing issues.
2. Second pass: the copy width and display scale were corrected to restore the source's two-line headline; the navigation and evidence panel were widened to match the source frame; the hero focal crop was moved right.
3. Final pass: the evidence panel was moved below the trust markers, preserving the intended hierarchy, while the hero overflow and following section spacing keep the panel fully reachable. The post-fix side-by-side comparison shows no actionable P0/P1/P2 mismatch.

Focused-region comparison was not required beyond the full hero comparison because the source and implementation both render the navigation, headline, actions, trust markers, utility icons, pipeline labels, and glass-panel boundaries clearly at the normalized comparison size; each full-resolution image was also inspected independently.

final result: passed
