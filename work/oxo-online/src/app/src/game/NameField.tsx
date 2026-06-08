import { MAX_NAME_LEN } from './name';

/**
 * spa-name-field — the "Your name" arcade-tag input (s009 UC1).
 *
 * Presentational + controlled: the value, the "AAA"/sessionStorage default, and
 * persistence are GameRoot's (R1.3). This component renders only the labelled
 * input and reports edits, so it is trivially unit-testable and carries the
 * stable selectors the tester keys off:
 *   - role textbox, accessible name "Your name" (A11Y-1 via <label for>)
 *   - data-testid="name-input"
 *
 * It sits ABOVE the mode buttons in the idle view and NEVER gates play — the
 * default makes it ignorable (click-path budget, ui-design BINDING).
 */
interface NameFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** True while a create/join is in flight (input read-only meanwhile). */
  disabled?: boolean;
}

export function NameField({ value, onChange, disabled }: NameFieldProps) {
  return (
    <div className="name-field">
      <label htmlFor="name-input">Your name</label>
      <input
        id="name-input"
        data-testid="name-input"
        type="text"
        className="name-input"
        maxLength={MAX_NAME_LEN}
        autoComplete="off"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
