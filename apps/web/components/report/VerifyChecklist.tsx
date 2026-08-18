export function VerifyChecklist({ items }: { items: string[] }) {
  return (
    <section>
      <h2>What to verify yourself</h2>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </section>
  );
}
