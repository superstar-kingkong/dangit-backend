import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Validate environment variables
if (!process.env.OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set in environment variables');
  process.exit(1);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('ERROR: SUPABASE_URL or SUPABASE_ANON_KEY is not set');
  process.exit(1);
}

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Supabase setup
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

console.log('✅ Server initialized with environment variables');
console.log('📍 Supabase URL:', process.env.SUPABASE_URL);
console.log('🔑 OpenAI API key:', process.env.OPENAI_API_KEY ? '***' + process.env.OPENAI_API_KEY.slice(-4) : 'NOT SET');

// Helper function to clean JSON response
function cleanJSONResponse(response) {
  if (!response) return null;
  let cleaned = response.replace(/```json\n?/g, '').replace(/```/g, '').trim();
  
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error('Could not parse AI response as JSON');
      }
    }
    throw new Error('Could not parse AI response as JSON');
  }
}

// Validate user ID (basic validation for email format)
function isValidUserId(userId) {
  if (!userId || userId === 'anonymous-user') {
    return false;
  }
  // Check if it looks like an email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(userId);
}

// Analyze content endpoint
app.post('/api/analyze', async (req, res) => {
  try {
    const { content, contentType } = req.body;
    console.log('Analyzing:', contentType);

    if (contentType === 'image') {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: "You are an expert image analyzer. Return ONLY valid JSON with no markdown formatting."
          },
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: `Analyze this image and return ONLY a JSON object:
                {
                  "title": "what is this image about (max 60 chars)",
                  "category": "best category from: AI Tools, Learning, Entertainment, Shopping, Food & Dining, Coupons & Deals, Productivity, Health & Fitness, Travel, Finance, Other",
                  "summary": "what information can be extracted from this image",
                  "tags": ["relevant", "tags", "array"]
                }` 
              },
              {
                type: "image_url",
                image_url: { url: content, detail: "low" }
              }
            ]
          }
        ],
        max_tokens: 300,
        temperature: 0.1
      });

      const result = cleanJSONResponse(response.choices[0].message.content);
      res.json(result);

    } else {
      // Handle URL and text content
      let prompt = '';
      
      if (contentType === 'url') {
        prompt = `Analyze this webpage: Title: ${content.title}, Description: ${content.description}. Return ONLY JSON: {"title":"short catchy title (max 60 chars)", "category":"one of: AI Tools, Learning, Entertainment, Shopping, Food & Dining, Coupons & Deals, Productivity, Health & Fitness, Travel, Finance, Other", "summary":"2-sentence summary", "tags":["tag1", "tag2", "tag3"]}`;
      } else {
        prompt = `Analyze this content: "${content}". Return ONLY JSON: {"title":"short catchy title (max 60 chars)", "category":"one of: AI Tools, Learning, Entertainment, Shopping, Food & Dining, Coupons & Deals, Productivity, Health & Fitness, Travel, Finance, Other", "summary":"2-sentence summary", "tags":["tag1", "tag2", "tag3"]}`;
      }

      const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "Return ONLY valid JSON with no markdown formatting." },
          { role: "user", content: prompt }
        ],
        max_tokens: 300,
        temperature: 0.1
      });

      const result = cleanJSONResponse(response.choices[0].message.content);
      res.json(result);
    }

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      title: 'Analysis Failed',
      category: 'Other',
      summary: 'Could not analyze content',
      tags: ['error', 'needs-review']
    });
  }
});

// Scrape URL endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    console.log('Scraping URL:', url);
    
    // Add protocol if missing
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    
    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    const result = {
      title: $('title').text()?.trim()?.substring(0, 100) || 'Untitled',
      description: $('meta[name="description"]').attr('content')?.trim()?.substring(0, 300) || 
                  $('meta[property="og:description"]').attr('content')?.trim()?.substring(0, 300) || 'No description',
      url: response.url
    };
    
    console.log('Scraped successfully:', result);
    res.json(result);
    
  } catch (error) {
    console.error('Scraping error:', error.message);
    
    // Return fallback instead of error
    res.json({
      title: 'Saved Link',
      description: `Link saved: ${req.body.url}`,
      url: req.body.url
    });
  }
});

// Get saved items endpoint - NOW WITH USER AUTHENTICATION
app.get('/api/saved-items', async (req, res) => {
  try {
    const { userId, category } = req.query;
    
    // Validate user ID
    if (!isValidUserId(userId)) {
      return res.status(400).json({ 
        error: 'Invalid or missing user ID. Please sign in.' 
      });
    }
    
    console.log('Fetching saved items for authenticated user:', userId);
    
    let query = supabase
      .from('saved_items')
      .select('*')
      .eq('user_id', userId) // Only get items for this specific user
      .order('created_at', { ascending: false });
    
    if (category && category !== 'all') {
      query = query.eq('ai_category', category);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch items' });
    }
    
    console.log(`Found ${data.length} items for user ${userId}`);
    res.json({ data });
    
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Process content endpoint - NOW WITH USER AUTHENTICATION
app.post('/api/process-content', async (req, res) => {
  try {
    const { content, contentType, userId } = req.body;
    
    // Validate user ID
    if (!isValidUserId(userId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid or missing user ID. Please sign in.' 
      });
    }
    
    console.log('Processing content for authenticated user:', { 
      contentType, 
      userId, 
      contentPreview: content?.substring?.(0, 100) 
    });
    
    let processedContent;
    
    if (contentType === 'url') {
      // First scrape the URL
      console.log('Scraping URL...');
      const scrapeResponse = await fetch('http://localhost:3001/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: content })
      });
      const scrapedData = await scrapeResponse.json();
      console.log('Scraped data:', scrapedData);
      
      // Then analyze it
      console.log('Analyzing URL content...');
      const analyzeResponse = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: scrapedData, contentType: 'url' })
      });
      processedContent = await analyzeResponse.json();
      
    } else if (contentType === 'image') {
      console.log('Analyzing image...');
      const analyzeResponse = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, contentType: 'image' })
      });
      processedContent = await analyzeResponse.json();
      
    } else {
      // Handle text content
      console.log('Analyzing text content...');
      const analyzeResponse = await fetch('http://localhost:3001/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, contentType: 'text' })
      });
      processedContent = await analyzeResponse.json();
    }
    
    // Save to database with user authentication
    console.log('Saving to database for user:', userId);
    const { data, error } = await supabase
      .from('saved_items')
      .insert({
        user_id: userId, // Save with authenticated user's ID
        title: processedContent.title,
        content_type: contentType,
        original_content: content,
        ai_summary: processedContent.summary,
        ai_category: processedContent.category,
        ai_tags: processedContent.tags,
        is_completed: false
      })
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to save to database' 
      });
    }

    console.log('Successfully saved to database for user:', userId);
    
    res.json({ 
      success: true, 
      data: data
    });
    
  } catch (error) {
    console.error('Process content error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process content' 
    });
  }
});

// Toggle completion endpoint - NOW WITH USER AUTHENTICATION
app.patch('/api/toggle-completion', async (req, res) => {
  try {
    const { itemId, completed, userId } = req.body;
    
    // Validate user ID
    if (!isValidUserId(userId)) {
      return res.status(400).json({ 
        error: 'Invalid or missing user ID. Please sign in.' 
      });
    }
    
    console.log('Toggling completion for item:', itemId, 'to:', completed, 'for user:', userId);
    
    // First verify the item belongs to this user
    const { data: existingItem, error: fetchError } = await supabase
      .from('saved_items')
      .select('user_id')
      .eq('id', itemId)
      .single();

    if (fetchError || !existingItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    if (existingItem.user_id !== userId) {
      return res.status(403).json({ error: 'Access denied. This item belongs to another user.' });
    }
    
    // Update the completion status
    const { data, error } = await supabase
      .from('saved_items')
      .update({ is_completed: completed })
      .eq('id', itemId)
      .eq('user_id', userId) // Double-check user ownership
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      throw error;
    }
    
    console.log('Successfully toggled completion for user:', userId);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Toggle completion error:', error);
    res.status(500).json({ error: 'Failed to toggle completion' });
  }
});

// Delete item endpoint - NEW WITH USER AUTHENTICATION
app.delete('/api/delete-item', async (req, res) => {
  try {
    const { itemId, userId } = req.body;
    
    // Validate user ID
    if (!isValidUserId(userId)) {
      return res.status(400).json({ 
        error: 'Invalid or missing user ID. Please sign in.' 
      });
    }
    
    console.log('Deleting item:', itemId, 'for user:', userId);
    
    // Verify ownership and delete
    const { data, error } = await supabase
      .from('saved_items')
      .delete()
      .eq('id', itemId)
      .eq('user_id', userId) // Ensure user can only delete their own items
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'Item not found or access denied' });
      }
      throw error;
    }
    
    console.log('Successfully deleted item for user:', userId);
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Get user stats endpoint - NEW
app.get('/api/user-stats', async (req, res) => {
  try {
    const { userId } = req.query;
    
    // Validate user ID
    if (!isValidUserId(userId)) {
      return res.status(400).json({ 
        error: 'Invalid or missing user ID. Please sign in.' 
      });
    }
    
    console.log('Getting stats for user:', userId);
    
    // Get total count
    const { data: totalData, error: totalError } = await supabase
      .from('saved_items')
      .select('id', { count: 'exact' })
      .eq('user_id', userId);

    // Get completed count
    const { data: completedData, error: completedError } = await supabase
      .from('saved_items')
      .select('id', { count: 'exact' })
      .eq('user_id', userId)
      .eq('is_completed', true);

    // Get category breakdown
    const { data: categoryData, error: categoryError } = await supabase
      .from('saved_items')
      .select('ai_category')
      .eq('user_id', userId);

    if (totalError || completedError || categoryError) {
      throw new Error('Failed to fetch user stats');
    }

    // Process category data
    const categoryBreakdown = categoryData.reduce((acc, item) => {
      const category = item.ai_category || 'Other';
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {});

    const stats = {
      totalItems: totalData.length,
      completedItems: completedData.length,
      pendingItems: totalData.length - completedData.length,
      completionRate: totalData.length > 0 ? Math.round((completedData.length / totalData.length) * 100) : 0,
      categoryBreakdown
    };
    
    console.log('User stats:', stats);
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('User stats error:', error);
    res.status(500).json({ error: 'Failed to get user stats' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'DANGIT server is running with user authentication',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Catch-all for invalid user authentication
app.use('*', (req, res, next) => {
  // If request has userId in body/query, validate it
  const userId = req.body?.userId || req.query?.userId;
  if (userId && !isValidUserId(userId)) {
    return res.status(401).json({ 
      error: 'Authentication required. Please sign in.' 
    });
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`DANGIT Server v2.0.0 running on http://0.0.0.0:${PORT}`);
  console.log('Features: User Authentication, AI Analysis, Content Organization');
});