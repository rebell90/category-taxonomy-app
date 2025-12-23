// app/dashboard/page.tsx
import Link from 'next/link'

export default function DashboardHome() {
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Catalog Tools</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <Link 
          href="/dashboard/audit" 
          className="block border border-slate-200 bg-white rounded-lg p-5 hover:shadow-md transition-shadow"
        >
          <div className="text-lg text-slate-900 font-semibold">Product + Category View</div>
          <p className="text-sm text-slate-600 mt-1">
            See which products have <code className="bg-slate-100 px-1 rounded">taxonomy.category_slugs</code> set. Filter/search/paginate.
          </p>
        </Link>

        <Link 
          href="/dashboard/fit-terms" 
          className="block border border-slate-200 bg-white rounded-lg p-5 hover:shadow-md transition-shadow"
        >
          <div className="text-lg text-slate-900 font-semibold">Fitment Terms</div>
          <p className="text-sm text-slate-600 mt-1">
            Add fitment terms and values.
          </p>
        </Link>

        <Link 
          href="/dashboard/fitments-audit" 
          className="block border border-slate-200 bg-white rounded-lg p-5 hover:shadow-md transition-shadow"
        >
          <div className="text-lg text-slate-900 font-semibold">Fitment + Products</div>
          <p className="text-sm text-slate-600 mt-1">
            Assign fitments to products.
          </p>
        </Link>
        
        <Link 
          href="/dashboard/categories" 
          className="block border border-slate-200 bg-white rounded-lg p-5 hover:shadow-md transition-shadow"
        >
          <div className="text-lg text-slate-900 font-semibold">Manage Category Tree</div>
          <p className="text-sm text-slate-600 mt-1">
            Add, update, or delete categories and nested-subcategories.
          </p>
        </Link>

        <Link 
          href="/dashboard/distributors" 
          className="block border border-slate-200 bg-white rounded-lg p-5 hover:shadow-md transition-shadow"
        >
          <div className="text-lg text-slate-900 font-semibold">Distributor Import</div>
          <p className="text-sm text-slate-600 mt-1">
            Distributor Import
          </p>
        </Link>
      </div>
    </div>
  )
}