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

// ============================================
// 🔒 SECURE AUTHENTICATION MIDDLEWARE
// ============================================
async function authenticateUser(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Authentication required. Please provide a valid token.',
        code: 'NO_AUTH_TOKEN'
      });
    }
    
    const token = authHeader.replace('Bearer ', '');
    
    // Verify JWT token with Supabase
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.log('Authentication failed:', error?.message);
      return res.status(401).json({ 
        error: 'Invalid or expired authentication token. Please sign in again.',
        code: 'INVALID_TOKEN'
      });
    }
    
    // Attach authenticated user to request
    req.authenticatedUser = user;
    req.userId = user.email; // Use verified email from token
    
    console.log('✅ Authenticated user:', user.email);
    next();
    
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(401).json({ 
      error: 'Authentication failed. Please sign in again.',
      code: 'AUTH_ERROR'
    });
  }
}

// ============================================
// PUBLIC ENDPOINTS (No authentication required)
// ============================================

// Health check endpoint (public for monitoring)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'DANGIT server running with SECURE authentication',
    timestamp: new Date().toISOString(),
    version: '2.4.0-SECURE+FEEDBACK',
    features: ['🔒 Secure Auth', 'Enhanced AI Analysis', 'Image Storage', 'Link Previews', 'View Tracking', '💬 Feedback System']
  });
});

// ✅ NEW: Instagram scraper - NO AUTH (so /api/analyze can use it)
app.post('/api/scrape-instagram', async (req, res) => {
  try {
    const { url } = req.body;
    console.log('🎯 Instagram URL received:', url);
    
    // Validate
    const isInstagram = url.includes('instagram.com') || url.includes('instagr.am');
    if (!isInstagram) {
      return res.status(400).json({ error: 'Not an Instagram URL' });
    }
    
    // Extract post type and ID
    const postMatch = url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
    const postType = postMatch ? postMatch[1] : 'post';
    const postId = postMatch ? postMatch[2] : null;
    
    console.log(`📸 Instagram ${postType} detected:`, postId);
    
    // Try oEmbed API (Instagram's official public API)
    try {
      const oembedUrl = `https://graph.instagram.com/oembed?url=${encodeURIComponent(url)}&omitscript=true`;
      const oembedResponse = await fetch(oembedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Dangit/1.0)'
        }
      });
      
      if (oembedResponse.ok) {
        const oembedData = await oembedResponse.json();
        console.log('✅ oEmbed success!');
        
        // Extract actual content from title
        let cleanTitle = oembedData.title || '';
        
        // Remove " on Instagram: " and Instagram branding
        cleanTitle = cleanTitle.replace(/^.*? on Instagram: "?/, '');
        cleanTitle = cleanTitle.replace(/"$/, '');
        cleanTitle = cleanTitle.replace(/Instagram$/, '').trim();
        
        // If still too generic, use author + type
        if (!cleanTitle || cleanTitle.length < 10 || cleanTitle === 'Instagram') {
          cleanTitle = `${oembedData.author_name}'s ${postType === 'reel' ? 'Reel' : 'Post'}`;
        }
        
        return res.json({
          title: cleanTitle,
          description: cleanTitle, // Use same for description
          url: url,
          thumbnail: oembedData.thumbnail_url,
          author: oembedData.author_name,
          type: 'instagram',
          postType: postType,
          postId: postId
        });
      }
    } catch (oembedError) {
      console.log('oEmbed failed:', oembedError.message);
    }
    
    // Fallback: Generic but clear
    return res.json({
      title: postType === 'reel' ? 'Instagram Reel' : 'Instagram Post',
      description: `${postType === 'reel' ? 'Video' : 'Photo'} content from Instagram`,
      url: url,
      thumbnail: 'https://www.instagram.com/static/images/ico/favicon-192.png/68d99ba29cc8.png',
      type: 'instagram',
      postType: postType,
      postId: postId
    });
    
  } catch (error) {
    console.error('Instagram error:', error);
    res.json({
      title: 'Instagram Content',
      description: 'Saved from Instagram',
      url: req.body.url,
      type: 'instagram'
    });
  }
});

// URL Preview endpoint
app.get('/api/url-preview', async (req, res) => {
  try {
    const { url } = req.query;
    
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }
    
    console.log('🔒 Fetching URL preview for:', url);
    
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    
    const response = await fetch(fullUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000 // 5 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Extract Open Graph and meta tags
    const preview = {
      title: $('meta[property="og:title"]').attr('content') || 
             $('meta[name="twitter:title"]').attr('content') || 
             $('title').text() || 
             'No title',
      description: $('meta[property="og:description"]').attr('content') || 
                  $('meta[name="twitter:description"]').attr('content') || 
                  $('meta[name="description"]').attr('content') || 
                  'No description available',
      image: $('meta[property="og:image"]').attr('content') || 
             $('meta[name="twitter:image"]').attr('content') || 
             null,
      siteName: $('meta[property="og:site_name"]').attr('content') || 
                new URL(fullUrl).hostname,
      url: fullUrl
    };
    
    // Clean up text
    preview.title = preview.title.trim().substring(0, 100);
    preview.description = preview.description.trim().substring(0, 200);
    
    console.log('✅ URL preview fetched successfully');
    res.json({ success: true, preview });
    
  } catch (error) {
    console.error('URL preview error:', error.message);
    
    // Return basic fallback preview
    res.json({ 
      success: true, 
      preview: {
        title: 'Link Preview',
        description: 'Preview not available for this link',
        image: null,
        siteName: new URL(req.query.url).hostname,
        url: req.query.url
      }
    });
  }
});

// AI Analysis endpoint (internal use only)
app.post('/api/analyze', async (req, res) => {
  try {
    const { content, contentType } = req.body;
    console.log('Analyzing content type:', contentType);

    let analysisResult;

    // IMAGE ANALYSIS - Detailed & Specific
    if (contentType === 'image') {
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
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
                  detail: "high"
                }
              }
            ]
          }
        ],
        max_tokens: 1000,
        temperature: 0.3
      });

      const rawResponse = response.choices[0].message.content;
      console.log('GPT-4 Vision response:', rawResponse);
      analysisResult = cleanJSONResponse(rawResponse);
    }

    // ✅ UPDATED: URL ANALYSIS - Instagram Aware
    else if (contentType === 'url') {
      // Check if Instagram
      if (content.url && (content.url.includes('instagram.com') || content.url.includes('instagr.am'))) {
        console.log('🎯 Instagram URL detected');
        
        // Use the scraped data we already have
        const postMatch = content.url.match(/\/(p|reel|reels)\/([A-Za-z0-9_-]+)/);
        const postType = postMatch ? postMatch[1] : 'post';
        
        // Take the title/description from scraping
        let title = content.title || '';
        let description = content.description || '';
        
        // Clean up Instagram's default branding
        if (title === 'Instagram' || title.includes('Instagram:')) {
          title = title.replace(/^.*? on Instagram: "?/, '').replace(/"$/, '').trim();
        }
        
        // If still generic, make it simple but informative
        if (!title || title.length < 10) {
          title = postType === 'reel' ? 'Instagram Reel' : 'Instagram Post';
          description = content.author ? `Content by ${content.author}` : 'Saved from Instagram';
        }
        
        // Return without AI analysis (AI hallucinates on Instagram)
        analysisResult = {
          title: title.substring(0, 60),
          category: 'Entertainment',
          summary: description || 'Instagram content saved for later viewing',
          tags: ['instagram', postType === 'reel' ? 'video' : 'photo', 'social-media'],
          content_type: postType === 'reel' ? 'video' : 'photo',
          platform: 'instagram'
        };
        
        return res.json(analysisResult);
      }
      
      // Regular URL analysis
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
        model: "gpt-4o-mini",
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

    // TEXT/NOTE ANALYSIS - Light Touch
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

    // Validation & cleanup
    if (!analysisResult.title || !analysisResult.category || !analysisResult.summary) {
      throw new Error('Invalid AI response format');
    }

    analysisResult.title = analysisResult.title.substring(0, 60);
    analysisResult.summary = analysisResult.summary.substring(0, 300);
    analysisResult.tags = (analysisResult.tags || []).slice(0, 5);

    console.log('Final analysis result:', analysisResult);
    res.json(analysisResult);

  } catch (error) {
    console.error('Analysis error:', error);
    
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

// ✅ UPDATED: Scrape URL endpoint with Instagram handling
app.post('/api/scrape', async (req, res) => {
  try {
    const { url } = req.body;
    console.log('Scraping URL:', url);
    
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    
    // Instagram: Call the dedicated scraper
    if (fullUrl.includes('instagram.com') || fullUrl.includes('instagr.am')) {
      console.log('🎯 Instagram detected - using dedicated scraper');
      
      const serverUrl = process.env.NODE_ENV === 'production' 
        ? 'https://dangit-backend.onrender.com' 
        : `http://localhost:${PORT}`;
      
      const instagramResponse = await fetch(`${serverUrl}/api/scrape-instagram`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: fullUrl })
      });
      
      const instagramData = await instagramResponse.json();
      return res.json(instagramData);
    }
    
    // Regular URL scraping
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
    res.json({
      title: 'Saved Link',
      description: `Link saved: ${req.body.url}`,
      url: req.body.url
    });
  }
});

// ============================================
// 🔒 PROTECTED ENDPOINTS (Authentication required)
// ============================================

// Get saved items endpoint - SECURE
app.get('/api/saved-items', authenticateUser, async (req, res) => {
  try {
    const { category } = req.query;
    const userId = req.userId; // From authenticated token
    
    console.log('🔒 Securely fetching saved items for user:', userId);
    
    let query = supabase
      .from('saved_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (category && category !== 'all') {
      query = query.eq('ai_category', category);
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('Database error:', error);
      return res.status(500).json({ error: 'Failed to fetch items' });
    }
    
    console.log(`✅ Found ${data.length} items for authenticated user`);
    res.json({ data });
    
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
});

// Upload image to Supabase Storage - SECURE
app.post('/api/storage/upload-image', authenticateUser, async (req, res) => {
  try {
    const { imageData, fileName } = req.body;
    const userId = req.userId; // From authenticated token
    
    console.log('🔒📤 Securely uploading image for user:', userId);
    
    // Remove data URL prefix if present
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Create unique filename with authenticated user's email
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

// Enhanced process content endpoint - SECURE
app.post('/api/process-content', authenticateUser, async (req, res) => {
  try {
    const { content, contentType } = req.body;
    const userId = req.userId; // From authenticated token
    
    console.log('🔒🚀 Securely processing content for user:', userId, '| Type:', contentType);
    
    let processedContent;
    let imageUrl = null;
    let previewData = null;
    let contentMetadata = {};
    
    const serverUrl = process.env.NODE_ENV === 'production' 
      ? 'https://dangit-backend.onrender.com' 
      : `http://localhost:${process.env.PORT || 3001}`;
    
    // IMAGE PROCESSING WITH STORAGE
    if (contentType === 'image') {
      console.log('📸 Processing image with secure storage...');
      
      // Upload image (using authenticated endpoint)
      const uploadResponse = await fetch(`${serverUrl}/api/storage/upload-image`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': req.headers.authorization // Forward auth token
        },
        body: JSON.stringify({ 
          imageData: content, 
          fileName: `screenshot-${Date.now()}.png`
        })
      });
      
      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.success) {
        imageUrl = uploadResult.url;
        contentMetadata = {
          storage_path: uploadResult.path,
          uploaded_at: new Date().toISOString(),
          file_size: Math.round(content.length * 0.75)
        };
        console.log('✅ Image uploaded securely to:', imageUrl);
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
    
    // URL PROCESSING WITH PREVIEW DATA
    else if (contentType === 'url') {
      console.log('🔗 Processing URL with preview data...');
      
      const scrapeResponse = await fetch(`${serverUrl}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: content })
      });
      const scrapedData = await scrapeResponse.json();
      
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
    
    // TEXT PROCESSING WITH METADATA
    else {
      console.log('📝 Processing text with metadata...');
      
      const analyzeResponse = await fetch(`${serverUrl}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, contentType: 'text' })
      });
      processedContent = await analyzeResponse.json();
      
      const words = content.trim().split(/\s+/).length;
      contentMetadata = {
        word_count: words,
        char_count: content.length,
        estimated_read_time: Math.max(1, Math.ceil(words / 200))
      };
    }
    
    // SAVE TO DATABASE WITH AUTHENTICATED USER
    console.log('💾 Saving to database for authenticated user...');
    const { data, error } = await supabase
      .from('saved_items')
      .insert({
        user_id: userId, // From authenticated token
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

    console.log('✅ Successfully saved with enhanced security!');
    res.json({ success: true, data: data });
    
  } catch (error) {
    console.error('Process content error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to process content' 
    });
  }
});

// Toggle completion endpoint - SECURE (handles UUID strings)
app.patch('/api/toggle-completion', authenticateUser, async (req, res) => {
  try {
    const { itemId, completed } = req.body;
    const userId = req.userId;
    
    console.log('🔒 Securely toggling completion for item:', itemId, 'user:', userId);
    
    // ✅ Validate inputs
    if (!itemId || typeof completed !== 'boolean') {
      return res.status(400).json({ 
        error: 'Invalid request: itemId and completed (boolean) are required' 
      });
    }
    
    // ✅ Convert to string (handles both UUID strings and numbers)
    const itemIdString = String(itemId);
    
    // ✅ Validate UUID format (your database uses UUIDs)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(itemIdString)) {
      console.error('❌ Invalid UUID format received:', itemIdString);
      return res.status(400).json({ 
        error: 'Invalid itemId format: must be a valid UUID',
        received: itemIdString,
        hint: 'Expected format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'
      });
    }
    
    console.log('✅ Valid UUID format:', itemIdString);
    
    // Verify ownership and update
    const { data, error } = await supabase
      .from('saved_items')
      .update({ 
        is_completed: completed,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemIdString) // ✅ Use UUID string
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      console.error('Database error:', error);
      
      if (error.code === 'PGRST116') {
        return res.status(404).json({ 
          error: 'Item not found or access denied',
          details: 'Either the item does not exist or you do not have permission to modify it'
        });
      }
      
      return res.status(500).json({ 
        error: 'Database error occurred',
        code: error.code,
        message: error.message
      });
    }
    
    console.log('✅ Successfully toggled completion for UUID:', itemIdString, 'to:', completed);
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Toggle completion error:', error);
    res.status(500).json({ 
      error: 'Failed to toggle completion',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ✅ NEW: Update title endpoint - SECURE
app.patch('/api/update-title', authenticateUser, async (req, res) => {
  try {
    const { itemId, title } = req.body;
    const userId = req.userId; // From authenticated token
    
    console.log('🔒 Securely updating title for item:', itemId, 'user:', userId);
    
    // ✅ Validate inputs
    if (!itemId) {
      return res.status(400).json({ error: 'itemId is required' });
    }
    
    if (!title || title.length === 0) {
      return res.status(400).json({ error: 'Title cannot be empty' });
    }
    
    if (title.length > 100) {
      return res.status(400).json({ error: 'Title too long (max 100 characters)' });
    }
    
    // ✅ Convert to string and validate UUID format
    const itemIdString = String(itemId);
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(itemIdString)) {
      console.error('❌ Invalid UUID format received:', itemIdString);
      return res.status(400).json({ 
        error: 'Invalid itemId format: must be a valid UUID',
        received: itemIdString
      });
    }
    
    // ✅ Update title with ownership verification
    const { data, error } = await supabase
      .from('saved_items')
      .update({ 
        title: title.trim().substring(0, 100), // Sanitize and limit length
        updated_at: new Date().toISOString()
      })
      .eq('id', itemIdString)
      .eq('user_id', userId) // Ensure user can only update their own items
      .select()
      .single();
    
    if (error) {
      console.error('Database error:', error);
      
      if (error.code === 'PGRST116') {
        return res.status(404).json({ 
          error: 'Item not found or access denied',
          details: 'Either the item does not exist or you do not have permission to modify it'
        });
      }
      
      return res.status(500).json({ 
        error: 'Database error occurred',
        code: error.code,
        message: error.message
      });
    }
    
    console.log('✅ Successfully updated title for UUID:', itemIdString);
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Update title error:', error);
    res.status(500).json({ 
      error: 'Failed to update title',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Delete item endpoint - SECURE
app.delete('/api/delete-item', authenticateUser, async (req, res) => {
  try {
    const { itemId } = req.body;
    const userId = req.userId; // From authenticated token
    
    console.log('🔒 Securely deleting item:', itemId, 'for user:', userId);
    
    // Verify ownership and delete
    const { data, error } = await supabase
      .from('saved_items')
      .delete()
      .eq('id', itemId)
      .eq('user_id', userId) // Ensure user can only delete their own items
      .select()
      .single();

    if (error) {
      return res.status(404).json({ error: 'Item not found or access denied' });
    }
    
    console.log('✅ Successfully deleted item securely');
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Delete item error:', error);
    res.status(500).json({ error: 'Failed to delete item' });
  }
});

// Get user stats endpoint - SECURE
app.get('/api/user-stats', authenticateUser, async (req, res) => {
  try {
    const userId = req.userId; // From authenticated token
    
    console.log('🔒 Getting stats for authenticated user:', userId);
    
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
    
    console.log('✅ User stats retrieved securely');
    res.json({ success: true, stats });
    
  } catch (error) {
    console.error('User stats error:', error);
    res.status(500).json({ error: 'Failed to get user stats' });
  }
});

// Get item with full details - SECURE
app.get('/api/item/:itemId', authenticateUser, async (req, res) => {
  try {
    const { itemId } = req.params;
    const userId = req.userId; // From authenticated token
    
    const { data, error } = await supabase
      .from('saved_items')
      .select('*')
      .eq('id', itemId)
      .eq('user_id', userId) // Ensure user can only access their own items
      .single();
    
    if (error) {
      console.error('Fetch item error:', error);
      return res.status(404).json({ error: 'Item not found or access denied' });
    }
    
    // Increment view count
    await supabase
      .from('saved_items')
      .update({ 
        view_count: (data.view_count || 0) + 1,
        last_viewed_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .eq('user_id', userId);
    
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Get item error:', error);
    res.status(500).json({ error: 'Failed to fetch item' });
  }
});

// ============================================
// 💬 FEEDBACK & FEATURE VOTING ENDPOINTS - SECURE
// ============================================

// ✅ NEW: Get feedback (admin only - for you to view feedback)
app.get('/api/feedback', authenticateUser, async (req, res) => {
  try {
    const userId = req.userId;
    
    // Only allow admin (your email) to view all feedback
    const adminEmails = ['itskaushik06@gmail.com', 'kaushikbaira@gmail.com'];
    if (!adminEmails.includes(userId)) {
      return res.status(403).json({ error: 'Access denied. Admin only.' });
    }
    
    console.log('🔒 Admin accessing all feedback:', userId);
    
    const { data, error } = await supabase
      .from('user_feedback')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Feedback fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch feedback' });
    }
    
    console.log(`✅ Retrieved ${data.length} feedback entries for admin`);
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({ error: 'Failed to get feedback' });
  }
});

// ✅ NEW: Submit feedback - SECURE
app.post('/api/feedback', authenticateUser, async (req, res) => {
  try {
    const { feedback_type, rating, message, category } = req.body;
    const userId = req.userId; // From authenticated token
    
    console.log('💬 User submitting feedback:', userId, 'type:', feedback_type);
    
    // Validate inputs
    if (!feedback_type || !['rating', 'feature_request', 'bug_report', 'general'].includes(feedback_type)) {
      return res.status(400).json({ error: 'Invalid feedback type' });
    }
    
    if (feedback_type === 'rating' && (!rating || rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
    
    if (message && message.length > 1000) {
      return res.status(400).json({ error: 'Message too long (max 1000 characters)' });
    }
    
    // Insert feedback
    const { data, error } = await supabase
      .from('user_feedback')
      .insert({
        user_id: userId,
        feedback_type,
        rating: feedback_type === 'rating' ? rating : null,
        message: message?.trim() || null,
        category: category || 'general',
        status: 'new'
      })
      .select()
      .single();
    
    if (error) {
      console.error('Feedback insert error:', error);
      return res.status(500).json({ error: 'Failed to save feedback' });
    }
    
    console.log('✅ Feedback saved successfully');
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Submit feedback error:', error);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// ✅ NEW: Get features for voting - SECURE
app.get('/api/features', authenticateUser, async (req, res) => {
  try {
    const userId = req.userId;
    
    console.log('🔒 Getting features for user:', userId);
    
    // Get all features with vote counts
    const { data, error } = await supabase
      .from('feature_votes')
      .select(`
        *,
        user_votes!inner(vote_type)
      `)
      .order('votes_count', { ascending: false });
    
    if (error) {
      console.error('Features fetch error:', error);
      // If no features exist yet, return empty array
      if (error.code === 'PGRST116') {
        return res.json({ success: true, data: [] });
      }
      return res.status(500).json({ error: 'Failed to fetch features' });
    }
    
    console.log(`✅ Retrieved ${data?.length || 0} features`);
    res.json({ success: true, data: data || [] });
    
  } catch (error) {
    console.error('Get features error:', error);
    res.status(500).json({ error: 'Failed to get features' });
  }
});

// ✅ NEW: Submit feature suggestion - SECURE
app.post('/api/features', authenticateUser, async (req, res) => {
  try {
    const { title, description } = req.body;
    const userId = req.userId;
    
    console.log('💡 User suggesting feature:', userId, 'title:', title);
    
    // Validate inputs
    if (!title || title.trim().length === 0) {
      return res.status(400).json({ error: 'Feature title is required' });
    }
    
    if (title.length > 100) {
      return res.status(400).json({ error: 'Title too long (max 100 characters)' });
    }
    
    if (description && description.length > 500) {
      return res.status(400).json({ error: 'Description too long (max 500 characters)' });
    }
    
    // Check if feature already exists (prevent duplicates)
    const { data: existing } = await supabase
      .from('feature_votes')
      .select('id')
      .ilike('feature_title', `%${title.trim()}%`)
      .limit(1);
    
    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Similar feature suggestion already exists' });
    }
    
    // Insert new feature
    const { data, error } = await supabase
      .from('feature_votes')
      .insert({
        user_id: userId,
        feature_title: title.trim(),
        feature_description: description?.trim() || null,
        votes_count: 1,
        status: 'suggested',
        category: 'other'
      })
      .select()
      .single();
    
    if (error) {
      console.error('Feature insert error:', error);
      return res.status(500).json({ error: 'Failed to save feature suggestion' });
    }
    
    // Also add the user's vote
    await supabase
      .from('user_votes')
      .insert({
        user_id: userId,
        feature_id: data.id,
        vote_type: 'upvote'
      });
    
    console.log('✅ Feature suggestion saved successfully');
    res.json({ success: true, data });
    
  } catch (error) {
    console.error('Submit feature error:', error);
    res.status(500).json({ error: 'Failed to submit feature suggestion' });
  }
});

// ✅ NEW: Vote on feature - SECURE
app.post('/api/features/vote', authenticateUser, async (req, res) => {
  try {
    const { feature_id, vote_type } = req.body;
    const userId = req.userId;
    
    console.log('🗳️ User voting:', userId, 'feature:', feature_id, 'vote:', vote_type);
    
    // Validate inputs
    if (!feature_id) {
      return res.status(400).json({ error: 'feature_id is required' });
    }
    
    if (!vote_type || !['upvote', 'downvote'].includes(vote_type)) {
      return res.status(400).json({ error: 'vote_type must be upvote or downvote' });
    }
    
    // Check if user already voted on this feature
    const { data: existingVote } = await supabase
      .from('user_votes')
      .select('vote_type')
      .eq('user_id', userId)
      .eq('feature_id', feature_id)
      .single();
    
    let voteChange = 0;
    
    if (existingVote) {
      // User already voted
      if (existingVote.vote_type === vote_type) {
        // Same vote - remove it (toggle off)
        await supabase
          .from('user_votes')
          .delete()
          .eq('user_id', userId)
          .eq('feature_id', feature_id);
        
        voteChange = vote_type === 'upvote' ? -1 : 1;
      } else {
        // Different vote - update it
        await supabase
          .from('user_votes')
          .update({ vote_type })
          .eq('user_id', userId)
          .eq('feature_id', feature_id);
        
        voteChange = vote_type === 'upvote' ? 2 : -2;
      }
    } else {
      // New vote
      await supabase
        .from('user_votes')
        .insert({
          user_id: userId,
          feature_id: feature_id,
          vote_type: vote_type
        });
      
      voteChange = vote_type === 'upvote' ? 1 : -1;
    }
    
    // Update the feature vote count
    const { data, error } = await supabase
      .rpc('increment_votes', {
        feature_id: feature_id,
        increment_by: voteChange
      });
    
    if (error) {
      console.error('Vote update error:', error);
      // Fallback: manual update
      const { data: featureData } = await supabase
        .from('feature_votes')
        .select('votes_count')
        .eq('id', feature_id)
        .single();
      
      if (featureData) {
        await supabase
          .from('feature_votes')
          .update({ 
            votes_count: Math.max(0, (featureData.votes_count || 0) + voteChange)
          })
          .eq('id', feature_id);
      }
    }
    
    console.log('✅ Vote processed successfully');
    res.json({ success: true, vote_change: voteChange });
    
  } catch (error) {
    console.error('Vote feature error:', error);
    res.status(500).json({ error: 'Failed to process vote' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 DANGIT Server v2.4.0-SECURE+FEEDBACK running on http://0.0.0.0:${PORT}`);
  console.log('🔒 SECURITY: All user endpoints now require authentication');
  console.log('✨ Enhanced Features: Secure Auth, Image Storage, Link Previews, View Tracking, Title Updates');
  console.log('💬 NEW: Feedback System with Feature Voting');
  console.log('📊 AI Models: GPT-4o (vision), GPT-4o-mini (text)');
  console.log('🗂️ Storage: Supabase Storage for images');
});
