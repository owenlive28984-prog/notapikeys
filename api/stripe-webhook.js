/**
 * Stripe Webhook Handler for Languaro Pro
 * 
 * This endpoint receives Stripe webhook events and automatically adds
 * paying customers to the Supabase users table.
 * 
 * Environment variables required:
 * - SUPABASE_URL: Your Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY: Service role key (has write access)
 * - STRIPE_WEBHOOK_SECRET: Stripe webhook signing secret (optional but recommended)
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '');
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

export default async function handler(req, res) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature if secret is configured
    if (webhookSecret && sig) {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // Fallback: accept unverified events (not recommended for production)
      event = JSON.parse(req.body);
    }
  } catch (err) {
    console.error('⚠️ Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  console.log('📬 Received Stripe event:', event.type);

  // Handle different event types
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        await handleCheckoutCompleted(session);
        break;
      }
      
      case 'payment_intent.succeeded': {
        const paymentIntent = event.data.object;
        await handlePaymentSucceeded(paymentIntent);
        break;
      }
      
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        await handleSubscriptionChange(subscription);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        await handleSubscriptionCanceled(subscription);
        break;
      }
      
      default:
        console.log(`ℹ️ Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Handle successful checkout session
 */
async function handleCheckoutCompleted(session) {
  const email = session.customer_email || session.customer_details?.email;
  
  if (!email) {
    console.error('❌ No email found in checkout session');
    return;
  }

  // Determine plan from metadata or price
  const plan = session.metadata?.plan || detectPlanFromSession(session);

  await addOrUpdateUser(email, plan, {
    stripe_customer_id: session.customer,
    stripe_session_id: session.id,
    amount_total: session.amount_total,
    currency: session.currency,
  });
}

/**
 * Handle successful payment intent
 */
async function handlePaymentSucceeded(paymentIntent) {
  const email = paymentIntent.receipt_email || paymentIntent.metadata?.email;
  
  if (!email) {
    console.error('❌ No email found in payment intent');
    return;
  }

  const plan = paymentIntent.metadata?.plan || 'monthly';

  await addOrUpdateUser(email, plan, {
    stripe_payment_intent: paymentIntent.id,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
  });
}

/**
 * Handle subscription creation/update
 */
async function handleSubscriptionChange(subscription) {
  // Get customer details
  const customer = await stripe.customers.retrieve(subscription.customer);
  const email = customer.email;

  if (!email) {
    console.error('❌ No email found for subscription');
    return;
  }

  const plan = subscription.metadata?.plan || (subscription.items.data[0]?.price?.recurring?.interval === 'year' ? 'lifetime' : 'monthly');
  const isActive = subscription.status === 'active' || subscription.status === 'trialing';

  if (isActive) {
    await addOrUpdateUser(email, plan, {
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
    });
  }
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionCanceled(subscription) {
  const customer = await stripe.customers.retrieve(subscription.customer);
  const email = customer.email;

  if (!email) {
    console.error('❌ No email found for canceled subscription');
    return;
  }

  // Deactivate user
  const { error } = await supabase
    .from('users')
    .update({ 
      is_pro: false,
      plan: 'free',
      purchase_data: {
        canceled_at: new Date().toISOString(),
        stripe_subscription_id: subscription.id,
      }
    })
    .eq('email', email.toLowerCase().trim());

  if (error) {
    console.error('❌ Failed to deactivate user:', error);
  } else {
    console.log(`✅ Deactivated Pro for: ${email}`);
  }
}

/**
 * Add or update user in Supabase
 */
async function addOrUpdateUser(email, plan, purchaseData = {}) {
  const normalizedEmail = email.toLowerCase().trim();

  console.log(`💾 Adding/updating user: ${normalizedEmail} (plan: ${plan})`);

  // Check if user exists
  const { data: existingUsers } = await supabase
    .from('users')
    .select('*')
    .eq('email', normalizedEmail);

  const userData = {
    email: normalizedEmail,
    is_pro: true,
    plan: plan,
    activated_at: new Date().toISOString(),
    purchase_data: {
      ...purchaseData,
      purchased_at: new Date().toISOString(),
    }
  };

  let result;
  if (existingUsers && existingUsers.length > 0) {
    // Update existing user
    result = await supabase
      .from('users')
      .update({
        is_pro: true,
        plan: plan,
        purchase_data: {
          ...existingUsers[0].purchase_data,
          ...purchaseData,
          updated_at: new Date().toISOString(),
        }
      })
      .eq('email', normalizedEmail);
  } else {
    // Insert new user
    result = await supabase
      .from('users')
      .insert([userData]);
  }

  if (result.error) {
    console.error('❌ Supabase error:', result.error);
    throw new Error(`Failed to add user to database: ${result.error.message}`);
  }

  console.log(`✅ Successfully processed user: ${normalizedEmail}`);
}

/**
 * Try to detect plan from session metadata or line items
 */
function detectPlanFromSession(session) {
  // Check metadata first
  if (session.metadata?.plan) {
    return session.metadata.plan;
  }

  // Try to infer from amount or line items
  const amount = session.amount_total;
  
  // Example: Adjust these based on your pricing
  // Lifetime might be $99, monthly might be $9/month
  if (amount >= 9900) { // $99 or more
    return 'lifetime';
  } else if (amount >= 900) { // $9 or more
    return 'monthly';
  }

  // Default to monthly
  return 'monthly';
}
