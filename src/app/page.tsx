import LegalIntakeWidget from "@/components/LegalIntakeWidget";

export default function Home() {
  return (
    <main className="fixed inset-0 flex items-center justify-center pointer-events-none" style={{ background: 'transparent' }}>
      <div className="pointer-events-auto">
        <LegalIntakeWidget />
      </div>
    </main>
  );
}
