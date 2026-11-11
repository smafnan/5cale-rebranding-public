import { LoaderCircle } from 'lucide-react';
import { useId, type ReactNode } from 'react';

import { cx } from '../lib/cx';
import type { SelectOption } from '../lib/devices';

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle className="spin" size={size} aria-hidden="true" />;
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  note?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, note, disabled, className }: SwitchProps) {
  const noteId = useId();
  return (
    <div className={cx('switch', disabled && 'is-disabled', className)}>
      <label className="switch__control">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={note ? noteId : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="switch__track" aria-hidden="true" />
        <span className="switch__label">{label}</span>
      </label>
      {note ? (
        <p className="field__note switch__note" id={noteId}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

interface SliderProps {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  note?: ReactNode;
  disabled?: boolean;
}

export function Slider({ label, value, min, max, step, format, onChange, note, disabled }: SliderProps) {
  const id = useId();
  const noteId = useId();
  return (
    <div className={cx('slider', disabled && 'is-disabled')}>
      <div className="slider__head">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        <output className="slider__value" htmlFor={id}>
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        aria-describedby={note ? noteId : undefined}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {note ? (
        <p className="field__note" id={noteId}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

interface SegmentedProps<T extends string> {
  /** Names the group for assistive technology; shown above the options unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  value: T;
  options: readonly { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

/** A small set of mutually exclusive options, built on native radio buttons. */
export function Segmented<T extends string>({
  label,
  hideLabel,
  value,
  options,
  onChange,
  disabled,
  className,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className={cx('segmented', className)} disabled={disabled}>
      <legend className={hideLabel ? 'visually-hidden' : 'field__label'}>{label}</legend>
      <div className="segmented__options">
        {options.map((option) => (
          <label key={option.value} className="segmented__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface SelectFieldProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** Shown next to the label, e.g. a "virtual cable" marker. */
  badge?: ReactNode;
  note?: ReactNode;
  disabled?: boolean;
  className?: string;
}

export function SelectField({ label, value, options, onChange, badge, note, disabled, className }: SelectFieldProps) {
  const id = useId();
  const noteId = useId();
  return (
    <div className={cx('field', className)}>
      <div className="field__head">
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
        {badge}
      </div>
      <select
        id={id}
        className="select"
        value={value}
        disabled={disabled}
        aria-describedby={note ? noteId : undefined}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {note ? (
        <p className="field__note" id={noteId}>
          {note}
        </p>
      ) : null}
    </div>
  );
}
