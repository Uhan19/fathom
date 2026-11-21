interface SwitchProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}

export function Switch({ label, checked, disabled, title, onChange }: SwitchProps) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" disabled={disabled} title={title} onClick={() => onChange(!checked)}>
      <span className="toggle-text">{label}</span>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </button>
  );
}
