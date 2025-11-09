/**
 * Manual User Addition Endpoint for Languaro Pro
 * 
 * Use this endpoint to manually add users to Pro while testing,
 * or as a backup if webhooks fail.
 * 
 * Environment variables required:
 * - SUPABASE_LICENSING_URL: Your Supabase project URL for licensing
 * - USERS_SUPABASE_SERVICE_ROLE_KEY: Service role key (has write access)
 * - ADMIN_SECRET: A secret password to protect this endpoint
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_LICENSING_URL || '',
  process.env.USERS_SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { secret, email, plan = 'monthly' } = req.body;

  // Verify admin secret
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    console.error('❌ Invalid admin secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Validate email
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  // Validate plan
  const validPlans = ['free', 'monthly', 'lifetime'];
  if (!validPlans.includes(plan)) {
    return res.status(400).json({ error: 'Invalid plan. Must be: free, monthly, or lifetime' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    console.log(`🔧 Manual add: ${normalizedEmail} → ${plan}`);

    // Check if user exists
    const { data: existingUsers } = await supabase
      .from('users')
      .select('*')
      .eq('email', normalizedEmail);

    const userData = {
      email: normalizedEmail,
      is_pro: plan !== 'free',
      plan: plan,
      activated_at: new Date().toISOString(),
      purchase_data: {
        manually_added: true,
        added_at: new Date().toISOString(),
      }
    };

    let result;
    if (existingUsers && existingUsers.length > 0) {
      // Update existing user
      result = await supabase
        .from('users')
        .update({
          is_pro: plan !== 'free',
          plan: plan,
          purchase_data: {
            ...existingUsers[0].purchase_data,
            manually_updated: true,
            updated_at: new Date().toISOString(),
          }
        })
        .eq('email', normalizedEmail);

      console.log(`✅ Updated user: ${normalizedEmail}`);
    } else {
      // Insert new user
      result = await supabase
        .from('users')
        .insert([userData]);

      console.log(`✅ Created user: ${normalizedEmail}`);
    }

    if (result.error) {
      console.error('❌ Supabase error:', result.error);
      return res.status(500).json({ 
        error: 'Database error', 
        details: result.error.message 
      });
    }

    return res.status(200).json({ 
      success: true,
      email: normalizedEmail,
      plan: plan,
      is_pro: plan !== 'free',
      message: existingUsers?.length > 0 ? 'User updated' : 'User created'
    });

  } catch (error) {
    console.error('❌ Error adding user:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  }
}
