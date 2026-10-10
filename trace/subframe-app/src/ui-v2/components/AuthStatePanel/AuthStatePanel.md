# AuthStatePanel

The right-hand panel of every MAX authentication screen. It carries the whole panel — the split-screen page supplies only the editorial aside on the left and drops this in on the right.

## When to use it

Use it for any screen where MAX is **telling the user where they stand** in getting into the product: a link is dead, an account is already active, access is awaiting approval, a code needs entering, MFA is paused.

Do **not** use it for the two primary credential screens — Sign In, and Create your MAX password. Those use the panel-with-header pattern instead (an `h5` title, a subtitle, a rule, then the form). The distinction is deliberate: a header-and-rule panel reads as "do the normal thing", the state panel reads as "something specific happened, here is what it is".

## Eyebrow, title, body — what each carries

The three-part copy stack is the whole point of the component, and each line has a job:

- **Eyebrow** names the *situation*, not the action — "Link unavailable", "Access pending", "Identity verification", "Security setup". Two or three words, sentence case. It is the only indigo text in the header, so it is what the eye lands on first. Reuse an existing eyebrow when the screen belongs to the same episode: all four MFA challenge screens share "Identity verification", both MFA enrolment screens share "Security setup".
- **Title** is the plain-language statement of fact, in the user's frame — "This account is already active", not "Activation conflict". Keep it to one line at 520px where you can.
- **Body** explains the cause *and* names the way forward in the same breath, in at most two sentences. It repeats the primary action's intent in prose so the screen still reads if the button is missed.

## Actions

The primary action is always the single highest-value recovery step, and it is always the dark button — never the brand gradient. The gradient is reserved for the one screen that is a genuine forward step into the product (Account ready → "Personalize MAX"); using it here would promise progress the user has not earned yet.

Hide the secondary action (`hideSecondaryAction`) when there is genuinely only one way forward. "Password reset complete" has no secondary link because signing in is the only thing left to do. Do not add "Back to sign in" as filler.

Secondary actions are indigo text, never a second button. Two buttons on a recovery screen makes the user choose when they should be nudged.

## Support note

The bottom-pinned note is where the **organization boundary** gets stated. MAX is deployed into someone else's identity estate, so recovery screens must be honest about what MAX cannot do: it cannot approve access, cannot bypass MFA, cannot change roles or permissions. Say so plainly and point at the org's MAX administrator.

It is also the place for time limits ("The link expires in 30 minutes") and reference codes ("Share reference MAX-SSO-2048"). Never put a time limit only in the body — users scan the note for it.

## Content slot

`showContent` opens a slot between the copy and the actions, for screens that need input rather than just acknowledgement: a verification-code field, method radio cards, a QR code, a recovery-code grid, or an `AuthStatusCard` for live state. Keep it to one idea — if a screen needs a form with several labelled fields, it wants the header panel pattern, not this one.

## Don'ts

- Don't put an error colour in the eyebrow or title. Recovery screens are neutral in tone; red is reserved for a field that is actively failing validation and for the destructive `Sign out` link.
- Don't drop the signal mark on a screen that has no other MAX branding — it is the only mark on the panel side, and the aside is hidden at mobile.
- Don't stack two `AuthStatusCard`s in the content slot. One status, one screen.