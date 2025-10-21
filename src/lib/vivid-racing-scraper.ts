// vivid-racing-scraper.ts
// Standalone scraper for Vivid Racing products
// Run with: tsx vivid-racing-scraper.ts

import * as cheerio from 'cheerio';

interface VividProduct {
  sku: string;
  url: string;
  title: string;
  description: string;
  price: number | null;
  imageUrl: string | null;
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  categoryPath: string;
  categoryName: string;
}

interface ScraperConfig {
  baseUrl: string;
  rateLimit: number; // milliseconds between requests
}

export class VividRacingScraper {
  private config: ScraperConfig = {
    baseUrl: 'https://www.vividracing.com',
    rateLimit: 1000, // 1 second between requests
  };

  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchHtml(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }
    return response.text();
  }

  /**
   * Scrape a single product page
   */
  async scrapeProduct(url: string): Promise<VividProduct | null> {
    try {
      const html = await this.fetchHtml(url);
      const $ = cheerio.load(html);

      // Extract SKU from URL (e.g., p-156664525)
      const skuMatch = url.match(/p-(\d+)/);
      if (!skuMatch) {
        console.error(`Could not extract SKU from URL: ${url}`);
        return null;
      }
      const sku = skuMatch[1];

      // Extract title
      const title = $('h1').first().text().trim() || 
                    $('meta[property="og:title"]').attr('content')?.trim() || 
                    '';

      // Extract description
      const description = $('meta[name="description"]').attr('content')?.trim() || 
                         $('meta[property="og:description"]').attr('content')?.trim() || 
                         '';

      // Extract image
      const imageUrl = $('meta[property="og:image"]').attr('content') || 
                      $('.product-image img').first().attr('src') || 
                      null;

      // Extract price (you'll need to adjust selector based on actual page structure)
      let price: number | null = null;
      const priceText = $('.product-price, .price, [itemprop="price"]').first().text();
      const priceMatch = priceText.match(/\$?([\d,]+\.?\d*)/);
      if (priceMatch) {
        price = parseFloat(priceMatch[1].replace(',', ''));
      }

      // Extract fitment data from table
      let make: string | undefined;
      let model: string | undefined;
      let yearFrom: number | undefined;
      let yearTo: number | undefined;

      $('table tr').each((_, row) => {
        const cells = $(row).find('td');
        if (cells.length >= 2) {
          const makeModel = $(cells[0]).text().trim();
          const modelText = $(cells[1]).text().trim();
          const yearText = $(cells[2]).text().trim();

          // Parse "1990-1997 Mazda Miata"
          const makeModelMatch = makeModel.match(/(\d{4})-(\d{4})\s+(\w+)\s+(.+)/);
          if (makeModelMatch) {
            yearFrom = parseInt(makeModelMatch[1]);
            yearTo = parseInt(makeModelMatch[2]);
            make = makeModelMatch[3];
          }

          if (modelText) {
            model = modelText;
          }
        }
      });

      // Extract category from breadcrumbs or URL
      let categoryPath = '';
      const categoryName = '';
      const categoryMatch = url.match(/-c-(\d+)\.html/);
      if (categoryMatch) {
        categoryPath = categoryMatch[1];
      }

      return {
        sku,
        url,
        title,
        description,
        price,
        imageUrl,
        make,
        model,
        yearFrom,
        yearTo,
        categoryPath,
        categoryName,
      };
    } catch (error) {
      console.error(`Error scraping product ${url}:`, error);
      return null;
    }
  }

  /**
   * Scrape a category page to get product URLs
   */
  async scrapeCategoryPage(categoryUrl: string): Promise<string[]> {
    try {
      const html = await this.fetchHtml(categoryUrl);
      const $ = cheerio.load(html);

      const productUrls: string[] = [];

      // Find all product links (adjust selector based on actual page structure)
      $('a[href*="-p-"]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          const fullUrl = href.startsWith('http') 
            ? href 
            : `${this.config.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
          
          // Only add if it's a product URL (contains -p-)
          if (fullUrl.includes('-p-') && !productUrls.includes(fullUrl)) {
            productUrls.push(fullUrl);
          }
        }
      });

      console.log(`Found ${productUrls.length} products in category ${categoryUrl}`);
      return productUrls;
    } catch (error) {
      console.error(`Error scraping category ${categoryUrl}:`, error);
      return [];
    }
  }

  /**
   * Scrape all products from a category
   */
  async scrapeCategoryProducts(categoryUrl: string): Promise<VividProduct[]> {
    console.log(`Scraping category: ${categoryUrl}`);
    
    // Get all product URLs from the category
    const productUrls = await this.scrapeCategoryPage(categoryUrl);
    
    const products: VividProduct[] = [];

    // Scrape each product (with rate limiting)
    for (const url of productUrls) {
      console.log(`Scraping product: ${url}`);
      const product = await this.scrapeProduct(url);
      
      if (product) {
        products.push(product);
      }

      // Rate limit
      await this.wait(this.config.rateLimit);
    }

    return products;
  }

  /**
   * Get all categories from the site
   */
  async scrapeCategories(): Promise<Array<{ name: string; url: string; path: string }>> {
    try {
      const html = await this.fetchHtml(this.config.baseUrl);
      const $ = cheerio.load(html);

      const categories: Array<{ name: string; url: string; path: string }> = [];

      // Find category links (adjust selector based on actual navigation structure)
      $('a[href*="-c-"]').each((_, element) => {
        const href = $(element).attr('href');
        const name = $(element).text().trim();
        
        if (href && name) {
          const fullUrl = href.startsWith('http') 
            ? href 
            : `${this.config.baseUrl}${href.startsWith('/') ? '' : '/'}${href}`;
          
          // Extract category ID from URL
          const pathMatch = href.match(/-c-(\d+)\.html/);
          if (pathMatch) {
            categories.push({
              name,
              url: fullUrl,
              path: pathMatch[1],
            });
          }
        }
      });

      return categories;
    } catch (error) {
      console.error('Error scraping categories:', error);
      return [];
    }
  }
}

// Example usage
async function main() {
  const scraper = new VividRacingScraper();

  // Example 1: Scrape a single product
  const product = await scraper.scrapeProduct(
    'https://www.vividracing.com/19901997-mazda-miata-duraflex-energon-rear-taillight-trim-piece-p-156664525.html'
  );
  console.log('Single product:', product);

  // Example 2: Scrape all products from a category
  const categoryProducts = await scraper.scrapeCategoryProducts(
    'https://www.vividracing.com/light_covers-c-16602.html'
  );
  console.log(`Scraped ${categoryProducts.length} products from category`);

  // Example 3: Get all categories
  const categories = await scraper.scrapeCategories();
  console.log(`Found ${categories.length} categories`);
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}