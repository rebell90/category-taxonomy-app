import Link from 'next/link'

export default function Home() {
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Welcome</h1>
      <p>Head to your taxonomy dashboard:</p>
      <Link href="/dashboard/categories" className="text-blue-600 underline">
        Open Taxonomy Dashboard
      </Link>
    </main>
  )
}