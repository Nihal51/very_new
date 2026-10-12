# Automatic "driver assigned" WhatsApp

**Optional.** The free way already works: in `/admin`, open a booking after
assigning a driver and tap **English** or **हिंदी** under *Tell the customer
their driver is coming*. WhatsApp opens with the message typed; you press Send.

This page is for the **automatic** version: the alerts robot sends the message
itself, within a minute of you assigning a driver, even at 2 am. It uses Meta's
WhatsApp Business Platform (Cloud API).

## What it costs and needs

- **Meta charges per message.** A "utility" message (like this one) costs about
  ₹0.145 in India (Oct 2026). Since 1 Oct 2026 utility messages are charged even
  when the customer messaged you in the last 24 hours. Check the current rate on
  Meta's pricing page before you start; 200 bookings a month ≈ ₹30.
- **A phone number just for the API.** A number on the Cloud API cannot also be
  used in the normal WhatsApp or WhatsApp Business app. Use a new SIM (or a
  landline that can receive a call), not 91114 73929, unless you want to move
  that number off the app for good.
- **Meta Business verification** and **template approval**: usually a few days.

## Setup (about an hour, plus Meta's waiting time)

1. **Meta Business account.** Go to business.facebook.com → create a business
   for DriveBuddy (or use the one linked to your Facebook page). Business
   settings → Security centre → **Start verification** (GST or Udyam
   certificate, address, the website).
2. **App with WhatsApp.** developers.facebook.com → My apps → **Create app** →
   *Other* → *Business* → add the **WhatsApp** product. Under WhatsApp → API
   setup, **Add phone number** (the dedicated number from above), set the
   display name **DriveBuddy**, verify it by SMS or call.
3. **The message template.** WhatsApp Manager → Message templates → **Create
   template** → Category **Utility** → name `driver_assigned` → language
   **English**. Body, exactly (the numbers in braces are filled in by the robot):

   ```
   Hello {{1}}, your DriveBuddy driver for booking {{2}} is confirmed.
   Driver: {{3}}
   Mobile: {{4}}
   Time: {{5}}
   Your driver will call you before reaching. For help, reply to this message or call 91114 73929.
   ```

   Sample values for review: `Ramesh`, `DB-1042`, `Suresh Verma`,
   `+91 98933 02783`, `Thu 8 Oct, 3:30 PM`. Submit and wait for *Approved*.

   Want Hindi instead? Create the same template in **Hindi**:

   ```
   नमस्ते {{1}}, बुकिंग {{2}} के लिए आपका DriveBuddy ड्राइवर तय हो गया है।
   ड्राइवर: {{3}}
   मोबाइल: {{4}}
   समय: {{5}}
   पहुँचने से पहले ड्राइवर आपको कॉल करेंगे। मदद के लिए इस मैसेज का जवाब दें या 91114 73929 पर कॉल करें।
   ```

4. **A permanent access token.** Business settings → Users → **System users** →
   Add (role Admin) → *Assign assets*: your WhatsApp account, full control →
   **Generate new token** for your app with the permissions
   `whatsapp_business_messaging` and `whatsapp_business_management`, expiry
   **Never**. Copy it once; Meta will not show it again.
5. **Tell the robot.** Open the *DriveBuddy Bookings* Sheet → Extensions → Apps
   Script → ⚙ Project Settings → **Script properties** → add:

   | Property | Value |
   |---|---|
   | `WHATSAPP_TOKEN` | the token from step 4 |
   | `WHATSAPP_PHONE_ID` | WhatsApp → API setup → **Phone number ID** (digits, not the phone number) |
   | `WHATSAPP_LANGUAGE` | `en`, or `hi` if your approved template is Hindi |
   | `WHATSAPP_TEMPLATE` | only if you named the template something other than `driver_assigned` |

   Save. That's it: the next driver you assign is messaged automatically.

## How you know it worked

- The booking in Firestore gets `whatsappAssigned: "sent"` (or `"failed"`).
- If it says `failed`: Apps Script → **Executions** shows Meta's reason. The
  usual ones are a template not yet approved, a template name or language that
  does not match the properties, or a token that expired (make a *Never*
  token, step 4).
- To switch it off, delete `WHATSAPP_TOKEN`. The one-tap buttons in `/admin`
  keep working either way.

Each booking is messaged once per driver: assigning a different driver sends
the new driver's details; saving the same booking again does not.
