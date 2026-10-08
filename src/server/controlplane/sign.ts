import { createHash, createHmac } from 'node:crypto';

/**
 * BytePlus OpenAPI 签名（HMAC-SHA256），按官方「Calculating a signature」：
 * https://docs.byteplus.com/en/docs/byteplus-platform/reference-how-to-calculate-a-signature
 *
 * CanonicalRequest = Method \n CanonicalURI \n CanonicalQueryString \n CanonicalHeaders \n SignedHeaders \n Hex(SHA256(Payload))
 * StringToSign     = "HMAC-SHA256" \n X-Date \n {YYYYMMDD}/{region}/{service}/request \n Hex(SHA256(CanonicalRequest))
 * kSigning         = HMAC(HMAC(HMAC(HMAC(SK, YYYYMMDD), region), service), "request")
 */

export interface SignInput {
  method: 'GET' | 'POST';
  host: string;
  path: string;
  query: Record<string, string>;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** 请求时间，测试时固定 */
  now?: Date;
  /** 额外参与签名的请求头（如 content-type） */
  headers?: Record<string, string>;
}

/** 要加到请求上的头；Host 参与签名，但由 fetch 按 URL 自动带上，不在这里返回 */
export interface SignedHeaders {
  'X-Date': string;
  'X-Content-Sha256': string;
  Authorization: string;
  [k: string]: string;
}

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986：除 A-Z a-z 0-9 - _ . ~ 外都编码 */
export function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function canonicalQuery(query: Record<string, string>): string {
  return Object.keys(query)
    .sort()
    .map((k) => `${rfc3986(k)}=${rfc3986(query[k]!)}`)
    .join('&');
}

/** 20240514T132743Z */
export function xDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function signRequest(input: SignInput): SignedHeaders {
  const date = xDate(input.now ?? new Date());
  const day = date.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  const headers: Record<string, string> = {
    host: input.host,
    'x-date': date,
    'x-content-sha256': payloadHash,
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [input.method, input.path || '/', canonicalQuery(input.query), canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${day}/${input.region}/${input.service}/request`;
  const stringToSign = ['HMAC-SHA256', date, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(input.secretAccessKey, day), input.region), input.service), 'request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');
  return {
    ...Object.fromEntries(Object.entries(input.headers ?? {})),
    'X-Date': date,
    'X-Content-Sha256': payloadHash,
    Authorization: `HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
