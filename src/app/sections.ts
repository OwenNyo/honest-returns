// Spec 15.1.5: the Analyse sections, in page order. A section is rendered only when its data exists.
export const SECTIONS: { id: string; title: string }[] = [
  { id: 'returns', title: 'Returns' },
  { id: 'years', title: 'Year by year' },
  { id: 'risk', title: 'Largest fall and volatility' },
  { id: 'decomposition', title: 'Where the gain came from' },
  { id: 'dividends', title: 'Dividends' },
  { id: 'benchmark', title: 'Against a single fund' },
  { id: 'raw-prices', title: 'Why raw prices' },
];
