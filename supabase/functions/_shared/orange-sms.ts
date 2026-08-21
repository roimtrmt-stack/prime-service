export type OrangeSmsResult = {
  target: string;
  delivered: boolean;
  reason: string;
  status?: number;
};

const TOKEN_URL = "https://api.orange.com/oauth/v3/token";
const MESSAGING_BASE_URL = "https://api.orange.com/smsmessaging/v1";
const MAX_SMS_LENGTH = 160;
const MAX_RECIPIENTS_PER_CALL = 100;
const ORANGE_MALI_PREFIX = "+223";

let tokenCache: { accessToken: string; expiresAt: number } | null = null;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clipSms(value: string): string {
  return value.length <= MAX_SMS_LENGTH ? value : `${value.slice(0, MAX_SMS_LENGTH - 1)}…`;
}

export function normalizeMaliPhone(value: unknown): string | null {
  const raw = text(value, 80);
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 8) return `${ORANGE_MALI_PREFIX}${digits}`;
  if (digits.length === 11 && digits.startsWith("223")) return `+${digits}`;
  return null;
}

function normalizeSenderAddress(value: unknown): string | null {
  const raw = text(value, 120);
  if (/^tel:\+\d{8,15}$/.test(raw)) return raw;
  const phone = normalizeMaliPhone(raw);
  return phone ? `tel:${phone}` : null;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getAccessToken(): Promise<string> {
  const clientId = text(Deno.env.get("ORANGE_CLIENT_ID"), 300);
  const clientSecret = text(Deno.env.get("ORANGE_CLIENT_SECRET"), 500);
  if (!clientId || !clientSecret) throw new Error("ORANGE_CLIENT_ID ou ORANGE_CLIENT_SECRET absent");

  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.accessToken;

  const credentials = btoa(`${clientId}:${clientSecret}`);
  const response = await fetchWithTimeout(TOKEN_URL, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`Orange OAuth HTTP ${response.status}`);

  const body = await response.json().catch(() => ({}));
  const accessToken = text(body?.access_token, 4_000);
  if (!accessToken) throw new Error("Orange OAuth access_token absent");
  const expiresIn = Math.max(120, Number(body?.expires_in) || 3600);
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1_000,
  };
  return accessToken;
}

export function orangeSmsEnabled(): boolean {
  const enabled = text(Deno.env.get("ORANGE_SMS_ENABLED"), 20).toLowerCase() === "true";
  const provider = text(Deno.env.get("SMS_PROVIDER"), 20).toLowerCase();
  return enabled || provider === "orange" || provider === "both";
}

export async function sendOrangeSms(recipient: string, message: string): Promise<OrangeSmsResult> {
  const phone = normalizeMaliPhone(recipient);
  if (!phone) return { target: recipient, delivered: false, reason: "numéro malien invalide" };
  const senderAddress = normalizeSenderAddress(Deno.env.get("ORANGE_SENDER_ADDRESS"));
  if (!senderAddress) {
    return { target: phone, delivered: false, reason: "ORANGE_SENDER_ADDRESS absent ou invalide" };
  }

  try {
    const accessToken = await getAccessToken();
    const endpoint = `${MESSAGING_BASE_URL}/outbound/${encodeURIComponent(senderAddress)}/requests`;
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        outboundSMSMessageRequest: {
          address: `tel:${phone}`,
          senderAddress,
          outboundSMSTextMessage: { message: clipSms(message) },
        },
      }),
    });
    return {
      target: phone,
      delivered: response.status === 201,
      reason: response.status === 201 ? "Orange SMS accepté" : `Orange HTTP ${response.status}`,
      status: response.status,
    };
  } catch (error) {
    return {
      target: phone,
      delivered: false,
      reason: error instanceof Error ? error.message.slice(0, 180) : "exception Orange SMS",
    };
  }
}

export async function sendOrangeSmsBatch(
  recipients: string[],
  message: string,
): Promise<OrangeSmsResult[]> {
  const uniqueRecipients = [...new Set(recipients.map(normalizeMaliPhone).filter((value): value is string => Boolean(value)))]
    .slice(0, MAX_RECIPIENTS_PER_CALL);
  const results: OrangeSmsResult[] = [];
  for (const recipient of uniqueRecipients) {
    if (results.length > 0) await new Promise((resolve) => setTimeout(resolve, 210));
    results.push(await sendOrangeSms(recipient, message));
  }
  return results;
}
