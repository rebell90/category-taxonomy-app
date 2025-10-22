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
        max_tokens: 1000,
        temperature: 0.7,
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
  let prompt = `You are writing a product description for a performance automotive parts e-commerce store. Take the distributor's description and rewrite it to be more compelling and SEO-friendly for our customers.

Product Title: ${product.title}`;

  if (product.make && product.model) {
    const yearRange = product.yearFrom && product.yearTo 
      ? `${product.yearFrom}-${product.yearTo}` 
      : product.yearFrom || '';
    prompt += `\nVehicle Fitment: ${yearRange} ${product.make} ${product.model}`;
  }

  if (product.partNumber) {
    prompt += `\nPart Number: ${product.partNumber}`;
  }

  if (product.category) {
    prompt += `\nCategory: ${product.category}`;
  }

  prompt += `\n\nDISTRIBUTOR'S ORIGINAL DESCRIPTION:\n${product.originalDescription || 'No description provided'}`;

  prompt += `

INSTRUCTIONS:
1. Rewrite the description to be clear, compelling, and SEO-friendly
2. Keep ALL important technical specifications and features
3. Keep the brand name (like Duraflex, etc.) and part numbers
4. Remove any shipping, return policy, or warranty information
5. Remove any legal disclaimers or warnings
6. Make it 2-4 paragraphs (200-350 words)
7. Use an enthusiastic but professional tone
8. Focus on benefits and performance improvements
9. Include bullet points for key specifications if present in original
10. Format in clean HTML with <p> tags and <ul>/<li> for lists

EXAMPLE STRUCTURE:
<p>[Opening paragraph highlighting the main benefit and what makes this part special]</p>
<p>[Technical details and specifications paragraph]</p>
<ul>
<li>[Key spec 1]</li>
<li>[Key spec 2]</li>
</ul>
<p>[Closing paragraph about quality and why to choose this part]</p>

Return ONLY the HTML description with no additional text or explanation.`;

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