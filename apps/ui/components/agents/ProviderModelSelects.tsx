"use client";

export interface ProviderSelectOption {
  id: string;
  label: string;
  disabled?: boolean;
  title?: string;
}

export function ProviderSelect({
  label,
  value,
  options,
  onChange,
  disabled,
  defaultOption,
}: {
  label: string;
  value: string;
  options: readonly ProviderSelectOption[];
  onChange: (provider: string) => void;
  disabled?: boolean;
  defaultOption?: string;
}) {
  return (
    <label className="text-sm">
      {label}
      <select
        className="input mt-1 w-full"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {defaultOption !== undefined ? <option value="">{defaultOption}</option> : null}
        {options.map((option) => (
          <option key={option.id} value={option.id} disabled={option.disabled} title={option.title}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ModelSelect({
  label,
  value,
  models,
  onChange,
  disabled,
  defaultOption = "Agent default",
}: {
  label: string;
  value: string;
  models: readonly string[];
  onChange: (model: string) => void;
  disabled?: boolean;
  defaultOption?: string;
}) {
  const unavailable = value && !models.includes(value);
  return (
    <label className="text-sm">
      {label}
      <select
        className="input mt-1 w-full"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{defaultOption}</option>
        {unavailable ? <option value={value} disabled>{value} — not available</option> : null}
        {models.map((model) => <option key={model} value={model}>{model}</option>)}
      </select>
    </label>
  );
}
