export function PrimarySignInButton({ disabled, onStart }: { disabled: boolean; onStart: () => void }) {
  return (
    <button
      type="button"
      className="gsw-btn gsw-btn-primary gsw-btn-block gsw-btn-lg"
      disabled={disabled}
      onClick={onStart}
    >
      <span>Sign in with Guided Steps</span>
      <span className="gsw-btn-arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}