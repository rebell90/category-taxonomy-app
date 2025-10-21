// src/app/api/admin/distributors/import-to-shopify/route.ts
// Import distributor products to Shopify

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { shopifyAdminGraphQL } from '@/lib/shopify';
import { generateProductDescription } from '@/lib/ai-description-generator';

interface ShopifyProductCreateResponse {
  productCreate: {
    product: {
      id: string;
    } | null;
    userErrors: Array<{ field: string[]; message: string }>;
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      distributorProductIds: string[];
    };

    const products = await prisma.distributorProduct.findMany({
      where: {
        id: { in: body.distributorProductIds },
        shopifyProductGid: null, // Only import products not yet in Shopify
      },
      include: {
        distributor: {
          include: {
            categories: {
              include: {
                category: true,
              },
            },
          },
        },
      },
    });

    const results: Array<{ sku: string; success: boolean; error?: string; productGid?: string }> = [];

    for (const product of products) {
      try {
        // Create product in Shopify
        const CREATE_PRODUCT = `
          mutation CreateProduct($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const input = {
          title: product.title,
          descriptionHtml: product.description || '',
          vendor: product.distributor.name,
          productType: 'Performance Parts',
          tags: ['imported', product.distributor.code],
        };

        const data = await shopifyAdminGraphQL<ShopifyProductCreateResponse>(
          CREATE_PRODUCT,
          { input }
        );

        if (data.productCreate.userErrors.length > 0) {
          throw new Error(data.productCreate.userErrors[0].message);
        }

        const shopifyProductGid = data.productCreate.product?.id;
        if (!shopifyProductGid) {
          throw new Error('No product ID returned from Shopify');
        }

        // Update our database
        await prisma.distributorProduct.update({
          where: { id: product.id },
          data: {
            shopifyProductGid,
            importedAt: new Date(),
          },
        });

        // Link to categories based on distributor category mapping
        const rawData = product.rawData as Record<string, unknown> | null;
        if (rawData && typeof rawData === 'object' && 'categoryPath' in rawData && typeof rawData.categoryPath === 'string') {
          const distCat = await prisma.distributorCategory.findFirst({
            where: {
              distributorId: product.distributorId,
              distributorPath: rawData.categoryPath,
            },
          });

          if (distCat?.categoryId) {
            // Link to your category
            await prisma.productCategory.create({
              data: {
                productGid: shopifyProductGid,
                categoryId: distCat.categoryId,
              },
            });
          }
        }

        // Add fitment data if available
        if (
          rawData &&
          typeof rawData === 'object' &&
          'make' in rawData &&
          typeof rawData.make === 'string' &&
          'model' in rawData &&
          typeof rawData.model === 'string'
        ) {
          const make = rawData.make as string;
          const model = rawData.model as string;
          const yearFrom = 'yearFrom' in rawData && typeof rawData.yearFrom === 'number' ? rawData.yearFrom : undefined;
          const yearTo = 'yearTo' in rawData && typeof rawData.yearTo === 'number' ? rawData.yearTo : undefined;
          
          await prisma.productFitment.create({
            data: {
              productGid: shopifyProductGid,
              make,
              model,
              yearFrom,
              yearTo,
            },
          });
        }

        results.push({
          sku: product.distributorSku,
          success: true,
          productGid: shopifyProductGid,
        });
      } catch (error) {
        results.push({
          sku: product.distributorSku,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
      total: body.distributorProductIds.length,
      imported: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });
  } catch (error) {
    console.error('Import to Shopify error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}