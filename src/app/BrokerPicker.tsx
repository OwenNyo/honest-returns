import type { ReactNode } from 'react';
import { HEADER } from '../shared/csv';

export type Broker = 'ibkr' | 'canonical';

const TEMPLATE = [HEADER, '2025-01-02,DEPOSIT,,,,SGD,1000,0', '2025-01-02,FX,USD,740,,SGD,1000,0', ''].join('\n');

// Decision "Analyse page broker picker": also the list of supported formats.
// Tiles are labels around visually hidden radios, so the group keeps native keyboard and screen-reader behaviour.
export function BrokerPicker({ value, onChange }: { value: Broker; onChange: (b: Broker) => void }) {
  const option = (b: Broker, text: string, extra?: ReactNode) => (
    <label className="tile">
      <input className="visually-hidden" type="radio" name="broker" checked={value === b} onChange={() => onChange(b)} />
      <span className="tile-name">{text}</span>
      {extra}
    </label>
  );
  const soon = (text: string) => (
    <label className="tile disabled">
      <input className="visually-hidden" type="radio" name="broker" disabled />
      <span className="tile-name">{text}</span>
      <span className="tile-note">coming soon</span>
    </label>
  );
  return (
    <fieldset className="picker">
      <legend>Your broker file</legend>
      {option('ibkr', 'Interactive Brokers activity statement')}
      {option(
        'canonical',
        'Plain CSV',
        <a className="tile-note" href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="honest-returns-template.csv">
          Download the template
        </a>,
      )}
      {soon('Tiger Brokers')}
      {soon('moomoo')}
    </fieldset>
  );
}
