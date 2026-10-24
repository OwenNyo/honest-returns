// Spec 15.1.5: plain anchor links to the sections present; rendered only when there are two or more.
export function SectionList({ sections }: { sections: { id: string; title: string }[] }) {
  if (sections.length < 2) return null;
  return (
    <nav className="section-list" aria-label="Sections">
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`}>
          {s.title}
        </a>
      ))}
    </nav>
  );
}
