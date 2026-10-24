// Spec 15.4.1: the files in the set, earliest first, with the period each covers.
export function FileList({ periods }: { periods: { name: string; from: string; to: string }[] }) {
  return (
    <ul className="file-list">
      {periods.map((p) => (
        <li key={p.name + p.from}>
          {p.name}: {p.from} to {p.to}
        </li>
      ))}
    </ul>
  );
}
