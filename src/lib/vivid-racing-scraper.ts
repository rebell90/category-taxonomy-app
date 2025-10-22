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

      // Extract description - get the ACTUAL product description content
      let description = '';
      const contentSections: string[] = [];
      
      // Strategy: Look for the main product content area
      // Vivid Racing typically has product description in specific divs
      
      // Try to find main product description container
      const descriptionContainers = [
        '.product-description',
        '.product-details',
        '#product-description',
        '.description',
        '[itemprop="description"]',
      ];
      
      let foundMainContent = false;
      for (const selector of descriptionContainers) {
        const container = $(selector);
        if (container.length > 0) {
          const html = container.html();
          if (html && html.length > 100) {
            description = html;
            foundMainContent = true;
            break;
          }
        }
      }
      
      // If no dedicated description container, extract ALL meaningful content
      if (!foundMainContent) {
        // Get everything from the body, but skip navigation/header/footer
        $('body').find('h1, h2, h3, h4, p, ul, ol').each((_, elem) => {
          const $elem = $(elem);
          const text = $elem.text().trim();
          
          // Skip if it's in navigation, header, footer, or sidebar
          const parents = $elem.parents().map((_, p) => $(p).attr('class') || '').get().join(' ');
          if (parents.includes('nav') || parents.includes('header') || 
              parents.includes('footer') || parents.includes('sidebar')) {
            return;
          }
          
          // Skip legal/policy content
          if (text.includes('Complete a the') || 
              text.includes('Vivid Racing Return') ||
              text.includes('Shipping Claim') ||
              text.includes('warranty claim') ||
              text.length < 30) {
            return;
          }
          
          const tagName = $elem.prop('tagName')?.toLowerCase();
          
          // Get the outer HTML to preserve formatting
          if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3' || tagName === 'h4') {
            contentSections.push(`<${tagName}>${text}</${tagName}>`);
          } else if (tagName === 'ul' || tagName === 'ol') {
            const listHtml = $elem.html();
            if (listHtml) {
              contentSections.push(`<${tagName}>${listHtml}</${tagName}>`);
            }
          } else if (tagName === 'p') {
            contentSections.push(`<p>${text}</p>`);
          }
        });
        
        description = contentSections.join('\n');
      }
      
      // Clean up the description
      description = description
        .replace(/<script[^>]*>.*?<\/script>/gi, '')
        .replace(/<style[^>]*>.*?<\/style>/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000); // Increase limit to 8000 chars

      // Extract image - try multiple selectors
      let imageUrl = null;
      
      // Try og:image meta tag first
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage) {
        imageUrl = ogImage;
      }
      
      // Try to find the main product image
      if (!imageUrl) {
        const imgSrc = $('img[alt*="' + sku + '"]').first().attr('src');
        if (imgSrc) {
          imageUrl = imgSrc.startsWith('http') ? imgSrc : `${this.config.baseUrl}${imgSrc}`;
        }
      }
      
      // Fallback to any image with the SKU in the URL
      if (!imageUrl) {
        $('img').each((_, img) => {
          const src = $(img).attr('src');
          if (src && (src.includes(sku) || src.includes('cdn.vividracing'))) {
            imageUrl = src.startsWith('http') ? src : `${this.config.baseUrl}${src}`;
            return false; // break
          }
        });
      }

      // Extract price - try multiple approaches
      let price: number | null = null;
      
      // Try to find price in various locations
      const priceSelectors = [
        '.product-price',
        '.price',
        '[itemprop="price"]',
        '.price-value',
        '#product-price',
        'span:contains("$")',
      ];
      
      for (const selector of priceSelectors) {
        const priceText = $(selector).first().text();
        if (priceText) {
          const priceMatch = priceText.match(/\$?\s*([\d,]+\.?\d*)/);
          if (priceMatch) {
            price = parseFloat(priceMatch[1].replace(',', ''));
            if (price > 0) break;
          }
        }
      }
      
      // Try schema.org structured data
      if (!price || price === 0) {
        const schemaScript = $('script[type="application/ld+json"]').html();
        if (schemaScript) {
          try {
            const schema = JSON.parse(schemaScript);
            if (schema.offers && schema.offers.price) {
              price = parseFloat(schema.offers.price);
            }
          } catch {
            // ignore JSON parse errors
          }
        }
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