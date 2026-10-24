import type { FlowTiming } from '../engine/types';

export function TimingToggle({ value, onChange }: { value: FlowTiming; onChange: (t: FlowTiming) => void }) {
  const option = (t: FlowTiming, text: string) => (
    <label className="choice">
      <input type="radio" name="flow-timing" checked={value === t} onChange={() => onChange(t)} />
      {text}
    </label>
  );
  return (
    <fieldset className="timing">
      <legend>Count deposits and withdrawals at the</legend>
      {option('start', 'Start of the day')}
      {option('end', 'End of the day')}
    </fieldset>
  );
}
