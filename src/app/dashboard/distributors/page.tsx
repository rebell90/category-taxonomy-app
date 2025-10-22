// src/app/dashboard/distributors/page.tsx
'use client';

import { useState, useEffect } from 'react';

interface DistributorCategory {
  id: string;
  distributorPath: string;
  distributorName: string;
  categoryId: string | null;
  category: {
    id: string;
    title: string;
    slug: string;
  } | null;
}

interface DistributorProduct {
  id: string;
  distributorSku: string;
  title: string;
  description: string | null;
  price: number | null;
  imageUrl: string | null;
  shopifyProductGid: string | null;
  importedAt: string | null;
  distributorUrl: string;
}

interface Category {
  id: string;
  title: string;
  slug: string;
  children?: Category[];
}

export default function DistributorsPage() {
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'scrape' | 'categories' | 'products'>('scrape');
  const [testProduct, setTestProduct] = useState<DistributorProduct | null>(null);
  
  // Categories state
  const [distributorCategories, setDistributorCategories] = useState<DistributorCategory[]>([]);
  const [yourCategories, setYourCategories] = useState<Category[]>([]);
  const [selectedDistCat, setSelectedDistCat] = useState<string | null>(null);
  
  // Products state
  const [products, setProducts] = useState<DistributorProduct[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [showImported, setShowImported] = useState(false);

  // Load your taxonomy categories
  useEffect(() => {
    loadYourCategories();
  }, []);

  // Load distributor categories when tab changes
  useEffect(() => {
    if (activeTab === 'categories') {
      loadDistributorCategories();
    } else if (activeTab === 'products') {
      loadProducts();
    }
  }, [activeTab, showImported]);

  async function loadYourCategories() {
    try {
      const res = await fetch('/api/categories');
      const data = await res.json();
      setYourCategories(data);
    } catch (error) {
      console.error('Failed to load categories:', error);
      alert('Failed to load your categories');
    }
  }

  async function loadDistributorCategories() {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/distributors/list?type=categories');
      const data = await res.json();
      setDistributorCategories(data.categories || []);
    } catch (error) {
      console.error('Failed to load distributor categories:', error);
      alert('Failed to load distributor categories');
    } finally {
      setLoading(false);
    }
  }

  async function loadProducts() {
    setLoading(true);
    try {
      const url = `/api/admin/distributors/list?type=products&imported=${showImported}`;
      const res = await fetch(url);
      const data = await res.json();
      setProducts(data.products || []);
    } catch (error) {
      console.error('Failed to load products:', error);
      alert('Failed to load products');
    } finally {
      setLoading(false);
    }
  }

  async function scrapeCategories() {
    if (!confirm('Scrape all categories from Vivid Racing? This may take a few minutes.')) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/distributors/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'categories' }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`Success! Scraped ${data.categoriesFound} categories`);
        loadDistributorCategories();
      } else {
        alert('Failed to scrape categories');
      }
    } catch (error) {
      console.error('Scrape error:', error);
      alert('Failed to scrape categories');
    } finally {
      setLoading(false);
    }
  }

  async function scrapeCategory() {
    const url = prompt('Enter Vivid Racing category URL:\n(e.g., https://www.vividracing.com/light_covers-c-16602.html)');
    if (!url) return;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/distributors/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'category',
          categoryUrl: url 
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`Success! Scraped ${data.productsScraped} products`);
        if (activeTab === 'products') loadProducts();
      } else {
        alert('Failed to scrape category');
      }
    } catch (error) {
      console.error('Scrape error:', error);
      alert('Failed to scrape category');
    } finally {
      setLoading(false);
    }
  }

  async function scrapeProduct() {
    const url = prompt('Enter Vivid Racing product URL:\n(e.g., https://www.vividracing.com/...-p-123456.html)');
    if (!url) return;

    setLoading(true);
    setTestProduct(null);
    try {
      const res = await fetch('/api/admin/distributors/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          action: 'product',
          productUrl: url 
        }),
      });
      const data = await res.json();
      
      if (data.success && data.product) {
        alert('Success! Product scraped - see preview below');
        // Show the scraped product
        setTestProduct({
          id: 'preview',
          distributorSku: data.product.sku,
          title: data.product.title,
          description: data.product.description,
          price: data.product.price,
          imageUrl: data.product.imageUrl,
          distributorUrl: data.product.url,
          shopifyProductGid: null,
          importedAt: null,
        });
        if (activeTab === 'products') loadProducts();
      } else {
        alert('Failed to scrape product');
      }
    } catch (error) {
      console.error('Scrape error:', error);
      alert('Failed to scrape product');
    } finally {
      setLoading(false);
    }
  }

  async function mapCategory(distributorCategoryId: string, yourCategoryId: string | null) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/distributors/map-category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributorCategoryId,
          categoryId: yourCategoryId,
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert('Category mapping saved!');
        loadDistributorCategories();
      } else {
        alert('Failed to save mapping');
      }
    } catch (error) {
      console.error('Map error:', error);
      alert('Failed to save mapping');
    } finally {
      setLoading(false);
    }
  }

  async function importToShopify() {
    if (selectedProducts.size === 0) {
      alert('Please select products to import');
      return;
    }

    if (!confirm(`Import ${selectedProducts.size} products to Shopify?`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/admin/distributors/import-to-shopify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          distributorProductIds: Array.from(selectedProducts),
        }),
      });
      const data = await res.json();
      
      if (data.success) {
        alert(`Success!\nImported: ${data.imported}\nFailed: ${data.failed}`);
        setSelectedProducts(new Set());
        loadProducts();
      } else {
        alert('Failed to import products');
      }
    } catch (error) {
      console.error('Import error:', error);
      alert('Failed to import products');
    } finally {
      setLoading(false);
    }
  }

  function toggleProductSelection(productId: string) {
    const newSet = new Set(selectedProducts);
    if (newSet.has(productId)) {
      newSet.delete(productId);
    } else {
      newSet.add(productId);
    }
    setSelectedProducts(newSet);
  }

  function selectAllProducts() {
    const unimportedProducts = products.filter(p => !p.shopifyProductGid);
    setSelectedProducts(new Set(unimportedProducts.map(p => p.id)));
  }

  function renderCategoryOptions(categories: Category[], depth = 0): React.ReactElement[] {
    const options: React.ReactElement[] = [];
    
    categories.forEach(cat => {
      const prefix = '—'.repeat(depth);
      options.push(
        <option key={cat.id} value={cat.id}>
          {prefix} {cat.title}
        </option>
      );
      
      if (cat.children && cat.children.length > 0) {
        options.push(...renderCategoryOptions(cat.children, depth + 1));
      }
    });
    
    return options;
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Distributor Product Import</h1>

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b">
        <button
          onClick={() => setActiveTab('scrape')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'scrape'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Scrape Data
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'categories'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Map Categories
        </button>
        <button
          onClick={() => setActiveTab('products')}
          className={`px-4 py-2 font-medium ${
            activeTab === 'products'
              ? 'border-b-2 border-blue-500 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Import Products
        </button>
      </div>

      {loading && (
        <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded mb-4">
          Loading...
        </div>
      )}

      {/* Scrape Tab */}
      {activeTab === 'scrape' && (
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Step 1: Scrape Categories</h2>
            <p className="text-gray-600 mb-4">
              First, scrape all categories from Vivid Racing to see what&apos;s available.
            </p>
            <button
              onClick={scrapeCategories}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Scrape All Categories
            </button>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Step 2: Scrape Products</h2>
            <p className="text-gray-600 mb-4">
              Scrape products from a specific category page.
            </p>
            <button
              onClick={scrapeCategory}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Scrape Category Products
            </button>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Test Single Product Scraper</h2>
            <p className="text-gray-600 mb-4">
              Test the scraper on a single product URL to see what data gets extracted.
            </p>
            <button
              onClick={scrapeProduct}
              disabled={loading}
              className="bg-gray-600 text-white px-6 py-2 rounded hover:bg-gray-700 disabled:opacity-50"
            >
              Test Scrape Single Product
            </button>
            
            {testProduct && (
              <div className="mt-6 p-4 border rounded-lg bg-gray-50">
                <h3 className="font-semibold text-lg mb-2">Scraped Preview:</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Title:</p>
                    <p className="text-sm">{testProduct.title}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">SKU:</p>
                    <p className="text-sm">{testProduct.distributorSku}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Price:</p>
                    <p className="text-sm">${testProduct.price || 'Not found'}</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">Image:</p>
                    {testProduct.imageUrl ? (
                      <img src={testProduct.imageUrl} alt={testProduct.title} className="w-20 h-20 object-cover" />
                    ) : (
                      <p className="text-sm text-red-500">Not found</p>
                    )}
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm font-medium text-gray-500 mb-1">Description Length:</p>
                    <p className="text-sm">{testProduct.description?.length || 0} characters</p>
                  </div>
                  <div className="col-span-2">
                    <details className="text-sm">
                      <summary className="font-medium text-gray-500 cursor-pointer">Full Description (click to expand)</summary>
                      <div className="mt-2 p-2 bg-white border rounded max-h-96 overflow-y-auto">
                        <pre className="text-xs whitespace-pre-wrap">{testProduct.description}</pre>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Categories Tab */}
      {activeTab === 'categories' && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b">
            <h2 className="text-xl font-semibold">Map Vivid Racing Categories to Your Taxonomy</h2>
            <p className="text-gray-600 mt-2">
              {distributorCategories.length} categories found. 
              {distributorCategories.filter(c => c.categoryId).length} mapped.
            </p>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Vivid Racing Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Your Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {distributorCategories.map(distCat => (
                  <tr key={distCat.id}>
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">
                        {distCat.distributorName}
                      </div>
                      <div className="text-xs text-gray-500">
                        ID: {distCat.distributorPath}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {distCat.category ? (
                        <div className="text-sm text-gray-900">
                          {distCat.category.title}
                          <span className="text-gray-500"> ({distCat.category.slug})</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">Not mapped</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={distCat.categoryId || ''}
                        onChange={(e) => mapCategory(distCat.id, e.target.value || null)}
                        className="text-sm border border-gray-300 rounded px-2 py-1"
                      >
                        <option value="">-- Select Category --</option>
                        {renderCategoryOptions(yourCategories)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Products Tab */}
      {activeTab === 'products' && (
        <div className="space-y-4">
          <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={showImported}
                  onChange={(e) => setShowImported(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Show imported products</span>
              </label>
              
              <button
                onClick={selectAllProducts}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Select all unimported
              </button>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {selectedProducts.size} selected
              </span>
              <button
                onClick={importToShopify}
                disabled={loading || selectedProducts.size === 0}
                className="bg-green-600 text-white px-6 py-2 rounded hover:bg-green-700 disabled:opacity-50"
              >
                Import to Shopify
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="grid grid-cols-1 gap-4 p-4">
              {products.map(product => (
                <div
                  key={product.id}
                  className={`border rounded-lg p-4 flex items-start gap-4 ${
                    product.shopifyProductGid ? 'bg-gray-50' : ''
                  }`}
                >
                  {!product.shopifyProductGid && (
                    <input
                      type="checkbox"
                      checked={selectedProducts.has(product.id)}
                      onChange={() => toggleProductSelection(product.id)}
                      className="mt-1"
                    />
                  )}
                  
                  {product.imageUrl && (
                    <img
                      src={product.imageUrl}
                      alt={product.title}
                      className="w-20 h-20 object-cover rounded"
                    />
                  )}
                  
                  <div className="flex-1">
                    <h3 className="font-medium text-gray-900">{product.title}</h3>
                    <div className="text-sm text-gray-600 mt-1">
                      SKU: {product.distributorSku}
                      {product.price && <span className="ml-4">Price: ${product.price}</span>}
                    </div>
                    <a
                      href={product.distributorUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                    >
                      View on Vivid Racing →
                    </a>
                  </div>
                  
                  {product.shopifyProductGid && (
                    <div className="text-sm">
                      <span className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded">
                        ✓ Imported
                      </span>
                      <div className="text-xs text-gray-500 mt-1">
                        {new Date(product.importedAt!).toLocaleDateString()}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}