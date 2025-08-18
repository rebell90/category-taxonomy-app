export default function DashboardHome() {
  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Catalog Tools</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <a href="/dashboard/audit" className="block border rounded-lg p-5 hover:shadow">
          <div className="text-lg text-gray-600 font-semibold">Product + Category View</div>
          <p className="text-sm text-gray-600 mt-1">
            See which products have <code>taxonomy.category_slugs</code> set. Filter/search/paginate.
          </p>
        </a>

        <a href="/dashboard/tree" className="block border rounded-lg p-5 hover:shadow">
          <div className="text-lg text-gray-600 font-semibold">View Category Tree</div>
          <p className="text-sm text-gray-600 mt-1">
            Tree-view of category taxonomy.
          </p>
        </a>

        <a href="/dashboard/categories" className="block border rounded-lg p-5 hover:shadow">
          <div className="text-lg text-gray-600 font-semibold">Manage Category Tree</div>
          <p className="text-sm text-gray-600 mt-1">
            Add, update, or delete categories and nested-subcategories.
          </p>
        </a>

        <a href="/dashboard/assign" className="block border rounded-lg p-5 hover:shadow">
          <div className="text-lg text-gray-600 font-semibold">Assign Products to Categories</div>
          <p className="text-sm text-gray-600 mt-1">
            Link products to category slugs using your taxonomy.
          </p>
        </a>
      </div>
    </div>
  );
}