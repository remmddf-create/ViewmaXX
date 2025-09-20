import nodemailer from 'nodemailer';
import { z } from 'zod';

// Email configuration
const emailConfig = {
  host: process.env.SMTP_HOST || 'localhost',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

// Create transporter
const transporter = nodemailer.createTransporter(emailConfig);

// Email templates
const emailTemplates = {
  verification: {
    subject: 'Verify Your ViewmaXX Account',
    html: (token: string, name: string) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ViewmaXX</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #333;">Welcome to ViewmaXX, ${name}!</h2>
          <p style="color: #666; line-height: 1.6;">Thank you for signing up for ViewmaXX. To complete your registration, please click the button below to verify your email address.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/verify-email?token=${token}" 
               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Verify Email Address
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't create an account with ViewmaXX, you can safely ignore this email.</p>
          <p style="color: #666; font-size: 14px;">This verification link will expire in 24 hours.</p>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
          <p style="margin: 0;">&copy; 2025 ViewmaXX. All rights reserved.</p>
          <p style="margin: 5px 0 0 0;">You received this email because you signed up for a ViewmaXX account.</p>
        </div>
      </div>
    `,
  },
  
  passwordReset: {
    subject: 'Reset Your ViewmaXX Password',
    html: (token: string, name: string) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ViewmaXX</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p style="color: #666; line-height: 1.6;">Hi ${name}, we received a request to reset your ViewmaXX account password.</p>
          <p style="color: #666; line-height: 1.6;">Click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/reset-password?token=${token}" 
               style="background: #e74c3c; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your password will not be changed.</p>
          <p style="color: #666; font-size: 14px;">This password reset link will expire in 1 hour.</p>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
          <p style="margin: 0;">&copy; 2025 ViewmaXX. All rights reserved.</p>
          <p style="margin: 5px 0 0 0;">You received this email because a password reset was requested for your account.</p>
        </div>
      </div>
    `,
  },
  
  monetizationApproval: {
    subject: 'Your ViewmaXX Monetization Application has been Approved!',
    html: (name: string) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ViewmaXX</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #27ae60;">Congratulations! 🎉</h2>
          <p style="color: #666; line-height: 1.6;">Hi ${name}, we're excited to inform you that your monetization application has been approved!</p>
          <p style="color: #666; line-height: 1.6;">You can now start earning money from your content on ViewmaXX. Here's what you can do next:</p>
          <ul style="color: #666; line-height: 1.8;">
            <li>Enable ads on your videos</li>
            <li>Set up your payment information</li>
            <li>Track your earnings in the Creator Studio</li>
            <li>Access advanced analytics</li>
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/studio/monetization" 
               style="background: #27ae60; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Go to Creator Studio
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">Thank you for being part of the ViewmaXX community!</p>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
          <p style="margin: 0;">&copy; 2025 ViewmaXX. All rights reserved.</p>
        </div>
      </div>
    `,
  },
  
  monetizationRejection: {
    subject: 'ViewmaXX Monetization Application Update',
    html: (name: string, reason: string) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ViewmaXX</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #333;">Monetization Application Update</h2>
          <p style="color: #666; line-height: 1.6;">Hi ${name}, thank you for your interest in monetizing your content on ViewmaXX.</p>
          <p style="color: #666; line-height: 1.6;">After reviewing your application, we're unable to approve monetization for your account at this time.</p>
          <div style="background: #fff; border-left: 4px solid #e74c3c; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #666;"><strong>Reason:</strong> ${reason}</p>
          </div>
          <p style="color: #666; line-height: 1.6;">Don't worry! You can reapply once you've addressed the feedback above. Keep creating great content and building your audience.</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/studio/monetization" 
               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Monetization Guidelines
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">If you have any questions, please don't hesitate to contact our support team.</p>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
          <p style="margin: 0;">&copy; 2025 ViewmaXX. All rights reserved.</p>
        </div>
      </div>
    `,
  },
  
  newSubscriber: {
    subject: 'You have a new subscriber on ViewmaXX!',
    html: (creatorName: string, subscriberName: string, subscriberCount: number) => `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
          <h1 style="color: white; margin: 0;">ViewmaXX</h1>
        </div>
        <div style="padding: 30px; background-color: #f9f9f9;">
          <h2 style="color: #333;">New Subscriber! 🎉</h2>
          <p style="color: #666; line-height: 1.6;">Hi ${creatorName}, great news! ${subscriberName} just subscribed to your channel.</p>
          <div style="background: #fff; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
            <h3 style="color: #667eea; margin: 0 0 10px 0;">${subscriberCount.toLocaleString()}</h3>
            <p style="color: #666; margin: 0;">Total Subscribers</p>
          </div>
          <p style="color: #666; line-height: 1.6;">Keep creating amazing content to grow your community even more!</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.CLIENT_URL}/studio/analytics" 
               style="background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              View Analytics
            </a>
          </div>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; font-size: 12px;">
          <p style="margin: 0;">&copy; 2025 ViewmaXX. All rights reserved.</p>
        </div>
      </div>
    `,
  },
};

// Email validation schema
const emailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  html: z.string().min(1),
  from: z.string().email().optional(),
});

// Send email function
export const sendEmail = async (options: {
  to: string;
  subject: string;
  html: string;
  from?: string;
}): Promise<void> => {
  try {
    // Validate email options
    const validatedOptions = emailSchema.parse(options);
    
    const mailOptions = {
      from: validatedOptions.from || process.env.SMTP_FROM || 'noreply@viewmaxx.com',
      to: validatedOptions.to,
      subject: validatedOptions.subject,
      html: validatedOptions.html,
    };

    await transporter.sendMail(mailOptions);
    console.log(`Email sent successfully to ${validatedOptions.to}`);
  } catch (error) {
    console.error('Email sending failed:', error);
    throw new Error('Failed to send email');
  }
};

// Specific email functions
export const sendVerificationEmail = async (email: string, token: string, name: string = 'User'): Promise<void> => {
  await sendEmail({
    to: email,
    subject: emailTemplates.verification.subject,
    html: emailTemplates.verification.html(token, name),
  });
};

export const sendPasswordResetEmail = async (email: string, token: string, name: string = 'User'): Promise<void> => {
  await sendEmail({
    to: email,
    subject: emailTemplates.passwordReset.subject,
    html: emailTemplates.passwordReset.html(token, name),
  });
};

export const sendMonetizationApprovalEmail = async (email: string, name: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject: emailTemplates.monetizationApproval.subject,
    html: emailTemplates.monetizationApproval.html(name),
  });
};

export const sendMonetizationRejectionEmail = async (email: string, name: string, reason: string): Promise<void> => {
  await sendEmail({
    to: email,
    subject: emailTemplates.monetizationRejection.subject,
    html: emailTemplates.monetizationRejection.html(name, reason),
  });
};

export const sendNewSubscriberEmail = async (
  email: string, 
  creatorName: string, 
  subscriberName: string, 
  subscriberCount: number
): Promise<void> => {
  await sendEmail({
    to: email,
    subject: emailTemplates.newSubscriber.subject,
    html: emailTemplates.newSubscriber.html(creatorName, subscriberName, subscriberCount),
  });
};

// Bulk email function for newsletters/announcements
export const sendBulkEmail = async (recipients: string[], subject: string, html: string): Promise<void> => {
  const batchSize = 50; // Send in batches to avoid rate limits
  
  for (let i = 0; i < recipients.length; i += batchSize) {
    const batch = recipients.slice(i, i + batchSize);
    
    const promises = batch.map(email => 
      sendEmail({ to: email, subject, html }).catch(error => {
        console.error(`Failed to send email to ${email}:`, error);
        return null;
      })
    );
    
    await Promise.allSettled(promises);
    
    // Add delay between batches
    if (i + batchSize < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
};

// Email queue system (basic implementation)
class EmailQueue {
  private queue: Array<{ options: any; retries: number }> = [];
  private processing = false;
  private maxRetries = 3;
  
  add(options: { to: string; subject: string; html: string; from?: string }) {
    this.queue.push({ options, retries: 0 });
    this.process();
  }
  
  private async process() {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      
      try {
        await sendEmail(item.options);
      } catch (error) {
        console.error('Email queue processing error:', error);
        
        if (item.retries < this.maxRetries) {
          item.retries++;
          this.queue.push(item); // Retry later
        } else {
          console.error('Max retries reached for email:', item.options.to);
        }
      }
      
      // Add delay between emails
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    this.processing = false;
  }
}

export const emailQueue = new EmailQueue();

// Test email configuration
export const testEmailConfig = async (): Promise<boolean> => {
  try {
    await transporter.verify();
    console.log('Email configuration is valid');
    return true;
  } catch (error) {
    console.error('Email configuration error:', error);
    return false;
  }
};
