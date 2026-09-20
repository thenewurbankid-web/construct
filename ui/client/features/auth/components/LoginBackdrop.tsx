// Presentation-only: the full-screen slideshow behind the login card. Six real Cockpit screens crossfade
// in pure CSS (see `.login-backdrop` in globals.css); it is decoration, so it is hidden from assistive tech.
const SLIDES = [1, 2, 3, 4, 5, 6];

export function LoginBackdrop() {
  return (
    <div className="login-backdrop" aria-hidden="true" data-testid="login-backdrop">
      {SLIDES.map((n) => (
        <span key={n} className="login-backdrop__slide" style={{ backgroundImage: `url(/login/slide-${n}.webp)` }} />
      ))}
      <span className="login-backdrop__scrim" />
    </div>
  );
}
