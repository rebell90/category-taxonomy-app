// src/app/api/admin/distributors/scrape/route.ts

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { VividRacingScraper } from '@/lib/vivid-racing-scraper';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      categoryUrl?: string;
      productUrl?: string;
      action: 'category' | 'product' | 'categories';
    };

    const scraper = new VividRacingScraper();

    // Ensure Vivid Racing distributor exists
    let distributor = await prisma.distributor.findUnique({
      where: { code: 'vivid-racing' },
    });

    if (!distributor) {
      distributor = await prisma.distributor.create({
        data: {
          name: 'Vivid Racing',
          code: 'vivid-racing',
          baseUrl: 'https://www.vividracing.com',
          isActive: true,
        },
      });
    }

    // Handle different actions
    if (body.action === 'categories') {
      // Scrape all categories
      const categories = await scraper.scrapeCategories();
      
      // Save to database
      for (const cat of categories) {
        await prisma.distributorCategory.upsert({
          where: {
            distributorId_distributorPath: {
              distributorId: distributor.id,
              distributorPath: cat.path,
            },
          },
          update: {
            distributorName: cat.name,
          },
          create: {
            distributorId: distributor.id,
            distributorPath: cat.path,
            distributorName: cat.name,
          },
        });
      }

      return NextResponse.json({
        success: true,
        categoriesFound: categories.length,
        message: 'Categories scraped and saved',
      });
    }

    if (body.action === 'category' && body.categoryUrl) {
      // Scrape all products from a category
      const products = await scraper.scrapeCategoryProducts(body.categoryUrl);

      // Save products to database
      let saved = 0;
      for (const prod of products) {
        await prisma.distributorProduct.upsert({
          where: {
            distributorId_distributorSku: {
              distributorId: distributor.id,
              distributorSku: prod.sku,
            },
          },
          update: {
            title: prod.title,
            description: prod.description,
            price: prod.price,
            imageUrl: prod.imageUrl,
            distributorUrl: prod.url,
            lastScrapedAt: new Date(),
            rawData: prod as any,
          },
          create: {
            distributorId: distributor.id,
            distributorSku: prod.sku,
            title: prod.title,
            description: prod.description,
            price: prod.price,
            imageUrl: prod.imageUrl,
            distributorUrl: prod.url,
            rawData: prod as any,
          },
        });
        saved++;
      }

      return NextResponse.json({
        success: true,
        productsScraped: products.length,
        productsSaved: saved,
      });
    }

    if (body.action === 'product' && body.productUrl) {
      // Scrape a single product
      const product = await scraper.scrapeProduct(body.productUrl);

      if (!product) {
        return NextResponse.json(
          { error: 'Failed to scrape product' },
          { status: 400 }
        );
      }

      // Save to database
      await prisma.distributorProduct.upsert({
        where: {
          distributorId_distributorSku: {
            distributorId: distributor.id,
            distributorSku: product.sku,
          },
        },
        update: {
          title: product.title,
          description: product.description,
          price: product.price,
          imageUrl: product.imageUrl,
          distributorUrl: product.url,
          lastScrapedAt: new Date(),
          rawData: product as any,
        },
        create: {
          distributorId: distributor.id,
          distributorSku: product.sku,
          title: product.title,
          description: product.description,
          price: product.price,
          imageUrl: product.imageUrl,
          distributorUrl: product.url,
          rawData: product as any,
        },
      });

      return NextResponse.json({
        success: true,
        product,
      });
    }

    return NextResponse.json(
      { error: 'Invalid action or missing parameters' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Scrape error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}