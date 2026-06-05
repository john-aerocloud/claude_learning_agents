import type { Cell as CellValue } from './engine';

interface CellProps {
  value: CellValue;
  index: number;
  onSelect: (index: number) => void;
  disabled?: boolean;
}

/**
 * A single board square. Renders its value as plain JSX text content (never as
 * raw HTML), and reports clicks by index. Disabled once it holds a symbol or
 * when the board is locked.
 */
export function Cell({ value, index, onSelect, disabled = false }: CellProps) {
  return (
    <button
      type="button"
      className="cell"
      aria-label={`cell ${index}`}
      disabled={disabled || value !== null}
      onClick={() => onSelect(index)}
    >
      {value ?? ''}
    </button>
  );
}
