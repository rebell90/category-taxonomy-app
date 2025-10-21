// src/lib/ai-description-generator.ts
// Generate product descriptions using Claude API

export interface ProductInfo {
  title: string;
  originalDescription?: string;
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  category?: string;
  partNumber?: string;
}

export async function generateProductDescription(product: ProductInfo): Promise<string> {
  try {
    const prompt = buildPrompt(product);
    
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error('Failed to generate AI description:', error);
    // Fallback to original or generic description
    return product.originalDescription || generateFallbackDescription(product);
  }
}

function buildPrompt(product: ProductInfo): string {
  let prompt = `Write a compelling, SEO-friendly product description for an automotive performance part. 

Product: ${product.title}`;

  if (product.make && product.model) {
    const yearRange = product.yearFrom && product.yearTo 
      ? `${product.yearFrom}-${product.yearTo}` 
      : product.yearFrom || '';
    prompt += `\nFitment: ${yearRange} ${product.make} ${product.model}`;
  }

  if (product.partNumber) {
    prompt += `\nPart Number: ${product.partNumber}`;
  }

  if (product.category) {
    prompt += `\nCategory: ${product.category}`;
  }

  if (product.originalDescription) {
    prompt += `\n\nOriginal description for reference:\n${product.originalDescription.substring(0, 500)}`;
  }

  prompt += `

Requirements:
- Write 2-3 paragraphs (150-250 words)
- Focus on benefits and features
- Use professional, enthusiastic tone
- Include key specifications if mentioned
- Make it SEO-friendly with natural keyword usage
- Don't use overly salesy language
- Don't mention pricing, shipping, or returns
- Write in HTML format with <p> tags

Return ONLY the HTML description, no other text.`;

  return prompt;
}

function generateFallbackDescription(product: ProductInfo): string {
  let desc = `<p>${product.title} is a high-quality performance automotive part`;
  
  if (product.make && product.model) {
    const yearRange = product.yearFrom && product.yearTo 
      ? `${product.yearFrom}-${product.yearTo}` 
      : '';
    desc += ` designed specifically for ${yearRange} ${product.make} ${product.model} vehicles`;
  }
  
  desc += '.</p>';
  
  desc += '<p>This premium aftermarket component is engineered for superior performance and durability, ensuring your vehicle performs at its best.</p>';
  
  if (product.partNumber) {
    desc += `<p>Part Number: ${product.partNumber}</p>`;
  }
  
  return desc;
}