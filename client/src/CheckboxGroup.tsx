interface Props {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}

export function CheckboxGroup({ label, options, selected, onChange }: Props) {
  function toggle(option: string) {
    onChange(selected.includes(option) ? selected.filter((o) => o !== option) : [...selected, option]);
  }

  return (
    <div className="checkbox-group">
      <div className="checkbox-group-label">{label}</div>
      <div className="checkbox-group-options">
        {options.map((o) => (
          <label key={o} className="checkbox-option">
            <input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />
            {o}
          </label>
        ))}
      </div>
    </div>
  );
}
