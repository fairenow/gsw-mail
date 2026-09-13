export function SecondaryAccountButton({ onUse }: { onUse: () => void }) {
  return (
    <button type="button" className="gsw-btn gsw-btn-ghost" onClick={onUse}>
      Use another account
    </button>
  );
}