import { HEADER } from '../shared/csv';

export type Broker = 'ibkr' | 'canonical';

const TEMPLATE = [HEADER, '2025-01-02,DEPOSIT,,,,SGD,1000,0', '2025-01-02,FX,USD,740,,SGD,1000,0', ''].join('\n');

// Decision "Analyse page broker picker": also the list of supported formats.
export function BrokerPicker({ value, onChange }: { value: Broker; onChange: (b: Broker) => void }) {
  const option = (b: Broker, text: string) => (
    <label className="choice">
      <input type="radio" name="broker" checked={value === b} onChange={() => onChange(b)} />
      {text}
    </label>
  );
  const soon = (text: string) => (
    <label className="choice disabled">
      <input type="radio" name="broker" disabled />
      {text} <span className="soon">coming soon</span>
    </label>
  );
  return (
    <fieldset className="picker">
      <legend>Your broker file</legend>
      {option('ibkr', 'Interactive Brokers activity statement (CSV)')}
      {soon('Tiger Brokers')}
      {soon('moomoo')}
      <span className="picker-row">
        {option('canonical', 'Plain CSV')}
        <a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="honest-returns-template.csv">
          Download the template
        </a>
      </span>
    </fieldset>
  );
}
