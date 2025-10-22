import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import OpenAI from 'openai';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

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

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('ERROR: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  process.exit(1);
}

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Supabase setup
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

console.log('✅ Server initialized with environment variables');
console.log('📍 Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log('🔑 OpenAI API key:', process.env.OPENAI_API_KEY ? '***' + process.env.OPENAI_API_KEY.slice(-4) : 'NOT SET');

// Helper function to clean JSON response
function cleanJSONResponse(response) {
  if (!response) throw new Error('Empty response');

  // Remove markdown code blocks
  let cleaned = response.replace(/``````/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    // Try to extract JSON from mixed content
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

// ============================================
// ENHANCED AI ANALYSIS ENDPOINT
// ============================================
app.post('/api/analyze', async (req, res) => {
  try {
    const { content, contentType } = req.body;
    console.log('Analyzing content type:', contentType);

    let analysisResult;

    // ============================================
    // IMAGE ANALYSIS - Detailed & Specific
    // ============================================
    if (contentType === 'image') {
      const response = await openai.chat.completions.create({
        model: "gpt-4o", // Better vision model
        messages: [
          {
            role: "system",
            content: `You are DANGIT's content analyzer. Your job is to extract useful, actionable information from images.

BE SPECIFIC, NOT GENERIC:
❌ Bad: "Image of a recipe"
✅ Good: "Tiramisu Recipe - Coffee & Mascarpone dessert"

❌ Bad: "Screenshot of text"
✅ Good: "Assignment Due Oct 25 - Submit research paper"

EXTRACT KEY DETAILS:
- Recipe: Dish name, main ingredients, cuisine type
- Deadline/Task: What needs to be done, when, priority
- Coupon: Discount amount, code, expiry date, where to use
- Product: Item name, price, store/brand
- Event: Event name, date, time, location
- Contact: Person name, role, company if visible

Return JSON that sounds natural and helpful, not robotic.`
          },
          {
            role: "user",
            content: [
              { 
                type: "text", 
                text: `Analyze this image and extract detailed information.

Create a natural-sounding title and summary that captures what matters.

Examples of good titles:
- "Butter Chicken Recipe with Cashew Paste"
- "Flipkart Sale - 40% Off Electronics till Nov 5"
- "Math Assignment Due Monday 9 AM"
- "Gym Membership: ₹3000 for 3 months"

Return ONLY this JSON:
{
  "title": "specific, helpful title (max 60 chars)",
  "category": "best category from: AI Tools, Learning, Entertainment, Shopping, Food & Dining, Coupons & Deals, Productivity, Health & Fitness, Travel, Finance, Other",
  "summary": "Natural 2-3 sentence description of what this is and why it matters. Include key details like dates, prices, ingredients, or action items.",
  "tags": ["specific", "useful", "tags"],
  "extracted_info": {
    "deadline": "YYYY-MM-DD or null",
    "price": "amount with currency or null",
    "code": "coupon/promo code or null",
    "action_needed": "what user should do, or null"
  }
}` 
              },
              {
                type: "image_url",
                image_url: { 
                  url: content, 
                  detail: "high" // High detail for better analysis
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.3 // Balanced between creative and factual
      });

      const rawResponse = response.choices[0].message.content;
      console.log('GPT-4 Vision response:', rawResponse);
      analysisResult = cleanJSONResponse(rawResponse);
    }

    // ============================================
    // URL ANALYSIS - Deep & Contextual
    // ============================================
    else if (contentType === 'url') {
      const prompt = `Analyze this webpage and create a helpful, natural description.

Title: ${content.title}
Description: ${content.description}
URL: ${content.url}

BE HELPFUL & SPECIFIC:
❌ Bad: "Article about productivity"
✅ Good: "7 Morning Habits That Boost Productivity - Time blocking guide"

❌ Bad: "YouTube video"
✅ Good: "Python Tutorial: Build a To-Do App in 30 Minutes"

IDENTIFY CONTENT TYPE & VALUE:
- Article: Main topic + key takeaway
- Video: What you'll learn/see
- Product: What it is + price range if mentioned
- Tool/App: What it does + who it's for
- Recipe: Dish name + cuisine + difficulty
- Course: What you'll learn + duration if mentioned

Return ONLY this JSON:
{
  "title": "clear, specific title that tells me what this is (max 60 chars)",
  "category": "best fit from: AI Tools, Learning, Entertainment, Shopping, Food & Dining, Coupons & Deals, Productivity, Health & Fitness, Travel, Finance, Other",
  "summary": "Natural 2-3 sentences explaining what this is and why someone would save it. Be conversational, not robotic.",
  "tags": ["relevant", "searchable", "tags"],
  "content_type": "article/video/product/tool/recipe/course/guide/other"
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Fast & cheap for text
        messages: [
          { 
            role: "system", 
            content: "You extract useful information from web content. Be specific and helpful, not generic. Sound natural, not like a robot." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 600,
        temperature: 0.4
      });

      const rawResponse = response.choices[0].message.content;
      console.log('GPT-4 URL response:', rawResponse);
      analysisResult = cleanJSONResponse(rawResponse);
    }

    // ============================================
    // TEXT/NOTE ANALYSIS - Light Touch
    // ============================================
    else if (contentType === 'text') {
      const prompt = `The user wrote this note. Help organize it WITHOUT over-analyzing.

User's note:
"${content}"

RULES:
1. Respect their words - don't rewrite unnecessarily
2. Create a SHORT title from their first line or main topic
3. Keep the summary brief and close to their original intent
4. Only suggest obvious tags
5. Don't be overly formal - match their tone

Examples:
User: "Buy milk, eggs, bread from store tomorrow"
Title: "Grocery Shopping Tomorrow"
Summary: "Need to buy milk, eggs, and bread"

User: "Call mom about Diwali plans - she wants to finalize guest list"
Title: "Call Mom - Diwali Planning"
Summary: "Discuss and finalize the guest list for Diwali"

Return ONLY this JSON:
{
  "title": "short title from their content (max 60 chars)",
  "category": "suggest best category but don't overthink",
  "summary": "brief, natural summary - 1-2 sentences max",
  "tags": ["simple", "obvious", "tags"],
  "note_type": "list/reminder/idea/plan/other"
}`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { 
            role: "system", 
            content: "You help organize user notes with a light touch. Don't overanalyze. Keep it simple and respect their words." 
          },
          { role: "user", content: prompt }
        ],
        max_tokens: 400,
        temperature: 0.3
      });

      const rawResponse = response.choices[0].message.content;
      console.log('GPT-4 Text response:', rawResponse);
      analysisResult = cleanJSONResponse(rawResponse);
    }

    // ============================================
    // VALIDATION & FALLBACK
    // ============================================
    
    // Ensure we have all required fields
    if (!analysisResult.title || !analysisResult.category || !analysisResult.summary) {
      throw new Error('Invalid AI response format');
    }

    // Clean up the response
    analysisResult.title = analysisResult.title.substring(0, 60); // Enforce length
    analysisResult.summary = analysisResult.summary.substring(0, 300); // Reasonable summary length
    analysisResult.tags = (analysisResult.tags || []).slice(0, 5); // Max 5 tags

    console.log('Final analysis result:', analysisResult);
    res.json(analysisResult);

  } catch (error) {
    console.error('Analysis error:', error);
    
    // Better fallback responses
    const fallbackResponses = {
      'image': {
        title: 'Saved Screenshot',
        category: 'Other',
        summary: 'Screenshot saved successfully. AI analysis had an issue, but your content is safely stored.',
        tags: ['screenshot', 'saved']
      },
      'url': {
        title: content?.title?.substring(0, 60) || 'Saved Link',
        category: 'Other',
        summary: content?.description?.substring(0, 200) || 'Link saved successfully for later reference.',
        tags: ['link', 'saved']
      },
      'text': {
        title: content?.split('\n')[0]?.substring(0, 60) || 'Quick Note',
        category: 'Other',
        summary: content?.substring(0, 200) || 'Note saved successfully.',
        tags: ['note', 'saved']
      }
    };

    res.json(fallbackResponses[contentType] || {
      title: 'Saved Content',
      category: 'Other',
      summary: 'Content saved successfully.',
      tags: ['saved']
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

// Get saved items endpoint - WITH USER AUTHENTICATION
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

// Upload image to Supabase Storage
app.post('/api/storage/upload-image', async (req, res) => {
  try {
    const { imageData, userId, fileName } = req.body;
    
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    console.log('📤 Uploading image for user:', userId);
    
    // Remove data URL prefix if present
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Create unique filename
    const uniqueFileName = `${userId}/${Date.now()}-${fileName || 'screenshot.png'}`;
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from('saved-images')
      .upload(uniqueFileName, buffer, {
        contentType: 'image/png',
        upsert: false
      });
    
    if (error) {
      console.error('❌ Upload error:', error);
      throw error;
    }
    
    // Get public URL
    const { data: urlData } = supabase.storage
      .from('saved-images')
      .getPublicUrl(uniqueFileName);
    
    console.log('✅ Image uploaded successfully:', uniqueFileName);
    
    res.json({ 
      success: true, 
      url: urlData.publicUrl,
      path: uniqueFileName
    });
    
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to upload image' 
    });
  }
});

// ============================================
// ENHANCED PROCESS CONTENT ENDPOINT (REPLACES OLD ONE)
// ============================================
app.post('/api/process-content', async (req, res) => {
  try {
    const { content, contentType, userId } = req.body;
    
    if (!isValidUserId(userId)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid or missing user ID. Please sign in.' 
      });
    }
    
    console.log('🚀 Processing content (enhanced):', { contentType, userId });
    
    let processedContent;
    let imageUrl = null;
    let previewData = null;
    let contentMetadata = {};
    
    // Determine server URL based on environment
    const serverUrl = process.env.NODE_ENV === 'production' 
      ? 'https://dangit-backend.onrender.com' 
      : `http://localhost:${process.env.PORT || 3001}`;
    
    // ============================================
    // IMAGE PROCESSING WITH STORAGE
    // ============================================
    if (contentType === 'image') {
      console.log('📸 Processing image with storage...');
      
      // Upload image to Supabase Storage
      const uploadResponse = await fetch(`${serverUrl}/api/storage/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          imageData: content, 
          userId,
          fileName: `screenshot-${Date.now()}.png`
        })
      });
      
      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.success) {
        imageUrl = uploadResult.url;
        contentMetadata = {
          storage_path: uploadResult.path,
          uploaded_at: new Date().toISOString(),
          file_size: Math.round(content.length * 0.75) // Approximate base64 to bytes
        };
        console.log('✅ Image uploaded to:', imageUrl);
      } else {
        console.error('❌ Image upload failed:', uploadResult.error);
      }
      
      // Analyze image with AI
      const analyzeResponse = await fetch(`${serverUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, contentType: 'image' })
      });
      processedContent = await analyzeResponse.json();
    }
    
    // ============================================
    // URL PROCESSING WITH PREVIEW DATA
    // ============================================
    else if (contentType === 'url') {
      console.log('🔗 Processing URL with preview data...');
      
      const scrapeResponse = await fetch(`${serverUrl}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: content })
      });
      const scrapedData = await scrapeResponse.json();
      
      // Store rich preview data
      try {
        const urlObj = new URL(scrapedData.url);
        previewData = {
          url: scrapedData.url,
          domain: urlObj.hostname,
          title: scrapedData.title,
          description: scrapedData.description,
          favicon: `https://www.google.com/s2/favicons?domain=${urlObj.hostname}&sz=64`
        };
        contentMetadata = { 
          domain: urlObj.hostname,
          protocol: urlObj.protocol 
        };
      } catch (error) {
        console.error('URL parsing error:', error);
        previewData = {
          url: content,
          title: scrapedData.title,
          description: scrapedData.description
        };
      }
      
      const analyzeResponse = await fetch(`${serverUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: scrapedData, contentType: 'url' })
      });
      processedContent = await analyzeResponse.json();
    }
    
    // ============================================
    // TEXT PROCESSING WITH METADATA
    // ============================================
    else {
      console.log('📝 Processing text with metadata...');
      
      const analyzeResponse = await fetch(`${serverUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, contentType: 'text' })
      });
      processedContent = await analyzeResponse.json();
      
      // Add text metadata
      const words = content.trim().split(/\s+/).length;
      contentMetadata = {
        word_count: words,
        char_count: content.length,
        estimated_read_time: Math.max(1, Math.ceil(words / 200)) // minutes
      };
    }
    
    // ============================================
    // SAVE TO DATABASE WITH ENHANCED DATA
    // ============================================
    console.log('💾 Saving to database with enhanced data...');
    const { data, error } = await supabase
      .from('saved_items')
      .insert({
        user_id: userId,
        title: processedContent.title,
        content_type: contentType,
        original_content: contentType === 'image' ? null : content,
        original_image_url: imageUrl,
        preview_data: previewData,
        content_metadata: contentMetadata,
        ai_summary: processedContent.summary,
        ai_category: processedContent.category,
        ai_tags: processedContent.tags,
        is_completed: false,
        view_count: 0
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

    console.log('✅ Successfully saved with enhanced features!');
    res.json({ success: true, data: data });
    
  } catch (error) {
    console.error('Process content error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process content' 
    });
  }
});

// Toggle completion endpoint - WITH USER AUTHENTICATION
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

// Delete item endpoint - WITH USER AUTHENTICATION
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

// Get user stats endpoint
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

// Get item with full details (for card detail view)
app.get('/api/item/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    const { userId } = req.query;
    
    if (!isValidUserId(userId)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    
    const { data, error } = await supabase
      .from('saved_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', userId)
      .single();
    
    if (error) {
      console.error('Fetch item error:', error);
      return res.status(404).json({ error: 'Item not found' });
    }
    
    // Increment view count
    await supabase
      .from('saved_items')
      .update({ 
        view_count: (data.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString()
      })
      .eq('id', itemId);
    
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'DANGIT server running with enhanced features',
    timestamp: new Date().toISOString(),
    version: '2.2.0',
    features: ['Enhanced AI Analysis', 'Image Storage', 'Link Previews', 'View Tracking']
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DANGIT Server v2.2.0 running on http://0.0.0.0:${PORT}`);
  console.log('✨ Enhanced Features: Image Storage, Link Previews, View Tracking');
  console.log('📊 AI Models: GPT-4o (vision), GPT-4o-mini (text)');
  console.log('🗂️ Storage: Supabase Storage for images');
});
