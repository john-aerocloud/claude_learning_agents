import type { Cell as CellValue } from './engine';
import { Cell } from './Cell';

interface BoardProps {
  board: CellValue[];
  onSelect: (index: number) => void;
  locked: boolean;
}

/** The 3×3 grid. Maps the board array to nine Cells and forwards the lock. */
export function Board({ board, onSelect, locked }: BoardProps) {
  return (
    <div className="board" role="grid" aria-label="game board">
      {board.map((value, index) => (
        <Cell
          key={index}
          value={value}
          index={index}
          onSelect={onSelect}
          disabled={locked}
        />
      ))}
    </div>
  );
}
