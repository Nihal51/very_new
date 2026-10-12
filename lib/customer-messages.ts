/**
 * Messages the team sends a customer from /admin with one tap: the button
 * opens WhatsApp with the text already typed, and a person presses Send. Free,
 * and it works today.
 *
 * Once the WhatsApp Business API is set up (docs/whatsapp.md), the alerts
 * robot sends the "driver assigned" message by itself; this button stays
 * useful for customers who want to chat, or if the automatic one failed.
 *
 * No imports, so scripts/customer-messages.test.mjs can run this file as is.
 */

export type DriverAssignedInput = {
  customerName: string;
  /** "DB-1042", or '' if the robot has not numbered it yet. */
  bookingRef: string;
  driverName: string;
  /** Already formatted, e.g. "+91 98933 02783". */
  driverPhone: string;
  /** Already formatted trip time, e.g. "Thu, 8 Oct, 3:30 pm" or "As soon as possible". */
  when: string;
  pickup: string;
  /** DriveBuddy's own number, formatted. */
  helpPhone: string;
};

export type MessageLanguage = 'en' | 'hi';

const firstName = (name: string) => name.trim().split(/\s+/)[0] || '';

export function driverAssignedMessage(m: DriverAssignedInput, lang: MessageLanguage): string {
  const name = firstName(m.customerName);
  const ref = m.bookingRef.trim();
  const driverFirst = firstName(m.driverName) || m.driverName;
  if (lang === 'hi') {
    return [
      `नमस्ते ${name},`,
      ref
        ? `बुकिंग ${ref} के लिए आपका DriveBuddy ड्राइवर तय हो गया है।`
        : 'आपकी बुकिंग के लिए DriveBuddy ड्राइवर तय हो गया है।',
      '',
      `ड्राइवर: ${m.driverName}`,
      `मोबाइल: ${m.driverPhone}`,
      `समय: ${m.when}`,
      `पिकअप: ${m.pickup}`,
      '',
      `${driverFirst} पहुँचने से पहले आपको कॉल करेंगे। कोई सवाल हो तो हमें ${m.helpPhone} पर कॉल या WhatsApp करें।`,
      '— DriveBuddy',
    ].join('\n');
  }
  return [
    `Hello ${name},`,
    ref ? `Your DriveBuddy driver for booking ${ref} is confirmed.` : 'Your DriveBuddy driver is confirmed.',
    '',
    `Driver: ${m.driverName}`,
    `Mobile: ${m.driverPhone}`,
    `Time: ${m.when}`,
    `Pickup: ${m.pickup}`,
    '',
    `${driverFirst} will call you before reaching. Any questions? Call or WhatsApp us on ${m.helpPhone}.`,
    '— DriveBuddy',
  ].join('\n');
}
