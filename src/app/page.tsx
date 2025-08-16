import Link from 'next/link'

export default function Home() {
  return (
    <main className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Welcome</h1>
      <p>Head to your taxonomy dashboard:</p>
      <Link href="/dashboard" className="text-blue-600 underline">
        Open Taxonomy Dashboard
      </Link>
    </main>
  )
}