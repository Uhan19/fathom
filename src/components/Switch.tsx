interface SwitchProps {
  control: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  title?: string;
  onChange: (checked: boolean) => void;
}

export function Switch({ control, label, checked, disabled, title, onChange }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="switch"
      data-part="switch"
      data-control={control}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-text" data-part="toggle-text">{label}</span>
      <span className="switch-track" data-part="switch-track" aria-hidden="true">
        <span className="switch-knob" data-part="switch-knob" />
      </span>
    </button>
  );
}
